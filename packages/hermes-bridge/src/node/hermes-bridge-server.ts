// *****************************************************************************
// Copyright (C) 2026 Intelliverse X and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as net from 'node:net';
import { randomUUID } from 'node:crypto';
import {
    HERMES_PROTOCOL_VERSION,
    HermesBridgeClient,
    HermesBridgeServer,
    HermesBridgeStatus,
    HermesPromptRequest,
    HermesWorkspaceEditReview
} from '../common/hermes-protocol';

const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_MESSAGES_PER_WINDOW = 120;
const MAX_PROMPTS_PER_WINDOW = 30;
const RATE_WINDOW_MS = 10_000;
const HANDSHAKE_TIMEOUT_MS = 30_000;
const LAUNCH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBridgeStatus(value: unknown): value is HermesBridgeStatus {
    if (!isRecord(value) || !isRecord(value.route)) {
        return false;
    }
    const identity = value.identity;
    return typeof value.connected === 'boolean'
        && typeof value.compatible === 'boolean'
        && value.protocolVersion === HERMES_PROTOCOL_VERSION
        && (identity === undefined || (isRecord(identity)
            && typeof identity.sessionId === 'string'
            && typeof identity.windowId === 'string'
            && typeof identity.workspaceCanonicalPath === 'string'))
        && ['local', 'cloud', 'offline'].includes(String(value.route.route))
        && typeof value.route.localOnly === 'boolean'
        && typeof value.route.detail === 'string'
        && ['restricted', 'trusted'].includes(String(value.trust))
        && typeof value.detail === 'string';
}

@injectable()
export class HermesBridgeServerImpl implements HermesBridgeServer {
    protected client: HermesBridgeClient | undefined;
    protected socket: net.Socket | undefined;
    protected buffer = '';
    protected pending = new Map<string, { resolve: (value: unknown) => void; timeout: NodeJS.Timeout }>();
    protected incomingMessageTimes: number[] = [];
    protected promptTimes: number[] = [];
    protected current: HermesBridgeStatus = {
        connected: false,
        compatible: false,
        protocolVersion: HERMES_PROTOCOL_VERSION,
        route: { route: 'offline', localOnly: false, detail: 'Hermes Desktop is not connected.' },
        trust: 'restricted',
        detail: 'Hermes Studio fails closed until its authenticated Desktop broker is available.'
    };

    setClient(client: HermesBridgeClient | undefined): void {
        this.client = client;
    }

    async status(): Promise<HermesBridgeStatus> {
        return this.current;
    }

    async reconnect(): Promise<HermesBridgeStatus> {
        this.disconnect();
        const endpoint = process.env.HERMES_STUDIO_ENDPOINT;
        const token = process.env.HERMES_STUDIO_TOKEN;
        if (!endpoint || !token || !LAUNCH_TOKEN_PATTERN.test(token)) {
            return this.update({ ...this.current, connected: false, compatible: false, detail: 'Authenticated launch environment is missing.' });
        }
        const requestId = randomUUID();
        return new Promise(resolve => {
            const socket = net.createConnection(endpoint);
            this.socket = socket;
            socket.setEncoding('utf8');
            socket.once('connect', () => {
                this.write({
                    protocolVersion: HERMES_PROTOCOL_VERSION,
                    requestId,
                    issuedAt: Date.now(),
                    expiresAt: Date.now() + 30_000,
                    token,
                    payload: {
                        kind: 'handshake',
                        identity: {
                            sessionId: process.env.HERMES_STUDIO_SESSION_ID,
                            windowId: process.env.HERMES_STUDIO_WINDOW_ID,
                            workspaceCanonicalPath: process.env.HERMES_STUDIO_WORKSPACE
                        },
                        capabilities: [
                            'prompt.submit', 'prompt.stream', 'context.read-selected', 'diagnostics.read',
                            'route.status', 'workspace-edit.review', 'approval.observe', 'health'
                        ]
                    }
                });
            });
            socket.on('data', data => this.consume(data.toString()));
            socket.once('error', () => {
                socket.destroy();
                this.settlePending(requestId, this.disconnectedStatus('Hermes Desktop connection failed.'));
            });
            socket.once('close', () => {
                this.socket = undefined;
                this.buffer = '';
                this.settlePending(requestId, this.disconnectedStatus('Hermes Desktop connection closed.'));
            });
            const timeout = setTimeout(() => {
                socket.destroy();
                this.settlePending(requestId, this.disconnectedStatus('Hermes Desktop handshake timed out.'));
            }, HANDSHAKE_TIMEOUT_MS);
            this.pending.set(requestId, { resolve: value => resolve(this.update(value as HermesBridgeStatus)), timeout });
        });
    }

    async submitPrompt(request: HermesPromptRequest): Promise<void> {
        if (request.modality === 'voice' && /^(approve|confirm|yes)$/i.test(request.text.trim())) {
            throw new Error('Voice cannot approve Hermes actions.');
        }
        if (!this.current.connected) {
            throw new Error('Hermes broker is disconnected.');
        }
        if (this.current.route.localOnly && this.current.route.route === 'cloud') {
            throw new Error('Cloud is forbidden in local-only mode.');
        }
        if (!this.withinRateLimit(this.promptTimes, MAX_PROMPTS_PER_WINDOW)) {
            throw new Error('Hermes prompt rate limit exceeded.');
        }
        this.write({
            protocolVersion: HERMES_PROTOCOL_VERSION,
            requestId: request.requestId,
            issuedAt: Date.now(),
            expiresAt: Date.now() + 30_000,
            payload: { kind: 'prompt-submit', ...request }
        });
    }

    async submitWorkspaceEditReview(review: HermesWorkspaceEditReview): Promise<void> {
        if (this.current.trust !== 'trusted') {
            throw new Error('Workspace edits are disabled in restricted workspaces.');
        }
        this.write({
            protocolVersion: HERMES_PROTOCOL_VERSION,
            requestId: randomUUID(),
            issuedAt: Date.now(),
            expiresAt: Date.now() + 30_000,
            payload: { kind: 'workspace-edit-review', ...review }
        });
    }

    protected consume(data: string): void {
        this.buffer += data;
        for (;;) {
            const newline = this.buffer.indexOf('\n');
            if (newline < 0) {
                if (Buffer.byteLength(this.buffer, 'utf8') > MAX_FRAME_BYTES) {
                    this.protocolFailure('Hermes broker frame exceeds the 1 MiB limit.');
                }
                return;
            }
            const raw = this.buffer.slice(0, newline);
            this.buffer = this.buffer.slice(newline + 1);
            if (Buffer.byteLength(raw, 'utf8') > MAX_FRAME_BYTES) {
                this.protocolFailure('Hermes broker frame exceeds the 1 MiB limit.');
                return;
            }
            if (!this.withinRateLimit(this.incomingMessageTimes, MAX_MESSAGES_PER_WINDOW)) {
                this.protocolFailure('Hermes broker message rate limit exceeded.');
                return;
            }
            let message: unknown;
            try {
                message = JSON.parse(raw);
            } catch {
                this.protocolFailure('Hermes broker sent malformed JSON.');
                return;
            }
            if (!isRecord(message)
                || typeof message.requestId !== 'string'
                || !REQUEST_ID_PATTERN.test(message.requestId)
                || !isRecord(message.payload)) {
                this.protocolFailure('Hermes broker sent an invalid protocol message.');
                return;
            }
            const pending = this.pending.get(message.requestId);
            if (pending) {
                if (!isBridgeStatus(message.payload)) {
                    this.protocolFailure('Hermes broker sent an invalid handshake response.');
                    return;
                }
                this.settlePending(message.requestId, message.payload);
            } else if (message.payload.kind === 'status' && isBridgeStatus(message.payload.status)) {
                this.update(message.payload.status);
            } else if (message.payload.kind === 'prompt-event'
                && typeof message.payload.type === 'string'
                && (message.payload.text === undefined
                    || (typeof message.payload.text === 'string' && message.payload.text.length <= MAX_FRAME_BYTES))) {
                this.client?.onPromptEvent({
                    requestId: message.requestId,
                    type: message.payload.type,
                    ...(typeof message.payload.text === 'string' ? { text: message.payload.text } : {})
                });
            } else {
                this.protocolFailure('Hermes broker sent an unsupported protocol message.');
                return;
            }
        }
    }

    protected write(message: object): void {
        if (!this.socket?.writable) {
            throw new Error('Hermes broker is unavailable.');
        }
        this.socket.write(`${JSON.stringify(message)}\n`);
    }

    protected update(status: HermesBridgeStatus): HermesBridgeStatus {
        this.current = status;
        this.client?.onStatus(status);
        return status;
    }

    protected withinRateLimit(timestamps: number[], limit: number): boolean {
        const now = Date.now();
        while (timestamps.length > 0 && timestamps[0] <= now - RATE_WINDOW_MS) {
            timestamps.shift();
        }
        if (timestamps.length >= limit) {
            return false;
        }
        timestamps.push(now);
        return true;
    }

    protected settlePending(requestId: string, value: unknown): void {
        const pending = this.pending.get(requestId);
        if (!pending) {
            return;
        }
        clearTimeout(pending.timeout);
        this.pending.delete(requestId);
        pending.resolve(value);
    }

    protected disconnectedStatus(detail: string): HermesBridgeStatus {
        return { ...this.current, connected: false, compatible: false, detail };
    }

    protected protocolFailure(detail: string): void {
        this.update(this.disconnectedStatus(detail));
        this.disconnect();
    }

    protected disconnect(): void {
        this.socket?.destroy();
        this.socket = undefined;
        this.buffer = '';
        this.incomingMessageTimes = [];
        this.promptTimes = [];
        for (const [requestId, pending] of this.pending) {
            clearTimeout(pending.timeout);
            this.pending.delete(requestId);
            pending.resolve(this.disconnectedStatus('Hermes Desktop connection closed.'));
        }
    }
}

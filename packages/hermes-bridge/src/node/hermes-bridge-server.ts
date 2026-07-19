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

@injectable()
export class HermesBridgeServerImpl implements HermesBridgeServer {
    protected client: HermesBridgeClient | undefined;
    protected socket: net.Socket | undefined;
    protected buffer = '';
    protected pending = new Map<string, (value: unknown) => void>();
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
        this.socket?.destroy();
        const endpoint = process.env.HERMES_STUDIO_ENDPOINT;
        const token = process.env.HERMES_STUDIO_TOKEN;
        if (!endpoint || !token) {
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
            socket.once('error', error => resolve(this.update({
                ...this.current,
                connected: false,
                detail: error.message
            })));
            this.pending.set(requestId, value => resolve(this.update(value as HermesBridgeStatus)));
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
                return;
            }
            const raw = this.buffer.slice(0, newline);
            this.buffer = this.buffer.slice(newline + 1);
            const message = JSON.parse(raw);
            const pending = this.pending.get(message.requestId);
            if (pending) {
                this.pending.delete(message.requestId);
                pending(message.payload);
            } else if (message.payload?.kind === 'status') {
                this.update(message.payload.status);
            } else if (message.payload?.kind === 'prompt-event') {
                this.client?.onPromptEvent(message.payload);
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
}

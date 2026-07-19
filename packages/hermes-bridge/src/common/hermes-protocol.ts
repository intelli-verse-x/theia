// *****************************************************************************
// Copyright (C) 2026 Intelliverse X and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const HERMES_BRIDGE_PATH = '/services/hermes-bridge';
export const HERMES_PROTOCOL_VERSION = 1;
export const HermesBridgeServer = Symbol('HermesBridgeServer');
export const HERMES_COMMAND_IDS = [
    'hermes.askSelection',
    'hermes.agentWindow',
    'hermes.routeStatus',
    'hermes.reconnect'
] as const;

export type HermesRoute = 'local' | 'cloud' | 'offline';
export type HermesTrust = 'restricted' | 'trusted';

export interface HermesBridgeIdentity {
    sessionId: string;
    windowId: string;
    workspaceCanonicalPath: string;
}

export interface HermesRouteStatus {
    route: HermesRoute;
    localOnly: boolean;
    detail: string;
}

export interface HermesContext {
    uri: string;
    languageId: string;
    text: string;
    startLine: number;
    endLine: number;
    diagnostics: Array<{ message: string; severity: number; line: number }>;
}

export interface HermesPromptRequest {
    requestId: string;
    text: string;
    modality: 'text' | 'voice';
    context?: HermesContext;
}

export interface HermesWorkspaceEditReview {
    editId: string;
    reviewDigest: string;
    accepted: boolean;
}

export interface HermesBridgeStatus {
    connected: boolean;
    compatible: boolean;
    protocolVersion: number;
    identity?: HermesBridgeIdentity;
    route: HermesRouteStatus;
    trust: HermesTrust;
    detail: string;
}

export interface HermesBridgeClient {
    onStatus(status: HermesBridgeStatus): void;
    onPromptEvent(event: { requestId: string; type: string; text?: string }): void;
}

export interface HermesBridgeServer {
    setClient(client: HermesBridgeClient | undefined): void;
    status(): Promise<HermesBridgeStatus>;
    reconnect(): Promise<HermesBridgeStatus>;
    submitPrompt(request: HermesPromptRequest): Promise<void>;
    submitWorkspaceEditReview(review: HermesWorkspaceEditReview): Promise<void>;
}

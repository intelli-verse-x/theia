// *****************************************************************************
// Copyright (C) 2026 Intelliverse X and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Command, CommandContribution, CommandRegistry, MessageService } from '@theia/core';
import { FrontendApplicationContribution, WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { EditorManager } from '@theia/editor/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    HERMES_BRIDGE_PATH,
    HERMES_COMMAND_IDS,
    HermesBridgeClient,
    HermesBridgeServer,
    HermesBridgeStatus
} from '../common/hermes-protocol';

export namespace HermesCommands {
    export const ASK_SELECTION: Command = { id: HERMES_COMMAND_IDS[0], label: 'Hermes: Ask About Selection' };
    export const AGENT_WINDOW: Command = { id: HERMES_COMMAND_IDS[1], label: 'Hermes: Agent Session' };
    export const ROUTE_STATUS: Command = { id: HERMES_COMMAND_IDS[2], label: 'Hermes: Show Adaptive Route' };
    export const RECONNECT: Command = { id: HERMES_COMMAND_IDS[3], label: 'Hermes: Reconnect Desktop Session' };
}

@injectable()
export class HermesBridgeContribution implements CommandContribution, FrontendApplicationContribution, HermesBridgeClient {
    protected readonly server: HermesBridgeServer;
    protected status: HermesBridgeStatus | undefined;

    @inject(EditorManager)
    protected readonly editors: EditorManager;

    @inject(MessageService)
    protected readonly messages: MessageService;

    constructor(@inject(WebSocketConnectionProvider) provider: WebSocketConnectionProvider) {
        this.server = provider.createProxy<HermesBridgeServer>(HERMES_BRIDGE_PATH, this);
    }

    onStart(): void {
        this.server.status().then(status => this.onStatus(status)).catch(error => this.messages.error(String(error)));
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(HermesCommands.ASK_SELECTION, {
            execute: async () => {
                const current = this.editors.currentEditor;
                if (!current) {
                    return this.messages.info('Open an editor and select context first.');
                }
                const selection = current.editor.selection;
                const text = current.editor.document.getText(selection).slice(0, 50000);
                await this.server.submitPrompt({
                    requestId: crypto.randomUUID(),
                    text: 'Help me with the selected editor context.',
                    modality: 'text',
                    context: {
                        uri: current.editor.uri.toString(),
                        languageId: current.editor.document.languageId,
                        text,
                        startLine: selection.start.line,
                        endLine: selection.end.line,
                        diagnostics: []
                    }
                });
            }
        });
        commands.registerCommand(HermesCommands.AGENT_WINDOW, {
            execute: () => this.messages.info(this.status?.detail ?? 'Hermes session is connecting.')
        });
        commands.registerCommand(HermesCommands.ROUTE_STATUS, {
            execute: () => this.messages.info(`Hermes route: ${this.status?.route.route ?? 'offline'}${this.status?.route.localOnly ? ' (local-only)' : ''}`)
        });
        commands.registerCommand(HermesCommands.RECONNECT, {
            execute: () => this.server.reconnect()
        });
    }

    onStatus(status: HermesBridgeStatus): void {
        this.status = status;
    }

    onPromptEvent(event: { requestId: string; type: string; text?: string }): void {
        if (event.type === 'error') {
            this.messages.error(event.text ?? 'Hermes request failed.').catch(() => undefined);
        }
    }
}

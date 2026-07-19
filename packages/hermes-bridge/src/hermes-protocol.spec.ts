// *****************************************************************************
// Copyright (C) 2026 Intelliverse X and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { HERMES_COMMAND_IDS, HERMES_PROTOCOL_VERSION, HermesBridgeStatus } from './common/hermes-protocol';
import { HermesBridgeServerImpl } from './node/hermes-bridge-server';

class TestHermesBridgeServer extends HermesBridgeServerImpl {
    consumeFrame(data: string): void {
        this.consume(data);
    }

    detail(): string {
        return this.current.detail;
    }

    awaitHandshake(requestId: string): Promise<unknown> {
        return new Promise(resolve => {
            this.pending.set(requestId, { resolve, timeout: setTimeout(() => undefined, 1000) });
        });
    }
}

describe('Hermes bridge contract', () => {
    it('pins protocol v1 and exposes no approval command', () => {
        expect(HERMES_PROTOCOL_VERSION).to.equal(1);
        expect(HERMES_COMMAND_IDS).to.deep.equal([
            'hermes.askSelection',
            'hermes.agentWindow',
            'hermes.routeStatus',
            'hermes.reconnect'
        ]);
        expect(HERMES_COMMAND_IDS.some(id => /approve|shell|secret|policy/i.test(id))).to.equal(false);
    });

    it('fails closed on malformed or oversized broker frames', () => {
        const malformed = new TestHermesBridgeServer();
        malformed.consumeFrame('not-json\n');
        expect(malformed.detail()).to.equal('Hermes broker sent malformed JSON.');

        const oversized = new TestHermesBridgeServer();
        oversized.consumeFrame('x'.repeat(1024 * 1024 + 1));
        expect(oversized.detail()).to.equal('Hermes broker frame exceeds the 1 MiB limit.');
    });

    it('accepts the exact Desktop handshake response schema', async () => {
        const server = new TestHermesBridgeServer();
        const requestId = '9d89f8bc-0e78-6690-fb5e-63de64826a14';
        const status: HermesBridgeStatus = {
            connected: true,
            compatible: true,
            protocolVersion: HERMES_PROTOCOL_VERSION,
            identity: { sessionId: 'session', windowId: 'window', workspaceCanonicalPath: '/workspace' },
            route: { route: 'local', localOnly: true, detail: 'Local route.' },
            trust: 'restricted',
            detail: 'Authenticated Hermes Desktop broker connected.'
        };
        const response = server.awaitHandshake(requestId);
        server.consumeFrame(`${JSON.stringify({ protocolVersion: 1, requestId, payload: status })}\n`);
        expect(await response).to.deep.equal(status);
    });
});

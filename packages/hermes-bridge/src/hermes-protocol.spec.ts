// *****************************************************************************
// Copyright (C) 2026 Intelliverse X and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { HERMES_COMMAND_IDS, HERMES_PROTOCOL_VERSION } from './common/hermes-protocol';
import { HermesBridgeServerImpl } from './node/hermes-bridge-server';

class TestHermesBridgeServer extends HermesBridgeServerImpl {
    consumeFrame(data: string): void {
        this.consume(data);
    }

    detail(): string {
        return this.current.detail;
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
});

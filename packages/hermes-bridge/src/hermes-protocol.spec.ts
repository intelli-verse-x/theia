// *****************************************************************************
// Copyright (C) 2026 Intelliverse X and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { HERMES_COMMAND_IDS, HERMES_PROTOCOL_VERSION } from './common/hermes-protocol';

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
});

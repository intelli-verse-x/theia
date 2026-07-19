// *****************************************************************************
// Copyright (C) 2026 Intelliverse X and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { ContainerModule } from '@theia/core/shared/inversify';
import { HERMES_BRIDGE_PATH, HermesBridgeClient, HermesBridgeServer } from '../common/hermes-protocol';
import { HermesBridgeServerImpl } from './hermes-bridge-server';

export default new ContainerModule(bind => {
    bind(HermesBridgeServerImpl).toSelf().inSingletonScope();
    bind(ConnectionHandler).toDynamicValue(context =>
        new RpcConnectionHandler<HermesBridgeClient>(HERMES_BRIDGE_PATH, client => {
            const server = context.container.get(HermesBridgeServerImpl);
            server.setClient(client);
            server.reconnect().catch(() => undefined);
            return server;
        })
    ).inSingletonScope();
    bind(HermesBridgeServer).toService(HermesBridgeServerImpl);
});

// *****************************************************************************
// Copyright (C) 2026 Intelliverse X and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CommandContribution } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ContainerModule } from '@theia/core/shared/inversify';
import { HermesBridgeContribution } from './hermes-bridge-contribution';

export default new ContainerModule(bind => {
    bind(HermesBridgeContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(HermesBridgeContribution);
    bind(FrontendApplicationContribution).toService(HermesBridgeContribution);
});

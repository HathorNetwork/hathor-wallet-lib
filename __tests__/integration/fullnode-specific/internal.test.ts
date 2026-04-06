/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade internal method tests.
 *
 * Tests HathorWallet-only features: debug mode toggling and storage reload
 * via onConnectionChangedState. These are side-effect tests that mutate
 * wallet state.
 *
 * Shared internal tests live in `shared/internal.test.ts`.
 * Shared server change tests live in `shared/server_changes.test.ts`.
 */

import HathorWallet from '../../../src/new/wallet';
import { ConnectionState } from '../../../src/wallet/types';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper } from '../helpers/wallet.helper';

describe('[Fullnode] internal methods', () => {
  let gWallet: HathorWallet;
  let hWallet: HathorWallet;

  beforeAll(async () => {
    const { hWallet: ghWallet } = await GenesisWalletHelper.getSingleton();
    gWallet = ghWallet;
    hWallet = await generateWalletHelper();
  });

  afterAll(async () => {
    await hWallet.stop();
  });

  it('should test the debug methods', async () => {
    expect(gWallet.debug).toStrictEqual(false);

    gWallet.enableDebugMode();
    expect(gWallet.debug).toStrictEqual(true);

    gWallet.disableDebugMode();
    expect(gWallet.debug).toStrictEqual(false);
  });

  it('should call processHistory when connection state changes to CONNECTED', async () => {
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const spy = jest.spyOn(hWallet.storage, 'processHistory');
    // Simulate that we received an event of the connection becoming active
    await hWallet.onConnectionChangedState(ConnectionState.CONNECTED);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

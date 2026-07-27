/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import walletUtils from '../../src/utils/wallet';
import { deriveAddressFromDataP2SH } from '../../src/utils/address';
import { multisigWalletsData } from '../integration/helpers/wallet-precalculation.helper';
import { WALLET_CONSTANTS } from '../integration/configuration/test-constants';

/**
 * Locks the committed multisig address fixture against live derivation.
 *
 * The integration suite injects `WALLET_CONSTANTS.multisig.addresses` into
 * several wallets, and injected indexes skip derivation — so a regression in the
 * redeem script or in P2SH address derivation would leave those suites green.
 * This runs in the unit suite (no fullnode) and rebuilds the fixture from the
 * seed, pubkeys and numSignatures that produce it.
 */
describe('multisig fixture derivation', () => {
  const NUM_SIGNATURES = 3;

  it('derives the committed multisig addresses from the seed and pubkeys', async () => {
    const accessData = walletUtils.generateAccessDataFromSeed(multisigWalletsData.words[0], {
      multisig: {
        pubkeys: multisigWalletsData.pubkeys,
        numSignatures: NUM_SIGNATURES,
      },
      pin: '123',
      password: '456',
      networkName: 'testnet',
    });

    expect(accessData.multisigData).toBeDefined();

    for (let i = 0; i < 5; ++i) {
      const derived = deriveAddressFromDataP2SH(accessData.multisigData!, i, 'testnet');
      expect(derived.base58).toStrictEqual(WALLET_CONSTANTS.multisig.addresses[i]);
    }
  });

  it('pins the multisig parameters the fixture depends on', () => {
    // A different pubkey set or threshold produces a different address set, so
    // the fixture is only meaningful alongside these.
    expect(multisigWalletsData.pubkeys).toHaveLength(5);
    expect(NUM_SIGNATURES).toBe(3);
  });
});

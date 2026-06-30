/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade mintTokens tests.
 *
 * Covers the `data` / `unshiftData` options of `mintTokens()`, which append a
 * data-script output to the mint transaction. The wallet-service
 * `prepareMintTokensData()` does not accept these options, so this behavior
 * cannot be exercised on that facade.
 *
 * Shared mintTokens tests live in `shared/token-authority.test.ts`.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from '../helpers/wallet.helper';

// `script` of a 'foobar' data output: [len(6), f, o, o, b, a, r, OP_CHECKSIG(172)]
const FOOBAR_DATA_SCRIPT = Buffer.from([6, 102, 111, 111, 98, 97, 114, 172]);

describe('[Fullnode] mintTokens data outputs', () => {
  afterAll(async () => {
    await stopAllWallets();
  });

  it('should append a data-script output when minting with data', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Data Mint Token', 'DMTK', 100n);

    // By default the data output is appended at the end of the output list.
    const mintResponse = await hWallet.mintTokens(tokenUid, 100n, { data: ['foobar'] });
    expect(mintResponse!.hash).toBeDefined();
    await waitForTxReceived(hWallet, mintResponse!.hash!);

    const dataOutput = mintResponse!.outputs[mintResponse!.outputs.length - 1];
    expect(dataOutput).toHaveProperty('value', 1n);
    expect(dataOutput).toHaveProperty('script', FOOBAR_DATA_SCRIPT);

    // With unshiftData the data output is placed at the start of the output list.
    await waitUntilNextTimestamp(hWallet, mintResponse!.hash!);
    const mintResponse2 = await hWallet.mintTokens(tokenUid, 100n, {
      unshiftData: true,
      data: ['foobar'],
    });
    expect(mintResponse2!.hash).toBeDefined();
    await waitForTxReceived(hWallet, mintResponse2!.hash!);

    const dataOutput2 = mintResponse2!.outputs[0];
    expect(dataOutput2).toHaveProperty('value', 1n);
    expect(dataOutput2).toHaveProperty('script', FOOBAR_DATA_SCRIPT);
  });
});

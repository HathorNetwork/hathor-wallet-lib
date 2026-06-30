/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade mintTokens tests.
 *
 * Covers fullnode-only mint behavior:
 * - The `data` / `unshiftData` options, which append a data-script output to the
 *   mint transaction. The wallet-service `prepareMintTokensData()` does not
 *   accept these options.
 * - The raw mint-transaction shape for a FEE token (per-output `tokenData` /
 *   `value` and the fee header). The wallet-service `mintTokens()` returns a
 *   differently-shaped response, so the structural assertions below are
 *   fullnode-specific; the cross-facade economic effect (flat 1 HTR fee) is
 *   covered in `shared/token-authority.test.ts`.
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
import { TOKEN_MINT_MASK, TOKEN_AUTHORITY_MASK } from '../../../src/constants';
import { TokenVersion } from '../../../src/types';
import FeeHeader from '../../../src/headers/fee';
import Header from '../../../src/headers/base';

// `script` of a 'foobar' data output: [len(6), f, o, o, b, a, r, OP_CHECKSIG(172)]
const FOOBAR_DATA_SCRIPT = Buffer.from([6, 102, 111, 111, 98, 97, 114, 172]);

/** Asserts the tx carries exactly one fee header with a single entry of `expectedFee`. */
function validateFeeAmount(headers: Header[], expectedFee: bigint) {
  const feeHeaders = headers.filter(h => h instanceof FeeHeader);
  expect(feeHeaders).toHaveLength(1);
  const { entries } = feeHeaders[0] as FeeHeader;
  expect(entries).toHaveLength(1);
  expect(entries[0].tokenIndex).toBe(0);
  expect(entries[0].amount).toBe(expectedFee);
}

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

describe('[Fullnode] mintTokens FEE-token tx shape', () => {
  afterAll(async () => {
    await stopAllWallets();
  });

  it('should build the mint tx outputs and charge a flat fee header', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);

    // FEE-token creation charges a flat 1 HTR: 10 − 1 = 9 HTR available.
    const { hash: fbtUid } = await createTokenHelper(hWallet, 'FeeBasedToken', 'FBT', 8582n, {
      tokenVersion: TokenVersion.FEE,
    });

    // Minting a single unit charges the flat 1 HTR fee. The resulting tx carries:
    //   - the HTR change output (tokenData 0), 9 − 1 = 8 HTR;
    //   - the minted-token output (tokenData 1) with the minted value;
    //   - a fresh mint authority output (tokenData TOKEN_AUTHORITY_MASK | 1).
    const mint1 = await hWallet.mintTokens(fbtUid, 1n);
    expect(mint1!.hash).toBeDefined();
    await waitForTxReceived(hWallet, mint1!.hash!);

    expect(mint1!.tokens).toHaveLength(1);
    expect(mint1!.tokens[0]).toBe(fbtUid);
    expect(mint1!.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tokenData: 0, value: 8n }),
        expect.objectContaining({ tokenData: 1, value: 1n }),
        expect.objectContaining({ tokenData: TOKEN_AUTHORITY_MASK + 1, value: TOKEN_MINT_MASK }),
      ])
    );
    validateFeeAmount(mint1!.headers, 1n);

    // Minting a large amount still charges the same flat 1 HTR fee, and the
    // minted-token output carries the full amount.
    await waitUntilNextTimestamp(hWallet, mint1!.hash!);
    const mint2 = await hWallet.mintTokens(fbtUid, 5000n);
    expect(mint2!.hash).toBeDefined();
    await waitForTxReceived(hWallet, mint2!.hash!);

    expect(mint2!.tokens).toHaveLength(1);
    expect(mint2!.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tokenData: 1, value: 5000n }),
        expect.objectContaining({ tokenData: TOKEN_AUTHORITY_MASK + 1, value: TOKEN_MINT_MASK }),
      ])
    );
    validateFeeAmount(mint2!.headers, 1n);
  });
});

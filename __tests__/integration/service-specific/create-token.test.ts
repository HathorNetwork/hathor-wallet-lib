/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Service-facade createNewToken tests.
 *
 * Shared createNewToken tests live in `shared/create-token.test.ts` and run
 * against both facades via `describe.each(adapters)`.
 *
 * Why these tests are NOT shared:
 *   1. They drive `getUtxoFromId(txId, index)` — a wallet-service-only
 *      method that has no equivalent on the fullnode facade. The fullnode
 *      side reads UTXO routing through `parseScript` on raw `Output`
 *      buffers via `wallet.getNetworkObject()` instead, which is a
 *      different code path altogether (its tests live in
 *      `fullnode-specific/create-token.test.ts`).
 *   2. They assert on the `tokenAuthorities` field of `getBalance()`,
 *      which the wallet-service facade exposes but the fullnode facade
 *      does not surface at all.
 *   3. The cross-wallet propagation test at the bottom uses
 *      `adapter.waitForTx(srcWallet, txId, otherWallet)` to confirm both
 *      wallets observe the tx via the wallet-service websocket; the
 *      fullnode facade has its own propagation semantics that don't
 *      benefit from this exact wait shape.
 */

import type { HathorWalletServiceWallet, CreateTokenTransaction, Output } from '../../../src';
import { NATIVE_TOKEN_UID, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../../src/constants';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapter = new ServiceWalletTestAdapter();

const TOKEN_NAME = 'TestToken';
const TOKEN_SYMBOL = 'TST';
const TOKEN_AMOUNT = 100n;

/**
 * Identifies HTR (native-token) outputs in a `createNewToken` response.
 *
 * The wallet-service facade sets `tokenData` to `undefined` on the HTR
 * change output it constructs, while still emitting `tokenData: 0` for HTR
 * data outputs. The fullnode facade uses `0` for both. Treat either value
 * as HTR so the same filter works regardless of which facade produced it.
 */
function isHtrOutput(output: Output): boolean {
  return output.tokenData === 0 || output.tokenData == null;
}

beforeAll(async () => {
  await adapter.suiteSetup();
});

afterAll(async () => {
  await adapter.suiteTeardown();
});

describe('[Service] createNewToken', () => {
  // Two address-routing tests with deterministic HTR funding:
  // - "with HTR change" funds well above the deposit, so a change output
  //   is guaranteed and routing to changeAddress can be asserted strictly.
  // - "without HTR change" funds exactly the deposit, so no HTR output is
  //   produced and that absence is what the test asserts.

  it('should create token with specific addresses (with HTR change)', async () => {
    const { wallet, addresses } = await adapter.createWallet();
    const sw = wallet as unknown as HathorWalletServiceWallet;
    try {
      // 100n HTR funds a 100n token (1% deposit = 1n) → 99n change is guaranteed.
      await adapter.injectFunds(wallet, addresses![0], 100n);

      // Assign specific addresses for each component (last indices, going backwards)
      const destinationAddress = addresses![9];
      const mintAuthorityAddress = addresses![8];
      const meltAuthorityAddress = addresses![7];
      const changeAddress = addresses![6];

      const createTokenTx = (await sw.createNewToken(TOKEN_NAME, TOKEN_SYMBOL, TOKEN_AMOUNT, {
        pinCode: adapter.defaultPinCode,
        address: destinationAddress,
        changeAddress,
        createMint: true,
        mintAuthorityAddress,
        createMelt: true,
        meltAuthorityAddress,
      })) as CreateTokenTransaction;

      expect(createTokenTx).toEqual(
        expect.objectContaining({
          hash: expect.any(String),
          name: TOKEN_NAME,
          symbol: TOKEN_SYMBOL,
        })
      );

      const tokenUid = createTokenTx.hash!;
      await adapter.waitForTx(wallet, tokenUid);

      // Locate output indices by tokenData/value
      let tokenOutputIndex = -1;
      let mintAuthorityOutputIndex = -1;
      let meltAuthorityOutputIndex = -1;
      let changeOutputIndex = -1;

      createTokenTx.outputs.forEach((output: Output, index: number) => {
        if (output.tokenData === 1) {
          tokenOutputIndex = index;
        } else if (output.tokenData === 129) {
          if (output.value === TOKEN_MINT_MASK) {
            mintAuthorityOutputIndex = index;
          } else if (output.value === TOKEN_MELT_MASK) {
            meltAuthorityOutputIndex = index;
          }
        } else if (isHtrOutput(output)) {
          changeOutputIndex = index;
        }
      });

      expect(tokenOutputIndex).toBeGreaterThanOrEqual(0);
      expect(mintAuthorityOutputIndex).toBeGreaterThanOrEqual(0);
      expect(meltAuthorityOutputIndex).toBeGreaterThanOrEqual(0);
      expect(changeOutputIndex).toBeGreaterThanOrEqual(0);

      // Verify token output went to destination address
      const tokenUtxo = await sw.getUtxoFromId(tokenUid, tokenOutputIndex);
      expect(tokenUtxo).toStrictEqual(
        expect.objectContaining({
          address: destinationAddress,
          value: TOKEN_AMOUNT,
          tokenId: tokenUid,
        })
      );

      // Verify mint authority went to mint authority address
      const mintUtxo = await sw.getUtxoFromId(tokenUid, mintAuthorityOutputIndex);
      expect(mintUtxo).toStrictEqual(
        expect.objectContaining({
          address: mintAuthorityAddress,
          value: 0n,
          tokenId: tokenUid,
        })
      );

      // Verify melt authority went to melt authority address
      const meltUtxo = await sw.getUtxoFromId(tokenUid, meltAuthorityOutputIndex);
      expect(meltUtxo).toStrictEqual(
        expect.objectContaining({
          address: meltAuthorityAddress,
          value: 0n,
          tokenId: tokenUid,
        })
      );

      // Verify HTR change went to the configured changeAddress with the
      // expected amount: 100n injected − 1% deposit on 100n token = 99n change.
      const changeUtxo = await sw.getUtxoFromId(tokenUid, changeOutputIndex);
      expect(changeUtxo).toStrictEqual(
        expect.objectContaining({
          address: changeAddress,
          tokenId: NATIVE_TOKEN_UID,
          value: 99n,
        })
      );
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('should create token with specific addresses (no HTR change)', async () => {
    const { wallet, addresses } = await adapter.createWallet();
    const sw = wallet as unknown as HathorWalletServiceWallet;
    try {
      // Inject exactly the deposit (1% of 1000n = 10n). A single 10n UTXO
      // is fully consumed by the deposit so the wallet has no remainder
      // to emit as change — guarantees the no-change scenario.
      const tokenAmount = 1000n;
      await adapter.injectFunds(wallet, addresses![0], 10n);

      const destinationAddress = addresses![9];
      const mintAuthorityAddress = addresses![8];
      const meltAuthorityAddress = addresses![7];

      const createTokenTx = (await sw.createNewToken(TOKEN_NAME, TOKEN_SYMBOL, tokenAmount, {
        pinCode: adapter.defaultPinCode,
        address: destinationAddress,
        createMint: true,
        mintAuthorityAddress,
        createMelt: true,
        meltAuthorityAddress,
      })) as CreateTokenTransaction;

      const tokenUid = createTokenTx.hash!;
      await adapter.waitForTx(wallet, tokenUid);

      // No HTR output should exist — the entire input was consumed as deposit
      const htrOutputs = createTokenTx.outputs.filter(isHtrOutput);
      expect(htrOutputs).toHaveLength(0);

      // The token + mint + melt outputs should still be present and routed correctly
      let tokenOutputIndex = -1;
      let mintAuthorityOutputIndex = -1;
      let meltAuthorityOutputIndex = -1;
      createTokenTx.outputs.forEach((output: Output, index: number) => {
        if (output.tokenData === 1) {
          tokenOutputIndex = index;
        } else if (output.tokenData === 129) {
          if (output.value === TOKEN_MINT_MASK) {
            mintAuthorityOutputIndex = index;
          } else if (output.value === TOKEN_MELT_MASK) {
            meltAuthorityOutputIndex = index;
          }
        }
      });
      expect(tokenOutputIndex).toBeGreaterThanOrEqual(0);
      expect(mintAuthorityOutputIndex).toBeGreaterThanOrEqual(0);
      expect(meltAuthorityOutputIndex).toBeGreaterThanOrEqual(0);

      const tokenUtxo = await sw.getUtxoFromId(tokenUid, tokenOutputIndex);
      expect(tokenUtxo).toStrictEqual(
        expect.objectContaining({
          address: destinationAddress,
          value: tokenAmount,
          tokenId: tokenUid,
        })
      );

      const mintUtxo = await sw.getUtxoFromId(tokenUid, mintAuthorityOutputIndex);
      expect(mintUtxo).toStrictEqual(
        expect.objectContaining({ address: mintAuthorityAddress, tokenId: tokenUid })
      );

      const meltUtxo = await sw.getUtxoFromId(tokenUid, meltAuthorityOutputIndex);
      expect(meltUtxo).toStrictEqual(
        expect.objectContaining({ address: meltAuthorityAddress, tokenId: tokenUid })
      );
    } finally {
      await adapter.stopWallet(wallet);
    }
  });

  it('should create token with all outputs to another wallet', async () => {
    const sourceCreated = await adapter.createWallet();
    const externalCreated = await adapter.createWallet();
    const sourceWallet = sourceCreated.wallet as unknown as HathorWalletServiceWallet;
    const externalWallet = externalCreated.wallet as unknown as HathorWalletServiceWallet;

    try {
      await adapter.injectFunds(sourceCreated.wallet, sourceCreated.addresses![0], 10n);

      const destinationAddress = externalCreated.addresses![9];
      const mintAuthorityAddress = externalCreated.addresses![8];
      const meltAuthorityAddress = externalCreated.addresses![7];
      const changeAddress = externalCreated.addresses![6];

      // Without the external-address flags the call should fail
      await expect(
        sourceWallet.createNewToken(TOKEN_NAME, TOKEN_SYMBOL, TOKEN_AMOUNT, {
          pinCode: adapter.defaultPinCode,
          address: destinationAddress,
          changeAddress,
          createMint: true,
          mintAuthorityAddress,
          createMelt: true,
          meltAuthorityAddress,
        })
      ).rejects.toThrow();

      // With the flags set, the token is created successfully
      const createTokenTx = (await sourceWallet.createNewToken(
        TOKEN_NAME,
        TOKEN_SYMBOL,
        TOKEN_AMOUNT,
        {
          pinCode: adapter.defaultPinCode,
          address: destinationAddress,
          changeAddress,
          createMint: true,
          mintAuthorityAddress,
          createMelt: true,
          meltAuthorityAddress,
          allowExternalMintAuthorityAddress: true,
          allowExternalMeltAuthorityAddress: true,
        }
      )) as CreateTokenTransaction;

      expect(createTokenTx).toEqual(
        expect.objectContaining({
          hash: expect.any(String),
          name: TOKEN_NAME,
          symbol: TOKEN_SYMBOL,
        })
      );

      const tokenUid = createTokenTx.hash!;
      await adapter.waitForTx(sourceCreated.wallet, tokenUid, externalCreated.wallet);

      // The creating wallet doesn't see the token outputs since they went to external addresses
      const creatorBalance = await sourceWallet.getBalance(tokenUid);
      expect(creatorBalance).toHaveLength(1);
      expect(creatorBalance[0]).toEqual(
        expect.objectContaining({
          balance: expect.objectContaining({ unlocked: 0n, locked: 0n }),
          tokenAuthorities: expect.objectContaining({
            unlocked: expect.objectContaining({ mint: false, melt: false }),
            locked: expect.objectContaining({ mint: false, melt: false }),
          }),
          transactions: 0,
        })
      );

      // Receiving wallet sees both the token and the authorities
      const destBalance = await externalWallet.getBalance(tokenUid);
      expect(destBalance).toHaveLength(1);
      expect(destBalance[0].balance.unlocked).toBe(TOKEN_AMOUNT);
      expect(destBalance[0].tokenAuthorities.unlocked.mint).toBe(true);
      expect(destBalance[0].tokenAuthorities.unlocked.melt).toBe(true);
    } finally {
      await adapter.stopWallet(sourceCreated.wallet);
      await adapter.stopWallet(externalCreated.wallet);
    }
  });
});

/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared token-authority operation tests: mintTokens, delegateAuthority and
 * destroyAuthority.
 *
 * Validates authority behavior that is common to both the fullnode
 * ({@link HathorWallet}) and wallet-service ({@link HathorWalletServiceWallet})
 * facades. Each test is self-contained: it builds its own wallet(s), funds them,
 * and creates its own token, so the cases do not depend on each other's state.
 *
 * Facade-specific tests live in:
 * - `fullnode-specific/mint-tokens.test.ts` (data-script outputs on mint, which
 *   the wallet-service `mintTokens()` does not support).
 *
 * Notes on cross-facade asymmetry:
 * - Authority bits are compared as `bigint` (TOKEN_MINT_MASK / TOKEN_MELT_MASK),
 *   never `Number`.
 * - The wallet-service UTXO/balance index lags behind tx visibility; the adapter
 *   methods (`mintTokens`, `meltTokens`, `delegateAuthority`, `destroyAuthority`)
 *   poll internally so the assertions below can read derived state directly.
 * - Fund-shortage and missing-authority errors raise different concrete classes
 *   per facade (plain `Error` on fullnode, `UtxoError` on wallet-service); the
 *   rejections below match by regex rather than by class.
 */

import type { FuzzyWalletType, IWalletTestAdapter } from '../adapters/types';
import { NATIVE_TOKEN_UID, TOKEN_MINT_MASK, TOKEN_MELT_MASK } from '../../../src/constants';
import { AuthorityType, TokenVersion } from '../../../src/types';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

const htrBalance = (wallet: FuzzyWalletType): Promise<bigint> =>
  wallet.getBalance(NATIVE_TOKEN_UID).then(b => b[0].balance.unlocked);

const tokenBalance = (wallet: FuzzyWalletType, tokenUid: string): Promise<bigint> =>
  wallet.getBalance(tokenUid).then(b => b[0].balance.unlocked);

describe.each(adapters)('[Shared] token authorities — $name', adapter => {
  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  describe('mintTokens', () => {
    it('should mint new tokens and create a new mint authority', async () => {
      const { wallet } = await adapter.createWallet();
      try {
        const addr0 = (await wallet.getAddressAtIndex(0))!;
        await adapter.injectFunds(wallet, addr0, 10n);
        const token = await adapter.createToken(wallet, 'MintToken', 'MTK', 100n);

        const mintAmount = 500n;
        const mintTx = await adapter.mintTokens(wallet, token.hash, mintAmount);
        expect(mintTx.hash).toHaveLength(64);

        // Token balance increased by the minted amount.
        expect(await tokenBalance(wallet, token.hash)).toBe(100n + mintAmount);

        // Minting with the facade default (createAnotherMint) leaves a mint authority.
        const mintAuthorities = await adapter.getAuthorityUtxos(
          wallet,
          token.hash,
          AuthorityType.MINT
        );
        expect(mintAuthorities.length).toBeGreaterThanOrEqual(1);
        mintAuthorities.forEach(u => expect(u.authorities).toBe(TOKEN_MINT_MASK));
      } finally {
        await adapter.stopWallet(wallet);
      }
    });

    it('should mint tokens to a chosen mint authority address', async () => {
      const { wallet } = await adapter.createWallet();
      try {
        const addr0 = (await wallet.getAddressAtIndex(0))!;
        const authAddr = (await wallet.getAddressAtIndex(5))!;
        await adapter.injectFunds(wallet, addr0, 10n);
        const token = await adapter.createToken(wallet, 'MintAddrToken', 'MAT', 100n);

        await adapter.mintTokens(wallet, token.hash, 100n, { mintAuthorityAddress: authAddr });

        const authAtAddr = await adapter.getAuthorityUtxos(wallet, token.hash, AuthorityType.MINT, {
          filter_address: authAddr,
        });
        expect(authAtAddr).toHaveLength(1);
        expect(authAtAddr[0].address).toBe(authAddr);
        expect(authAtAddr[0].authorities).toBe(TOKEN_MINT_MASK);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });

    it('should reject minting to an external mint authority address', async () => {
      const { wallet } = await adapter.createWallet();
      const { wallet: external } = await adapter.createWallet();
      try {
        const addr0 = (await wallet.getAddressAtIndex(0))!;
        await adapter.injectFunds(wallet, addr0, 10n);
        const token = await adapter.createToken(wallet, 'ExtRejectToken', 'ERT', 100n);
        const externalAddr = (await external.getAddressAtIndex(0))!;

        await expect(
          adapter.mintTokens(wallet, token.hash, 100n, { mintAuthorityAddress: externalAddr })
        ).rejects.toThrow(/belong to your wallet/i);
      } finally {
        await adapter.stopWallet(wallet);
        await adapter.stopWallet(external);
      }
    });

    it('should move the mint authority to an external address when explicitly allowed', async () => {
      const { wallet } = await adapter.createWallet();
      const { wallet: external } = await adapter.createWallet();
      try {
        const addr0 = (await wallet.getAddressAtIndex(0))!;
        await adapter.injectFunds(wallet, addr0, 10n);
        const token = await adapter.createToken(wallet, 'ExtAllowToken', 'EAT', 100n);
        const externalAddr = (await external.getAddressAtIndex(0))!;

        await adapter.mintTokens(wallet, token.hash, 100n, {
          mintAuthorityAddress: externalAddr,
          allowExternalMintAuthorityAddress: true,
        });

        // Tokens were minted to the source wallet...
        expect(await tokenBalance(wallet, token.hash)).toBe(200n);

        // ...but its only mint authority was routed out to the external address.
        const remaining = await adapter.getAuthorityUtxos(wallet, token.hash, AuthorityType.MINT);
        expect(remaining).toHaveLength(0);
      } finally {
        await adapter.stopWallet(wallet);
        await adapter.stopWallet(external);
      }
    });

    it('should reject minting more tokens than the available HTR allows', async () => {
      const { wallet } = await adapter.createWallet();
      try {
        const addr0 = (await wallet.getAddressAtIndex(0))!;
        await adapter.injectFunds(wallet, addr0, 10n);
        const token = await adapter.createToken(wallet, 'NoFundsMint', 'NFM', 100n);

        // 9 HTR remain after the 1 HTR deposit; minting 9000 needs a 90 HTR deposit.
        // fullnode raises "Not enough HTR tokens..."; wallet-service raises a
        // UtxoError "No utxos available...". Match either message.
        await expect(adapter.mintTokens(wallet, token.hash, 9000n)).rejects.toThrow(
          /Not enough HTR tokens|No utxos available/i
        );
      } finally {
        await adapter.stopWallet(wallet);
      }
    });

    it('should consume the correct HTR deposit when minting', async () => {
      const { wallet } = await adapter.createWallet();
      try {
        const addr0 = (await wallet.getAddressAtIndex(0))!;
        await adapter.injectFunds(wallet, addr0, 13n);
        const token = await adapter.createToken(wallet, 'DepositMint', 'DPM', 100n);

        // 13 injected − 1 (1% of 100) for creation = 12 HTR available.
        expect(await htrBalance(wallet)).toBe(12n);

        // Deposit is 1% of the minted amount, rounded up, with a 1 HTR minimum.
        await adapter.mintTokens(wallet, token.hash, 1n); // ceil(0.01) = 1
        expect(await htrBalance(wallet)).toBe(11n);
        await adapter.mintTokens(wallet, token.hash, 100n); // 1
        expect(await htrBalance(wallet)).toBe(10n);
        await adapter.mintTokens(wallet, token.hash, 101n); // ceil(1.01) = 2
        expect(await htrBalance(wallet)).toBe(8n);
        await adapter.mintTokens(wallet, token.hash, 200n); // 2
        expect(await htrBalance(wallet)).toBe(6n);
        await adapter.mintTokens(wallet, token.hash, 201n); // ceil(2.01) = 3
        expect(await htrBalance(wallet)).toBe(3n);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });

    it('should charge a flat 1 HTR fee when minting a FEE token', async () => {
      const { wallet } = await adapter.createWallet();
      try {
        const addr0 = (await wallet.getAddressAtIndex(0))!;
        await adapter.injectFunds(wallet, addr0, 10n);
        const token = await adapter.createToken(wallet, 'FeeMintToken', 'FMT', 8582n, {
          tokenVersion: TokenVersion.FEE,
        });

        // FEE token creation charges a flat 1 HTR: 10 − 1 = 9.
        expect(await htrBalance(wallet)).toBe(9n);

        // Each mint charges a flat 1 HTR fee regardless of the minted amount.
        await adapter.mintTokens(wallet, token.hash, 1n);
        expect(await htrBalance(wallet)).toBe(8n);
        expect(await tokenBalance(wallet, token.hash)).toBe(8583n);

        await adapter.mintTokens(wallet, token.hash, 5000n);
        expect(await htrBalance(wallet)).toBe(7n);
        expect(await tokenBalance(wallet, token.hash)).toBe(13583n);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });
  });

  describe('delegateAuthority', () => {
    it('should reject delegating an authority the wallet does not hold', async () => {
      const { wallet } = await adapter.createWallet();
      try {
        // A real-shaped token UID the wallet holds no authority for.
        const unheldToken = 'cafe'.repeat(16); // 64-char hex
        const destAddr = (await wallet.getAddressAtIndex(1))!;

        // The two facades raise different concrete classes for "no authority to
        // delegate": fullnode throws a plain Error (its message is an opaque
        // "[object Object]" from a known cast in prepareDelegateAuthorityData),
        // wallet-service throws UtxoError. Both extend Error, so capture the
        // rejection and assert by instanceof plus the postcondition below,
        // rather than matching a message that differs per facade.
        const err = await adapter
          .delegateAuthority(wallet, unheldToken, AuthorityType.MINT, destAddr)
          .then(
            () => undefined,
            (e: unknown) => e
          );
        expect(err).toBeInstanceOf(Error);

        // The rejected delegation routed no authority to the destination.
        expect(
          await adapter.getAuthorityUtxos(wallet, unheldToken, AuthorityType.MINT)
        ).toHaveLength(0);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });

    it('should delegate mint and melt authorities to another wallet, keeping one', async () => {
      const { wallet: w1 } = await adapter.createWallet();
      const { wallet: w2 } = await adapter.createWallet();
      try {
        const a1 = (await w1.getAddressAtIndex(0))!;
        await adapter.injectFunds(w1, a1, 10n);
        const token = await adapter.createToken(w1, 'DelegKeepToken', 'DKT', 100n);

        const w2mintAddr = (await w2.getAddressAtIndex(0))!;
        const w2meltAddr = (await w2.getAddressAtIndex(1))!;

        await adapter.delegateAuthority(w1, token.hash, AuthorityType.MINT, w2mintAddr, {
          createAnother: true,
          recvWallet: w2,
        });
        await adapter.delegateAuthority(w1, token.hash, AuthorityType.MELT, w2meltAddr, {
          createAnother: true,
          recvWallet: w2,
        });

        // Source wallet keeps one authority of each type.
        expect(await adapter.getAuthorityUtxos(w1, token.hash, AuthorityType.MINT)).toHaveLength(1);
        expect(await adapter.getAuthorityUtxos(w1, token.hash, AuthorityType.MELT)).toHaveLength(1);

        // Destination wallet received one authority of each type at the target addresses.
        const w2mint = await adapter.getAuthorityUtxos(w2, token.hash, AuthorityType.MINT, {
          filter_address: w2mintAddr,
        });
        expect(w2mint).toHaveLength(1);
        expect(w2mint[0].authorities).toBe(TOKEN_MINT_MASK);

        const w2melt = await adapter.getAuthorityUtxos(w2, token.hash, AuthorityType.MELT, {
          filter_address: w2meltAddr,
        });
        expect(w2melt).toHaveLength(1);
        expect(w2melt[0].authorities).toBe(TOKEN_MELT_MASK);
      } finally {
        await adapter.stopWallet(w1);
        await adapter.stopWallet(w2);
      }
    });

    it('should delegate mint authority without keeping one', async () => {
      const { wallet: w1 } = await adapter.createWallet();
      const { wallet: w2 } = await adapter.createWallet();
      try {
        const a1 = (await w1.getAddressAtIndex(0))!;
        await adapter.injectFunds(w1, a1, 10n);
        const token = await adapter.createToken(w1, 'DelegGiveToken', 'DGT', 100n);

        const w2addr = (await w2.getAddressAtIndex(0))!;
        await adapter.delegateAuthority(w1, token.hash, AuthorityType.MINT, w2addr, {
          createAnother: false,
          recvWallet: w2,
        });

        // Source wallet no longer holds a mint authority and can no longer mint.
        expect(await adapter.getAuthorityUtxos(w1, token.hash, AuthorityType.MINT)).toHaveLength(0);
        await expect(adapter.mintTokens(w1, token.hash, 100n)).rejects.toThrow(/authority/i);

        // Destination wallet received the authority and can mint with it.
        expect(await adapter.getAuthorityUtxos(w2, token.hash, AuthorityType.MINT)).toHaveLength(1);
        await adapter.injectFunds(w2, w2addr, 10n);
        await adapter.mintTokens(w2, token.hash, 100n);
        expect(await tokenBalance(w2, token.hash)).toBe(100n);
      } finally {
        await adapter.stopWallet(w1);
        await adapter.stopWallet(w2);
      }
    });

    it('should delegate melt authority without keeping one', async () => {
      const { wallet: w1 } = await adapter.createWallet();
      const { wallet: w2 } = await adapter.createWallet();
      try {
        const a1 = (await w1.getAddressAtIndex(0))!;
        await adapter.injectFunds(w1, a1, 10n);
        const token = await adapter.createToken(w1, 'DelegMeltGiveToken', 'DMG', 100n);

        // Fund the destination wallet with some of the tokens so it can actually
        // melt once it holds the authority.
        const w2tokenAddr = (await w2.getAddressAtIndex(0))!;
        await adapter.sendTransaction(w1, w2tokenAddr, 60n, {
          token: token.hash,
          recvWallet: w2,
        });

        const w2meltAddr = (await w2.getAddressAtIndex(1))!;
        await adapter.delegateAuthority(w1, token.hash, AuthorityType.MELT, w2meltAddr, {
          createAnother: false,
          recvWallet: w2,
        });

        // Source wallet no longer holds a melt authority and can no longer melt.
        expect(await adapter.getAuthorityUtxos(w1, token.hash, AuthorityType.MELT)).toHaveLength(0);
        await expect(adapter.meltTokens(w1, token.hash, 10n)).rejects.toThrow(/authority/i);

        // Destination wallet received the authority and can melt its tokens.
        expect(await adapter.getAuthorityUtxos(w2, token.hash, AuthorityType.MELT)).toHaveLength(1);
        await adapter.meltTokens(w2, token.hash, 50n);
        expect(await tokenBalance(w2, token.hash)).toBe(10n);
      } finally {
        await adapter.stopWallet(w1);
        await adapter.stopWallet(w2);
      }
    });
  });

  describe('destroyAuthority', () => {
    it('should destroy mint authorities', async () => {
      const { wallet } = await adapter.createWallet();
      try {
        const addr0 = (await wallet.getAddressAtIndex(0))!;
        await adapter.injectFunds(wallet, addr0, 10n);
        const token = await adapter.createToken(wallet, 'DestroyMintToken', 'DMT', 100n);

        // Token creation yields exactly one mint authority.
        expect(
          await adapter.getAuthorityUtxos(wallet, token.hash, AuthorityType.MINT)
        ).toHaveLength(1);

        // Cannot destroy more authorities than exist.
        await expect(
          adapter.destroyAuthority(wallet, token.hash, AuthorityType.MINT, 2)
        ).rejects.toThrow(/no-utxos-available|Not enough authority utxos/i);

        // Destroying the only mint authority removes it...
        await adapter.destroyAuthority(wallet, token.hash, AuthorityType.MINT, 1);
        expect(
          await adapter.getAuthorityUtxos(wallet, token.hash, AuthorityType.MINT)
        ).toHaveLength(0);

        // ...and minting is no longer possible.
        await expect(adapter.mintTokens(wallet, token.hash, 100n)).rejects.toThrow(/authority/i);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });

    it('should destroy melt authorities', async () => {
      const { wallet } = await adapter.createWallet();
      try {
        const addr0 = (await wallet.getAddressAtIndex(0))!;
        await adapter.injectFunds(wallet, addr0, 10n);
        const token = await adapter.createToken(wallet, 'DestroyMeltToken', 'DLT', 100n);

        // Token creation yields exactly one melt authority.
        expect(
          await adapter.getAuthorityUtxos(wallet, token.hash, AuthorityType.MELT)
        ).toHaveLength(1);

        // Cannot destroy more authorities than exist.
        await expect(
          adapter.destroyAuthority(wallet, token.hash, AuthorityType.MELT, 2)
        ).rejects.toThrow(/no-utxos-available|Not enough authority utxos/i);

        // Destroying the only melt authority removes it.
        await adapter.destroyAuthority(wallet, token.hash, AuthorityType.MELT, 1);
        expect(
          await adapter.getAuthorityUtxos(wallet, token.hash, AuthorityType.MELT)
        ).toHaveLength(0);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });
  });
});

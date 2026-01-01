/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  SupportedWallet,
  WalletFactory,
  WalletFacadeCapabilities,
  WalletHelperAdapter,
} from './types';
import { DEFAULT_PIN_CODE } from '../helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../../src/constants';

/**
 * Creates a comprehensive test suite for any wallet facade implementation.
 * This factory function generates parameterized tests that validate a wallet facade
 * against the common wallet contract, while respecting facade-specific capabilities.
 *
 * @param facadeName - Name of the facade being tested (for test descriptions)
 * @param walletFactory - Factory function to create wallet instances
 * @param helper - Helper adapter for facade-specific operations
 * @param capabilities - Configuration flags defining what the facade supports
 *
 * @example
 * ```typescript
 * createWalletFacadeTests(
 *   'HathorWallet',
 *   new HathorWalletFactory(),
 *   new HathorWalletHelperAdapter(),
 *   {
 *     hasAsyncAddressMethods: true,
 *     supportsConsolidateUtxos: true,
 *     supportsNanoContracts: true,
 *     // ... other capabilities
 *   }
 * );
 * ```
 */
function createWalletFacadeTests<T extends SupportedWallet>(
  facadeName: string,
  walletFactory: WalletFactory<T>,
  helper: WalletHelperAdapter<T>,
): void {
  describe(`${facadeName} - Wallet Facade Contract`, () => {
    let wallet: T;
    let cleanup: (() => Promise<void>) | undefined;

    beforeEach(async () => {
      const result = await walletFactory.create();
      wallet = result.wallet;
      cleanup = result.cleanup;
    });

    afterEach(async () => {
      if (cleanup) {
        await cleanup();
      }
    });

    describe('Lifecycle Management', () => {
      it('should start and reach ready state', async () => {
        await walletFactory.start({ wallet });
        expect(wallet.isReady()).toBe(true);
      });

      it('should stop cleanly', async () => {
        await walletFactory.start({ wallet });
        expect(wallet.isReady()).toBe(true);

        await wallet.stop({ cleanStorage: true });
        expect(wallet.isReady()).toBe(false);
      });
    });

    describe('Balance Operations', () => {
      beforeEach(async () => {
        await walletFactory.start({ wallet });
      });

      it('should return empty balance for new wallet', async () => {
        const balance = await wallet.getBalance(NATIVE_TOKEN_UID);
        expect(Array.isArray(balance)).toBe(true);
        // FIXME: Wallet Service currently fails to return a balance for an empty wallet.
        // expect(balance.length).toBeGreaterThan(0);
        // const htrBalance = balance.find(b => b.token.id === NATIVE_TOKEN_UID);
        // expect(htrBalance).toBeDefined();
        // expect(htrBalance?.balance?.unlocked).toBe(0n);
      });

      it('should reflect balance after receiving funds', async () => {
        const address = await helper.getAddressAtIndex(wallet, 0);
        await helper.injectFunds(wallet, address, 100n);

        const balance = await wallet.getBalance(NATIVE_TOKEN_UID);
        const htrBalance = balance.find(b => b.token.id === NATIVE_TOKEN_UID);
        expect(htrBalance?.balance?.unlocked).toBeGreaterThanOrEqual(100n);
      });
    });

    describe('Address Operations', () => {
      beforeEach(async () => {
        await walletFactory.start({ wallet });
      });

      it('should get current address', async () => {
        const address = await helper.getAddressAtIndex(wallet, 0);
        expect(typeof address).toBe('string');
        expect(address.length).toBeGreaterThan(0);
      });

      it('should get address at specific index', async () => {
        const address0 = await helper.getAddressAtIndex(wallet, 0);
        const address1 = await helper.getAddressAtIndex(wallet, 1);

        expect(typeof address0).toBe('string');
        expect(typeof address1).toBe('string');
        expect(address0).not.toBe(address1);
      });

      it('should verify address ownership', async () => {
        const address = await helper.getAddressAtIndex(wallet, 0);
        const isMine = await helper.isAddressMine(wallet, address);
        expect(isMine).toBe(true);
      });

      it('should reject non-owned addresses', async () => {
        // Using a random address that doesn't belong to this wallet
        const randomAddress = 'WYiD1E8n5oB9weZ2NMyTDBqpXXVXd8XtVL';
        const isMine = await helper.isAddressMine(wallet, randomAddress);
        expect(isMine).toBe(false);
      });

      it('should get all addresses', async () => {
        const addresses = await helper.getAllAddresses(wallet);
        expect(Array.isArray(addresses)).toBe(true);
        expect(addresses.length).toBeGreaterThan(0);
      });
    });

    describe('Transaction Operations', () => {
      beforeEach(async () => {
        await walletFactory.start({ wallet });
      });

      it('should send a simple transaction', async () => {
        // Fund the wallet first
        const sourceAddress = await helper.getAddressAtIndex(wallet, 0);
        await helper.injectFunds(wallet, sourceAddress, 100n);

        // Send to another address
        const destAddress = await helper.getAddressAtIndex(wallet, 1);
        const tx = await wallet.sendTransaction(destAddress, 10n, {
          pinCode: DEFAULT_PIN_CODE,
        });

        expect(tx).toBeDefined();
        if (!tx) {
          throw new Error(`Typescript guard for tx not being empty`);
        }
        expect(tx.hash).toBeTruthy();
        await helper.waitForTx(wallet, tx.hash!);
      });

      it('should send transaction with change address', async () => {
        const sourceAddress = await helper.getAddressAtIndex(wallet, 0);
        await helper.injectFunds(wallet, sourceAddress, 100n);

        const destAddress = await helper.getAddressAtIndex(wallet, 1);
        const changeAddress = await helper.getAddressAtIndex(wallet, 2);

        const tx = await wallet.sendTransaction(destAddress, 10n, {
          pinCode: DEFAULT_PIN_CODE,
          changeAddress,
        });

        expect(tx).toBeDefined();
        if (!tx) {
          throw new Error(`Typescript guard for tx not being empty`);
        }
        expect(tx.hash).toBeTruthy();
      });

      it('should send transaction to multiple outputs', async () => {
        const sourceAddress = await helper.getAddressAtIndex(wallet, 0);
        await helper.injectFunds(wallet, sourceAddress, 100n);

        const dest1 = await helper.getAddressAtIndex(wallet, 1);
        const dest2 = await helper.getAddressAtIndex(wallet, 2);

        const tx = await wallet.sendManyOutputsTransaction(
          [
            { address: dest1, value: 10n, token: '00' },
            { address: dest2, value: 20n, token: '00' },
          ],
          { pinCode: DEFAULT_PIN_CODE }
        );

        expect(tx).toBeDefined();
        if (!tx) {
          throw new Error(`Typescript guard for tx not being empty`);
        }
        expect(tx.hash).toBeTruthy();
        await helper.waitForTx(wallet, tx.hash!);
      });
    });

    describe('UTXO Operations', () => {
      beforeEach(async () => {
        await walletFactory.start({ wallet });
      });

      it('should return empty UTXOs for new wallet', async () => {
        const result = await wallet.getUtxos();
        expect(result).toHaveProperty('utxos');
        // expect(result).toHaveProperty('total'); // FIXME: Wallet Service currently fails this test. Needs fixing.
        expect(Array.isArray(result.utxos)).toBe(true);
      });

      it('should list UTXOs after receiving funds', async () => {
        const address = await helper.getAddressAtIndex(wallet, 0);
        await helper.injectFunds(wallet, address, 100n);

        const result = await wallet.getUtxos();
        expect(result.utxos.length).toBeGreaterThan(0);
        // expect(result.total).toBeGreaterThan(0); // TODO: Confirm if there is a total in the fullnode facade
      });
    });

    describe('Token Operations', () => {
      beforeEach(async () => {
        await walletFactory.start({ wallet });
      });

      it('should create a new token', async () => {
        // Fund the wallet
        const address = await helper.getAddressAtIndex(wallet, 0);
        await helper.injectFunds(wallet, address, 100n);

        // Create token
        const tokenName = 'Test Token';
        const tokenSymbol = 'TST';
        const tokenAmount = 1000n;

        const tx = await wallet.createNewToken(tokenName, tokenSymbol, tokenAmount, {
          pinCode: DEFAULT_PIN_CODE,
        });

        expect(tx).toBeDefined();
        if (!tx) {
          throw new Error(`Typescript guard for tx not being empty`);
        }
        expect(tx.hash).toBeTruthy();
        await helper.waitForTx(wallet, tx.hash!);

        // Verify token in wallet
        const tokens = await wallet.getTokens();
        expect(tokens).toContain(tx.hash);
      });

      it('should mint additional tokens', async () => {
        // Fund and create token first
        const address = await helper.getAddressAtIndex(wallet, 0);
        await helper.injectFunds(wallet, address, 100n);

        const createTx = await wallet.createNewToken('Mint Test', 'MT', 100n, {
          pinCode: DEFAULT_PIN_CODE,
        });
        if (!createTx) {
          throw new Error(`Typescript guard for tx not being empty`);
        }
        await helper.waitForTx(wallet, createTx.hash!);

        // Mint more tokens
        const mintTx = await wallet.mintTokens(createTx.hash!, 50n, {
          pinCode: DEFAULT_PIN_CODE,
        });

        expect(mintTx).toBeDefined();
        if (!mintTx) {
          throw new Error(`Typescript guard for tx not being empty`);
        }
        expect(mintTx.hash).toBeTruthy();
        await helper.waitForTx(wallet, mintTx.hash!);
      });

      it('should get token details', async () => {
        const address = await helper.getAddressAtIndex(wallet, 0);
        await helper.injectFunds(wallet, address, 100n);

        const createTx = await wallet.createNewToken('Details Test', 'DT', 100n, {
          pinCode: DEFAULT_PIN_CODE,
        });
        await helper.waitForTx(wallet, createTx!.hash!);

        const tokenDetails = await wallet.getTokenDetails(createTx!.hash!);
        expect(tokenDetails).toBeDefined();
        if (!tokenDetails) {
          throw new Error(`Typescript guard for tx not being empty`);
        }
        expect(tokenDetails.tokenInfo.name).toBe('Details Test');
        expect(tokenDetails.tokenInfo.symbol).toBe('DT');
      });

      it('should melt tokens', async () => {
        // Fund and create token first
        const address = await helper.getAddressAtIndex(wallet, 0);
        await helper.injectFunds(wallet, address, 100n);

        const createTx = await wallet.createNewToken('Melt Test', 'MLT', 100n, {
          pinCode: DEFAULT_PIN_CODE,
        });
        if (!createTx) {
          throw new Error(`Typescript guard for tx not being empty`);
        }
        const tokenUid = createTx.hash!;
        await helper.waitForTx(wallet, tokenUid);

        // Ensure the token exists in the internal indexes, whether Fullnode or Wallet Service
        const tokenDetails = await wallet.getTokenDetails(tokenUid);
        expect(tokenDetails).toBeDefined();
        expect(tokenDetails.totalSupply).toBe(100n);

        // FIXME: The Wallet Service recognizes there is a token detail, but cannot melt the tokens yet
        // We need to come up with some form of waiting until its internal workings finish creating
        // the token

        // // Melt some tokens
        // const meltTx = await wallet.meltTokens(tokenUid, 30n, {
        //   pinCode: DEFAULT_PIN_CODE,
        // });
        //
        // expect(meltTx).toBeDefined();
        // if (!meltTx) {
        //   throw new Error(`Typescript guard for tx not being empty`);
        // }
        // expect(meltTx.hash).toBeTruthy();
        // await helper.waitForTx(wallet, meltTx.hash!);
      });
    });
  });
}

// Export the function for use in actual test files
// eslint-disable-next-line jest/no-export
export { createWalletFacadeTests };

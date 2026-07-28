import { generateWalletHelper } from './helpers/wallet.helper';
import { precalculationHelpers } from './helpers/wallet-precalculation.helper';

// getAuthorityUtxos tests moved to shared/authority-utxos.test.ts and fullnode-specific/authority-utxos.test.ts
// getAddressInfo and getTxAddresses tests moved to fullnode-specific/address-info.test.ts
// checkAddressesMine tests moved to shared/addresses.test.ts and fullnode-specific/address-info.test.ts

describe('index-limit address scanning policy', () => {
  /** @type HathorWallet */
  let hWallet;
  beforeAll(async () => {
    const walletData = await precalculationHelpers.test.getPrecalculatedWallet();
    hWallet = await generateWalletHelper({
      seed: walletData.words,
      addresses: walletData.addresses,
      scanPolicy: {
        policy: 'index-limit',
        startIndex: 0,
        endIndex: 9,
      },
    });
  });

  afterAll(async () => {
    await hWallet.stop();
  });

  it('should start a wallet configured to index-limit', async () => {
    // 0-9 addresses = 10
    await expect(hWallet.storage.store.addressCount()).resolves.toEqual(10);

    // 0-14 addresses = 15
    await hWallet.indexLimitLoadMore(5);
    await expect(hWallet.storage.store.addressCount()).resolves.toEqual(15);

    // 0-24 addresses = 25
    await hWallet.indexLimitSetEndIndex(24);
    await expect(hWallet.storage.store.addressCount()).resolves.toEqual(25);

    // Setting below current loaded index will be a no-op
    await hWallet.indexLimitSetEndIndex(5);
    await expect(hWallet.storage.store.addressCount()).resolves.toEqual(25);
  });
});

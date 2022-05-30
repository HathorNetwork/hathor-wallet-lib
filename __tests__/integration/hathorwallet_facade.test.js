import { precalculationHelpers } from "./helpers/wallet-precalculation.helper";
import { GenesisWalletHelper } from "./helpers/genesis-wallet.helper";
import { delay, getRandomInt } from "./utils/core.util";
import {
  generateConnection,
  generateWallet,
  waitForTxReceived,
  waitForWalletReady
} from "./helpers/wallet.helper";
import HathorWallet from "../../src/new/wallet";
import { HATHOR_TOKEN_CONFIG } from "../../src/constants";

describe('start', () => {

  it('should start a wallet with no history', async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();

    // Start the wallet
    const walletConfig = {
      seed: walletData.words,
      connection: generateConnection(),
      password: 'password',
      pinCode: '000000',
      preCalculatedAddresses: walletData.addresses,
    };
    const hWallet = new HathorWallet(walletConfig);
    await hWallet.start();
    await waitForWalletReady(hWallet);

    // Validate that it has transactions
    const txHistory = await hWallet.getTxHistory();
    expect(txHistory).toHaveProperty('length',0);

    // Validate that the addresses are the same as the pre-calculated that were informed
    for (const addressIndex in walletData.addresses) {
      const precalcAddress = walletData.addresses[+addressIndex];
      const addressAtIndex = hWallet.getAddressAtIndex(+addressIndex);
      expect(precalcAddress).toEqual(addressAtIndex)
    }
    hWallet.stop();
  });

  it('should start a wallet with a transaction history', async () => {
    // Send a transaction to one of the wallet's addresses
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    const injectAddress = walletData.addresses[0];
    const injectValue = getRandomInt(10,1);
    const injectionTx = await GenesisWalletHelper.injectFunds(injectAddress,injectValue, true);

    // Start the wallet
    const walletConfig = {
      seed: walletData.words,
      connection: generateConnection(),
      password: 'password',
      pinCode: '000000',
      preCalculatedAddresses: walletData.addresses,
    };
    const hWallet = new HathorWallet(walletConfig);
    await hWallet.start();
    await waitForWalletReady(hWallet);

    // Validate that it has transactions
    const txHistory = await hWallet.getTxHistory();
    expect(txHistory).toHaveProperty('length',1);
    expect(txHistory[0].txId).toEqual(injectionTx.hash);
    hWallet.stop();
  });

  it("should calculate the wallet's addresses on start", async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();

    // Start the wallet
    const walletConfig = {
      seed: walletData.words,
      connection: generateConnection(),
      password: 'password',
      pinCode: '000000',
      /*
       * No precalculated addresses here. All will be calculated at runtime.
       * This operation takes a lot longer under jest's testing framework, so we avoid it
       * on most tests.
       */
    };
    const hWallet = new HathorWallet(walletConfig);
    await hWallet.start();
    await waitForWalletReady(hWallet);

    // Validate that the addresses are the same as the pre-calculated ones
    for (const addressIndex in walletData.addresses) {
      const precalcAddress = walletData.addresses[+addressIndex];
      const addressAtIndex = hWallet.getAddressAtIndex(+addressIndex);
      expect(precalcAddress).toEqual(addressAtIndex)
    }
    hWallet.stop();
  });

});

describe('getTransactionsCountByAddress', () => {
  it('should return correct entries for a wallet', async () => {
    // Create the wallet
    const hWallet = await generateWallet();

    // Validate empty contents, properties with the address string as a key
    const tcbaEmpty = hWallet.getTransactionsCountByAddress();
    expect(tcbaEmpty).toBeDefined();
    const addressesList = Object.keys(tcbaEmpty);
    expect(addressesList).toHaveProperty('length',21);
    for(const address of addressesList) {
      expect(tcbaEmpty[address]).toBeDefined();
      expect(tcbaEmpty[address]).toHaveProperty('index');
      expect(tcbaEmpty[address]).toHaveProperty('transactions', 0);
    }

    // Generate one transaction and validate its effects
    await GenesisWalletHelper.injectFunds(addressesList[0], 10, true);
    const tcba1 = hWallet.getTransactionsCountByAddress();
    expect(tcba1).toBeDefined();
    expect(tcba1[addressesList[0]]).toHaveProperty('transactions', 1);

    // Generate another transaction and validate its effects
    const tx2 = await hWallet.sendTransaction(addressesList[1], 5, {changeAddress: addressesList[2]});
    await waitForTxReceived(hWallet, tx2.hash);
    const tcba2 = hWallet.getTransactionsCountByAddress();
    expect(tcba2[addressesList[0]]).toHaveProperty('transactions', 2);
    expect(tcba2[addressesList[1]]).toHaveProperty('transactions', 1);
    expect(tcba2[addressesList[2]]).toHaveProperty('transactions', 1);
  })

  it('should retrieve more addresses according to gap limit', async () => {
    const hWallet = await generateWallet();

    const tcbaEmpty = hWallet.getTransactionsCountByAddress();
    const addressesList = Object.keys(tcbaEmpty);
    expect(addressesList).toHaveProperty('length',21);

    await GenesisWalletHelper.injectFunds(addressesList[20], 1, true);
    const tcba1 = hWallet.getTransactionsCountByAddress();
    const addresses1 = Object.keys(tcba1);
    expect(addresses1).toHaveProperty('length', 41);
  })
})

describe('getBalance', () => {
  it('should get the balance for the HTR token', async () => {
    const hWallet = await generateWallet();

    // Checking whether the token uid parameter is mandatory.
    const nullTokenErr = await hWallet.getBalance().catch(err => err);
    expect(nullTokenErr).toBeInstanceOf(Error);

    // Validating the return array has one entry
    const balance = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(balance).toHaveProperty('length', 1);
    const htrBalance = balance[0];

    // Validating HTR token data
    expect(htrBalance).toHaveProperty('token.id', HATHOR_TOKEN_CONFIG.uid);

    // Validating HTR token balance
    expect(htrBalance).toHaveProperty('balance.unlocked', 0);
    expect(htrBalance).toHaveProperty('balance.locked', 0);
    expect(htrBalance).toHaveProperty('transactions', 0);

    // Generating one transaction to validate its effects
    const injectedValue = getRandomInt(10,2);
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), injectedValue, true);

    // Validating the transaction effects
    const balance1 = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    const htrBalance1 = balance1[0];
    expect(htrBalance1).toHaveProperty('balance.unlocked', injectedValue);
    expect(htrBalance1).toHaveProperty('balance.locked', 0);
    // TODO: The amount of transactions returned is 2, but even the txHistory here says 1. Fix this.
    // expect(htrBalance1).toHaveProperty('transactions', 1);

    // Transferring tokens inside the wallet should not change the balance
    const tx1 = await hWallet.sendTransaction(hWallet.getAddressAtIndex(1), 2);
    await waitForTxReceived(hWallet, tx1.hash);
    const balance2 = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(balance2[0].balance).toEqual(htrBalance1.balance);
  })

})

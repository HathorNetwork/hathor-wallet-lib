import { precalculationHelpers } from './helpers/wallet-precalculation.helper';
import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import { delay, getRandomInt } from './utils/core.util';
import {
  createTokenHelper,
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
  generateConnection,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitForWalletReady,
  waitUntilNextTimestamp
} from './helpers/wallet.helper';
import HathorWallet from '../../src/new/wallet';
import { HATHOR_TOKEN_CONFIG, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../src/constants';
import transaction from '../../src/transaction';
import { TOKEN_DATA } from './configuration/test-constants';
import wallet from '../../src/wallet';
import dateFormatter from '../../src/date';
import { loggers } from './utils/logger.util';

const fakeTokenUid = '000002490ab7fc302e076f7aab8b20c35fed81fd1131a955aebbd3cb76e48fb0';
const sampleNftAddress = 'ipfs://bafybeiccfclkdtucu6y4yc5cpr6y3yuinr67svmii46v5cfcrkp47ihehy/albums/QXBvbGxvIDEwIE1hZ2F6aW5lIDI3L04=/21716695748_7390815218_o.jpg';

describe('start', () => {
  it('should start a wallet with no history', async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();

    // Start the wallet
    const walletConfig = {
      seed: walletData.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      preCalculatedAddresses: walletData.addresses,
    };
    const hWallet = new HathorWallet(walletConfig);
    await hWallet.start();
    await waitForWalletReady(hWallet);

    // Validate that it has transactions
    const txHistory = await hWallet.getTxHistory();
    expect(txHistory).toHaveLength(0);

    // Validate that the addresses are the same as the pre-calculated that were informed
    for (const addressIndex in walletData.addresses) {
      const precalcAddress = walletData.addresses[+addressIndex];
      const addressAtIndex = hWallet.getAddressAtIndex(+addressIndex);
      expect(precalcAddress).toEqual(addressAtIndex);
    }
    hWallet.stop();
  });

  it('should start a wallet with a transaction history', async () => {
    // Send a transaction to one of the wallet's addresses
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();
    const injectAddress = walletData.addresses[0];
    const injectValue = getRandomInt(10, 1);
    const injectionTx = await GenesisWalletHelper.injectFunds(injectAddress, injectValue);

    // Start the wallet
    const walletConfig = {
      seed: walletData.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      preCalculatedAddresses: walletData.addresses,
    };
    const hWallet = new HathorWallet(walletConfig);
    await hWallet.start();
    await waitForWalletReady(hWallet);

    // Validate that it has transactions
    const txHistory = await hWallet.getTxHistory();
    expect(txHistory).toHaveLength(1);
    expect(txHistory[0].txId).toEqual(injectionTx.hash);
    hWallet.stop();
  });

  it('should calculate the wallet\'s addresses on start', async () => {
    const walletData = precalculationHelpers.test.getPrecalculatedWallet();

    // Start the wallet
    const walletConfig = {
      seed: walletData.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
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
      expect(precalcAddress).toEqual(addressAtIndex);
    }
    hWallet.stop();
  });
});

describe('addresses methods', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should get the correct addresses', async () => {
    // Creating a wallet
    const hWallet = await generateWalletHelper();
    // Initializing the getAllAddresses generator
    const addressGenerator = await hWallet.getAllAddresses();

    // Validating getAddressAtIndex and getAllAddresses methods
    for (let i = 0; i < 22; ++i) {
      // Validating generator results
      const genResults = await addressGenerator.next();
      expect(genResults).toHaveProperty('value');
      expect(genResults).toHaveProperty('done');

      // Validating gap limit
      if (i === 21) {
        expect(genResults.done).toEqual(true);
        expect(genResults.value).toBeUndefined();
        break;
      }

      // Validating generator contents
      const addressAtIndex = hWallet.getAddressAtIndex(i);
      expect(genResults.value.index).toEqual(i);
      expect(genResults.value.address).toEqual(addressAtIndex);
    }

    // Validating currentAddress behavior
    let currentAddress = hWallet.getCurrentAddress();
    expect(currentAddress.index).toEqual(0);
    expect(currentAddress.address).toEqual(hWallet.getAddressAtIndex(0));
    // Expect no change on second call
    currentAddress = hWallet.getCurrentAddress();
    expect(currentAddress.index).toEqual(0);
    expect(currentAddress.address).toEqual(hWallet.getAddressAtIndex(0));
    // Expect the same address for the last time when calling with markAsUsed parameters
    currentAddress = hWallet.getCurrentAddress({ markAsUsed: true });
    expect(currentAddress.index).toEqual(0);
    expect(currentAddress.address).toEqual(hWallet.getAddressAtIndex(0));
    // Now it won't return the used one
    currentAddress = hWallet.getCurrentAddress();
    expect(currentAddress.index).toEqual(1);
    expect(currentAddress.address).toEqual(hWallet.getAddressAtIndex(1));

    // Validating getNextAddress behavior
    let nextAddress = hWallet.getNextAddress();
    expect(nextAddress.index).toEqual(2);
    expect(nextAddress.address).toEqual(hWallet.getAddressAtIndex(2));
    // Expecting the next address index
    nextAddress = hWallet.getNextAddress();
    expect(nextAddress.index).toEqual(3);
    expect(nextAddress.address).toEqual(hWallet.getAddressAtIndex(3));

    // Expect the "current address" to change when a transaction arrives at the current one
    currentAddress = hWallet.getCurrentAddress();
    await GenesisWalletHelper.injectFunds(currentAddress.address, 1);
    const currentAfterTx = hWallet.getCurrentAddress();
    expect(currentAfterTx.index).toEqual(currentAddress.index + 1);
    expect(currentAfterTx.address).toEqual(hWallet.getAddressAtIndex(currentAddress.index + 1));
  });
});

describe('getTransactionsCountByAddress', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should return correct entries for a wallet', async () => {
    // Create the wallet
    const hWallet = await generateWalletHelper();

    // Validate empty contents, properties with the address string as a key
    const tcbaEmpty = hWallet.getTransactionsCountByAddress();
    expect(tcbaEmpty).toBeDefined();
    const addressesList = Object.keys(tcbaEmpty);
    expect(addressesList).toHaveLength(21);
    for (const addressIndex in addressesList) {
      const address = addressesList[+addressIndex];
      expect(tcbaEmpty[address]).toBeDefined();
      expect(tcbaEmpty[address]).toHaveProperty('index', +addressIndex);
      expect(tcbaEmpty[address]).toHaveProperty('transactions', 0);
    }

    // Generate one transaction and validate its effects
    await GenesisWalletHelper.injectFunds(addressesList[0], 10);
    const tcba1 = hWallet.getTransactionsCountByAddress();
    expect(tcba1).toBeDefined();
    expect(tcba1[addressesList[0]]).toHaveProperty('transactions', 1);

    // Generate another transaction and validate its effects
    const tx2 = await hWallet.sendTransaction(
      addressesList[1],
      5,
      { changeAddress: addressesList[2] }
    );
    await waitForTxReceived(hWallet, tx2.hash);
    const tcba2 = hWallet.getTransactionsCountByAddress();
    expect(tcba2[addressesList[0]]).toHaveProperty('transactions', 2);
    expect(tcba2[addressesList[1]]).toHaveProperty('transactions', 1);
    expect(tcba2[addressesList[2]]).toHaveProperty('transactions', 1);
  });

  it('should retrieve more addresses according to gap limit', async () => {
    const hWallet = await generateWalletHelper();

    const tcbaEmpty = hWallet.getTransactionsCountByAddress();
    const addressesList = Object.keys(tcbaEmpty);
    expect(addressesList).toHaveLength(21);

    /*
     * The generation of new addresses delays the response of this tx.
     * Increasing timeout to avoid failures here.
     */
    await GenesisWalletHelper.injectFunds(addressesList[20], 1, { waitTimeout: 10000 });
    const tcba1 = hWallet.getTransactionsCountByAddress();
    const addresses1 = Object.keys(tcba1);
    expect(addresses1).toHaveLength(41);

    // Expecting the addresses all have the same sequential properties as before
    for (const addressIndex in addresses1) {
      const address = addresses1[+addressIndex];
      expect(tcba1[address]).toBeDefined();
      expect(tcba1[address]).toHaveProperty('index', +addressIndex);
      expect(tcba1[address]).toHaveProperty('transactions', addressIndex === '20' ? 1 : 0);
    }
  });
});

describe('getBalance', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should get the balance for the HTR token', async () => {
    const hWallet = await generateWalletHelper();

    // Validating that the token uid parameter is mandatory.
    expect(hWallet.getBalance()).rejects.toThrow();

    // Validating the return array has one entry on an empty wallet
    const balance = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(balance).toHaveLength(1);
    const htrBalance = balance[0];

    // Validating HTR token data
    expect(htrBalance).toHaveProperty('token.id', HATHOR_TOKEN_CONFIG.uid);

    // Validating HTR token balance
    expect(htrBalance).toHaveProperty('balance.unlocked', 0);
    expect(htrBalance).toHaveProperty('balance.locked', 0);
    expect(htrBalance).toHaveProperty('transactions', 0);

    // Generating one transaction to validate its effects
    const injectedValue = getRandomInt(10, 2);
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), injectedValue);

    // Validating the transaction effects
    const balance1 = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    const htrBalance1 = balance1[0];
    expect(htrBalance1).toHaveProperty('balance.unlocked', injectedValue);
    expect(htrBalance1).toHaveProperty('balance.locked', 0);
    // TODO: The amount of transactions returned is 2, but should be 1. Fix this.
    // expect(htrBalance1).toHaveProperty('transactions', 1);

    // Transferring tokens inside the wallet should not change the balance
    const tx1 = await hWallet.sendTransaction(hWallet.getAddressAtIndex(1), 2);
    await waitForTxReceived(hWallet, tx1.hash);
    const balance2 = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(balance2[0].balance).toEqual(htrBalance1.balance);
  });

  it('should get the balance for a custom token', async () => {
    const hWallet = await generateWalletHelper();

    // Validating results for a nonexistant token
    const emptyBalance = await hWallet.getBalance(fakeTokenUid);
    expect(emptyBalance).toHaveLength(1);
    expect(emptyBalance[0]).toHaveProperty('token.id', fakeTokenUid);
    expect(emptyBalance[0]).toHaveProperty('balance.unlocked', 0);
    expect(emptyBalance[0]).toHaveProperty('balance.locked', 0);
    expect(emptyBalance[0]).toHaveProperty('transactions', 0);

    // Creating a new custom token
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);
    const newTokenAmount = getRandomInt(1000, 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'BalanceToken',
      'BAT',
      newTokenAmount,
    );

    const tknBalance = await hWallet.getBalance(tokenUid);
    expect(tknBalance[0]).toHaveProperty('balance.unlocked', newTokenAmount);
    expect(tknBalance[0]).toHaveProperty('balance.locked', 0);
    // TODO: This returns 8 transactions, we expected only 1. Fix this.
    // expect(tknBalance[0]).toHaveProperty('transactions', 1);

    // Validating that a different wallet (genesis) has no access to this token
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    const genesisTknBalance = await gWallet.getBalance(tokenUid);
    expect(genesisTknBalance).toHaveLength(1);
    expect(genesisTknBalance[0]).toHaveProperty('token.id', tokenUid);
    expect(genesisTknBalance[0]).toHaveProperty('balance.unlocked', 0);
    expect(genesisTknBalance[0]).toHaveProperty('balance.locked', 0);
    expect(genesisTknBalance[0]).toHaveProperty('transactions', 0);
  });
});

describe('getFullHistory', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should return full history (htr)', async () => {
    const hWallet = await generateWalletHelper();

    // Expect to have an empty list for the full history
    let history = hWallet.getFullHistory();
    expect(history).toBeDefined();
    expect(Object.keys(history)).toHaveLength(0);

    // Injecting some funds on this wallet
    const fundDestinationAddress = hWallet.getAddressAtIndex(0);
    const { hash: fundTxId } = await GenesisWalletHelper.injectFunds(fundDestinationAddress, 10);

    // Validating the full history increased in one
    expect(Object.keys(hWallet.getFullHistory())).toHaveLength(1);

    // Moving the funds inside this wallet so that we have every information about the tx
    const txDestinationAddress = hWallet.getAddressAtIndex(5);
    const txChangeAddress = hWallet.getAddressAtIndex(8);
    const txValue = 6;
    const rawMoveTx = await hWallet.sendTransaction(
      txDestinationAddress,
      txValue,
      { changeAddress: txChangeAddress }
    );
    await waitForTxReceived(hWallet, rawMoveTx.hash);

    history = hWallet.getFullHistory();
    expect(Object.keys(history)).toHaveLength(2);
    expect(history).toHaveProperty(rawMoveTx.hash);
    const moveTx = history[rawMoveTx.hash];

    // Validating transactions properties were correctly translated
    expect(moveTx).toHaveProperty('tx_id', rawMoveTx.hash);
    expect(moveTx).toHaveProperty('version', rawMoveTx.version);
    expect(moveTx).toHaveProperty('weight', rawMoveTx.weight);
    expect(moveTx).toHaveProperty('timestamp', rawMoveTx.timestamp);
    expect(moveTx).toHaveProperty('is_voided', false);
    expect(moveTx.parents).toEqual(rawMoveTx.parents);

    // Validating inputs
    expect(moveTx.inputs).toHaveLength(rawMoveTx.inputs.length);
    for (const inputIndex in moveTx.inputs) {
      const inputObj = moveTx.inputs[inputIndex];

      // Some attributes were correctly translated
      expect(inputObj.index).toEqual(rawMoveTx.inputs[inputIndex].index);
      expect(inputObj.tx_id).toEqual(rawMoveTx.inputs[inputIndex].hash);

      // Decoded attributes are correct
      expect(inputObj).toHaveProperty('token', HATHOR_TOKEN_CONFIG.uid);
      expect(inputObj).toHaveProperty('token_data', TOKEN_DATA.HTR);
      expect(inputObj).toHaveProperty('script');
      expect(inputObj).toHaveProperty('value', 10);
      expect(inputObj).toHaveProperty('decoded');
      expect(inputObj.decoded).toHaveProperty('type', 'P2PKH');
      expect(inputObj.decoded).toHaveProperty('address', fundDestinationAddress);
    }

    // Validating outputs
    expect(moveTx.outputs).toHaveLength(rawMoveTx.outputs.length);
    for (const outputIndex in moveTx.outputs) {
      const outputObj = moveTx.outputs[outputIndex];

      // Some attributes were correctly translated
      expect(outputObj.value).toEqual(rawMoveTx.outputs[outputIndex].value);
      expect(outputObj.token_data).toEqual(rawMoveTx.outputs[outputIndex].tokenData);

      // Decoded attributes are correct
      expect(outputObj).toHaveProperty('token', HATHOR_TOKEN_CONFIG.uid);
      expect(outputObj).toHaveProperty('script');
      expect(outputObj).toHaveProperty('decoded');
      expect(outputObj).toHaveProperty('spent_by', null);
      expect(outputObj).toHaveProperty('selected_as_input', false);
      expect(outputObj.decoded).toHaveProperty('type', 'P2PKH');

      if (outputObj.value === txValue) {
        expect(outputObj.decoded).toHaveProperty('address', txDestinationAddress);
      } else {
        expect(outputObj.decoded).toHaveProperty('address', txChangeAddress);
      }
    }

    // Validating that the fundTx now has its output spent by moveTx
    const fundTx = history[fundTxId];
    for (const output of fundTx.outputs) {
      // We are only interested on the output of this wallet, not the Genesis change output
      if (output.decoded.address !== fundDestinationAddress) {
        continue;
      }

      expect(output.spent_by).toEqual(moveTx.tx_id);
    }
  });

  it('should return full history (custom token)', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(
      hWallet.getAddressAtIndex(0),
      10
    );
    const tokenName = 'Full History Token';
    const tokenSymbol = 'FHT';
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      tokenName,
      tokenSymbol,
      100
    );

    const history = hWallet.getFullHistory();
    expect(Object.keys(history)).toHaveLength(2);

    // Validating create token properties ( all others have been validated on the previous test )
    expect(history).toHaveProperty(tokenUid);
    const createTx = history[tokenUid];

    // Validating basic token creation properties
    expect(createTx).toHaveProperty('token_name', tokenName)
    expect(createTx).toHaveProperty('token_symbol', tokenSymbol)

    // Validating inputs
    expect(createTx.inputs).toHaveLength(1);
    const inputObj = createTx.inputs[0];
    expect(inputObj.token).toEqual(HATHOR_TOKEN_CONFIG.uid);
    expect(inputObj.token_data).toEqual(TOKEN_DATA.HTR);
    expect(inputObj.value).toEqual(10);

    // Validating outputs
    expect(createTx.outputs).toHaveLength(4);
    const changeOutput = createTx.outputs.find(o => o.value === 9);
    expect(changeOutput).toBeDefined();
    expect(changeOutput.token).toEqual(HATHOR_TOKEN_CONFIG.uid);
    expect(changeOutput.token_data).toEqual(TOKEN_DATA.HTR);

    const tokenOutput = createTx.outputs.find(o => o.value === 100);
    expect(tokenOutput).toBeDefined();
    expect(tokenOutput.token).toEqual(tokenUid);
    expect(tokenOutput.token_data).toEqual(TOKEN_DATA.TOKEN);

    const mintOutput = createTx.outputs.find(o => {
      const isAuthority = wallet.isAuthorityOutput(o);
      const isMint = o.value === TOKEN_MINT_MASK;
      return isAuthority && isMint;
    });
    expect(mintOutput).toBeDefined();
    expect(mintOutput.token).toEqual(tokenUid);

    const meltOutput = createTx.outputs.find(o => {
      const isAuthority = wallet.isAuthorityOutput(o);
      const isMelt = o.value === TOKEN_MELT_MASK;
      return isAuthority && isMelt;
    });
    expect(meltOutput).toBeDefined();
    expect(meltOutput.token).toEqual(tokenUid);
  });
});

describe('getTxBalance', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should get tx balance', async () => {
    const hWallet = await generateWalletHelper();
    const { hash: tx1Hash } = await GenesisWalletHelper.injectFunds(
      hWallet.getAddressAtIndex(0),
      10
    );

    // Validating tx balance for a transaction with a single token (htr)
    const tx1 = hWallet.getTx(tx1Hash);
    let txBalance = await hWallet.getTxBalance(tx1);
    expect(txBalance).toBeDefined();
    expect(Object.keys(txBalance)).toHaveLength(1);
    expect(txBalance[HATHOR_TOKEN_CONFIG.uid]).toEqual(10);

    // Validating tx balance for a transaction with two tokens (htr+custom)
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'txBalance Token',
      'TXBT',
      100
    );
    const tokenCreationTx = hWallet.getTx(tokenUid);
    txBalance = await hWallet.getTxBalance(tokenCreationTx);
    expect(Object.keys(txBalance)).toHaveLength(2);
    expect(txBalance[tokenUid]).toEqual(100);
    expect(txBalance[HATHOR_TOKEN_CONFIG.uid]).toEqual(-1);

    // Validating that the option to include authority tokens does not change the balance
    txBalance = await hWallet.getTxBalance(tokenCreationTx, { includeAuthorities: true });
    expect(Object.keys(txBalance)).toHaveLength(2);
    expect(txBalance[HATHOR_TOKEN_CONFIG.uid]).toEqual(-1);
    expect(txBalance).toHaveProperty(tokenUid, 100);

    // Validating delegate token transaction behavior
    const { hash: delegateTxHash } = await hWallet.delegateAuthority(
      tokenUid,
      'mint',
      hWallet.getAddressAtIndex(0)
    );

    // By default this tx will not have a balance
    await waitForTxReceived(hWallet, delegateTxHash);
    const delegateTx = hWallet.getTx(delegateTxHash);
    txBalance = await hWallet.getTxBalance(delegateTx);
    expect(Object.keys(txBalance)).toHaveLength(0);
    // When the "includeAuthorities" parameter is added, the balance should be zero
    txBalance = await hWallet.getTxBalance(delegateTx, { includeAuthorities: true });
    expect(Object.keys(txBalance)).toHaveLength(1);
    expect(txBalance).toHaveProperty(tokenUid, 0);

    // Validating that transactions inside a wallet have zero txBalance
    await waitUntilNextTimestamp(hWallet, delegateTxHash);
    const { hash: sameWalletTxHash } = await hWallet.sendManyOutputsTransaction(
      [
        {
          address: hWallet.getAddressAtIndex(0),
          value: 5,
          token: HATHOR_TOKEN_CONFIG.uid
        },
        {
          address: hWallet.getAddressAtIndex(1),
          value: 50,
          token: tokenUid
        },
      ]
    );
    await waitForTxReceived(hWallet, sameWalletTxHash);

    const sameWalletTx = hWallet.getTx(sameWalletTxHash);
    txBalance = await hWallet.getTxBalance(sameWalletTx);
    expect(Object.keys(txBalance)).toHaveLength(2);
    expect(txBalance[HATHOR_TOKEN_CONFIG.uid]).toEqual(0);
    expect(txBalance).toHaveProperty(tokenUid, 0);
  });
});

describe('sendTransaction', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should send HTR transactions', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);

    // Sending a transaction inside the same wallet
    const tx1 = await hWallet.sendTransaction(hWallet.getAddressAtIndex(2), 6);

    // Validating all fields
    await waitForTxReceived(hWallet, tx1.hash);
    expect(tx1).toHaveProperty('hash');
    expect(tx1).toHaveProperty('inputs');
    expect(tx1.inputs).toHaveProperty('length');
    expect(tx1).toHaveProperty('outputs');
    expect(tx1.outputs).toHaveProperty('length');
    expect(tx1).toHaveProperty('version');
    expect(tx1).toHaveProperty('weight');
    expect(tx1).toHaveProperty('nonce');
    expect(tx1).toHaveProperty('timestamp');
    expect(tx1).toHaveProperty('parents');
    expect(tx1.parents).toHaveProperty('length');
    expect(tx1).toHaveProperty('tokens');
    expect(tx1.tokens).toHaveProperty('length');

    // Validating balance stays the same for internal transactions
    let htrBalance = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(htrBalance[0].balance.unlocked).toEqual(10);

    // Validating the correct addresses received the tokens
    let tcba = hWallet.getTransactionsCountByAddress();
    expect(tcba[hWallet.getAddressAtIndex(0)]).toHaveProperty('transactions', 2);
    expect(tcba[hWallet.getAddressAtIndex(1)]).toHaveProperty('transactions', 1);
    expect(tcba[hWallet.getAddressAtIndex(2)]).toHaveProperty('transactions', 1);

    // Sending a transaction to outside the wallet ( returning funds to genesis )
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    await waitUntilNextTimestamp(hWallet, tx1.hash);
    const { hash: tx2Hash } = await hWallet.sendTransaction(
      gWallet.getAddressAtIndex(0),
      8,
      { changeAddress: hWallet.getAddressAtIndex(5) }
    );
    await waitForTxReceived(hWallet, tx2Hash);

    // Balance was reduced
    htrBalance = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(htrBalance[0].balance.unlocked).toEqual(2);

    // Change was moved to correct address
    tcba = hWallet.getTransactionsCountByAddress();
    expect(tcba[hWallet.getAddressAtIndex(0)]).toHaveProperty('transactions', 2);
    expect(tcba[hWallet.getAddressAtIndex(1)]).toHaveProperty('transactions', 2);
    expect(tcba[hWallet.getAddressAtIndex(2)]).toHaveProperty('transactions', 2);
    expect(tcba[hWallet.getAddressAtIndex(3)]).toHaveProperty('transactions', 0);
    expect(tcba[hWallet.getAddressAtIndex(4)]).toHaveProperty('transactions', 0);
    expect(tcba[hWallet.getAddressAtIndex(5)]).toHaveProperty('transactions', 1);
    expect(tcba[hWallet.getAddressAtIndex(6)]).toHaveProperty('transactions', 0);
  });

  it('should send custom token transactions', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token to Send',
      'TTS',
      100
    );

    const tx1 = await hWallet.sendTransaction(
      hWallet.getAddressAtIndex(5),
      30,
      {
        token: tokenUid,
        changeAddress: hWallet.getAddressAtIndex(6)
      }
    );
    await waitForTxReceived(hWallet, tx1.hash);

    // Validating balance stays the same for internal transactions
    let htrBalance = await hWallet.getBalance(tokenUid);
    expect(htrBalance[0].balance.unlocked).toEqual(100);

    let tcba = hWallet.getTransactionsCountByAddress();
    expect(tcba[hWallet.getAddressAtIndex(5)]).toHaveProperty('transactions', 1);
    expect(tcba[hWallet.getAddressAtIndex(6)]).toHaveProperty('transactions', 1);

    // Transaction outside the wallet
    const { hWallet: gWallet } = await GenesisWalletHelper.getSingleton();
    await waitUntilNextTimestamp(hWallet, tx1.hash);
    const { hash: tx2Hash } = await hWallet.sendTransaction(
      gWallet.getAddressAtIndex(0),
      80,
      {
        token: tokenUid,
        changeAddress: hWallet.getAddressAtIndex(12)
      }
    );
    await waitForTxReceived(hWallet, tx2Hash);

    // Balance was reduced
    htrBalance = await hWallet.getBalance(tokenUid);
    expect(htrBalance[0].balance.unlocked).toEqual(20);

    // Change was moved to correct address
    tcba = hWallet.getTransactionsCountByAddress();
    expect(tcba[hWallet.getAddressAtIndex(5)]).toHaveProperty('transactions', 2);
    expect(tcba[hWallet.getAddressAtIndex(6)]).toHaveProperty('transactions', 2);
    expect(tcba[hWallet.getAddressAtIndex(12)]).toHaveProperty('transactions', 1);
  });
});

describe('sendManyOutputsTransaction', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should send simple HTR transactions', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 100);

    // Single input and single output
    const rawSimpleTx = await hWallet.sendManyOutputsTransaction(
      [
        {
          address: hWallet.getAddressAtIndex(2),
          value: 100,
          token: HATHOR_TOKEN_CONFIG.uid
        },
      ],
    );
    expect(rawSimpleTx).toHaveProperty('hash');
    await waitForTxReceived(hWallet, rawSimpleTx.hash);
    const decodedSimple = hWallet.getTx(rawSimpleTx.hash);
    expect(decodedSimple.inputs).toHaveLength(1);
    expect(decodedSimple.outputs).toHaveLength(1);

    // Single input and two outputs
    await waitUntilNextTimestamp(hWallet, rawSimpleTx.hash);
    const rawDoubleOutputTx = await hWallet.sendManyOutputsTransaction(
      [
        {
          address: hWallet.getAddressAtIndex(5),
          value: 60,
          token: HATHOR_TOKEN_CONFIG.uid
        },
        {
          address: hWallet.getAddressAtIndex(6),
          value: 40,
          token: HATHOR_TOKEN_CONFIG.uid
        },
      ],
    );
    await waitForTxReceived(hWallet, rawDoubleOutputTx.hash);
    const decodedDoubleOutput = hWallet.getTx(rawDoubleOutputTx.hash);
    expect(decodedDoubleOutput.inputs).toHaveLength(1);
    expect(decodedDoubleOutput.outputs).toHaveLength(2);
    const largerOutputIndex = decodedDoubleOutput.outputs.findIndex(o => o.value === 60);

    // Explicit input and three outputs
    await waitUntilNextTimestamp(hWallet, rawDoubleOutputTx.hash);
    const rawExplicitInputTx = await hWallet.sendManyOutputsTransaction(
      [
        {
          address: hWallet.getAddressAtIndex(1),
          value: 5,
          token: HATHOR_TOKEN_CONFIG.uid
        },
        {
          address: hWallet.getAddressAtIndex(2),
          value: 35,
          token: HATHOR_TOKEN_CONFIG.uid
        },
      ],
      {
        inputs: [{
          txId: decodedDoubleOutput.tx_id,
          token: HATHOR_TOKEN_CONFIG.uid,
          index: largerOutputIndex
        }]
      }
    );
    await waitForTxReceived(hWallet, rawExplicitInputTx.hash);
    const explicitInput = hWallet.getTx(rawExplicitInputTx.hash);
    expect(explicitInput.inputs).toHaveLength(1);
    expect(explicitInput.outputs).toHaveLength(3);

    // Expect our explicit outputs and an automatic one to complete the 60 HTR input
    expect(explicitInput.outputs.find(o => o.value === 5)).toBeDefined();
    expect(explicitInput.outputs.find(o => o.value === 35)).toBeDefined();
    expect(explicitInput.outputs.find(o => o.value === 20)).toBeDefined(); // Automatic
  });

  it('should send transactions with multiple tokens', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Multiple Tokens Tk',
      'MTTK',
      200
    );

    // Generating tx
    const rawSendTx = await hWallet.sendManyOutputsTransaction(
      [
        {
          token: tokenUid,
          value: 110,
          address: hWallet.getAddressAtIndex(1)
        },
        {
          token: HATHOR_TOKEN_CONFIG.uid,
          value: 5,
          address: hWallet.getAddressAtIndex(2)
        },
      ]
    );
    await waitForTxReceived(hWallet, rawSendTx.hash);

    // Validating amount of inputs and outputs
    const sendTx = hWallet.getTx(rawSendTx.hash);
    expect(sendTx.inputs).toHaveLength(2);
    expect(sendTx.outputs).toHaveLength(4);

    // Validating that each of the outputs has the values we expect
    const smallerHtrOutput = sendTx.outputs.find(o => o.value === 3);
    expect(smallerHtrOutput).toBeDefined();
    const biggerHtrOutput = sendTx.outputs.find(o => o.value === 5);
    expect(biggerHtrOutput).toBeDefined();
    const smallerTokenOutput = sendTx.outputs.find(o => o.value === 90);
    expect(smallerTokenOutput.token).toEqual(tokenUid);
    const biggerTokenOutput = sendTx.outputs.find(o => o.value === 110);
    expect(biggerTokenOutput.token).toEqual(tokenUid);

    // Validating that each of the inputs has the values we expect
    const htrInput = sendTx.inputs.find(o => o.token === HATHOR_TOKEN_CONFIG.uid);
    expect(htrInput.value).toEqual(8);
    const tokenInput = sendTx.inputs.find(o => o.token === tokenUid);
    expect(tokenInput.value).toEqual(200);
  });

  it('should respect timelocks', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);

    // Defining timelocks (milliseconds) and timestamps (seconds)
    const startTime = Date.now().valueOf();
    const timelock1 = startTime + 5000; // 5 seconds of locked resources
    const timelock2 = startTime + 8000; // 8 seconds of locked resources
    const timelock1Timestamp = dateFormatter.dateToTimestamp(new Date(timelock1));
    const timelock2Timestamp = dateFormatter.dateToTimestamp(new Date(timelock2));

    const rawTimelockTx = await hWallet.sendManyOutputsTransaction(
      [
        {
          address: hWallet.getAddressAtIndex(1),
          value: 7,
          token: HATHOR_TOKEN_CONFIG.uid,
          timelock: timelock1Timestamp,
        },
        {
          address: hWallet.getAddressAtIndex(1),
          value: 3,
          token: HATHOR_TOKEN_CONFIG.uid,
          timelock: timelock2Timestamp,
        }
      ],
    );
    await waitForTxReceived(hWallet, rawTimelockTx.hash);

    // Validating the transaction with getFullHistory / getTx
    const timelockTx = hWallet.getTx(rawTimelockTx.hash);
    expect(timelockTx.outputs.find(o => o.decoded.timelock === timelock1Timestamp)).toBeDefined();
    expect(timelockTx.outputs.find(o => o.decoded.timelock === timelock2Timestamp)).toBeDefined();

    // Validating getBalance ( moment 0 )
    let htrBalance = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(htrBalance[0].balance.locked).toBe(10);
    expect(htrBalance[0].balance.unlocked).toBe(0);

    // Validating interfaces with only a partial lock of the resources
    const waitFor1 = timelock1 - Date.now().valueOf() + 1000;
    loggers.test.log(`Will wait for ${waitFor1}ms for timelock1 to expire`);
    await delay(waitFor1);

    /*
     * The locked/unlocked balances are usually updated when new transactions arrive.
     * We will force this update here without a new tx, for testing purposes.
     */
    await hWallet.preProcessWalletData();

    // Validating getBalance ( moment 1 )
    htrBalance = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(htrBalance[0].balance.locked).toBe(3);
    expect(htrBalance[0].balance.unlocked).toBe(7);

    // Confirm that the balance is unavailable
    try {
      const deniedTx = await hWallet.sendTransaction(hWallet.getAddressAtIndex(3), 8);
      expect(deniedTx).toBeUndefined(); // This line should actually never be reached
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }

    // Validating interfaces with all resources unlocked
    const waitFor2 = timelock2 - Date.now().valueOf() + 1000;
    loggers.test.log(`Will wait for ${waitFor2}ms for timelock2 to expire`);
    await delay(waitFor2);

    // Forcing balance updates
    await hWallet.preProcessWalletData();

    // Validating getBalance ( moment 2 )
    htrBalance = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(htrBalance[0].balance.locked).toBe(0);
    expect(htrBalance[0].balance.unlocked).toBe(10);

    // Confirm that now the balance is available
    const sendTx = await hWallet.sendTransaction(hWallet.getAddressAtIndex(4), 8);
    expect(sendTx).toHaveProperty('hash');
  });
});

describe('createNewToken', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should create a new token', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const addr0 = hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(addr0, 10);

    // Creating the new token
    const newTokenResponse = await hWallet.createNewToken(
      'TokenName',
      'TKN',
      100,
    );

    // Validating the creation tx
    expect(newTokenResponse).toHaveProperty('hash');
    expect(newTokenResponse).toHaveProperty('name', 'TokenName');
    expect(newTokenResponse).toHaveProperty('symbol', 'TKN');
    expect(newTokenResponse).toHaveProperty('version', 2);
    const tokenUid = newTokenResponse.hash;

    // Validating wallet balance is updated with this new token
    await waitForTxReceived(hWallet, tokenUid);
    const tknBalance = await hWallet.getBalance(tokenUid);
    expect(tknBalance[0].balance.unlocked).toBe(100);
  });

  it('should create a new token on the correct addresses', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const addr0 = hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(addr0, 10);

    // Creating the new token
    const destinationAddress = hWallet.getAddressAtIndex(4);
    const changeAddress = hWallet.getAddressAtIndex(8);
    const { hash: tokenUid } = await hWallet.createNewToken(
      'NewToken Name',
      'NTKN',
      100,
      {
        address: destinationAddress,
        changeAddress
      }
    );
    await waitForTxReceived(hWallet, tokenUid);

    // Validating the tokens are on the correct addresses
    const { utxos: utxosTokens } = hWallet.getUtxos({ token: tokenUid });
    expect(utxosTokens.find(u => u.address === destinationAddress))
      .toHaveProperty('amount', 100);

    const { utxos: utxosHtr } = hWallet.getUtxos();
    expect(utxosHtr.find(u => u.address === changeAddress))
      .toHaveProperty('amount', 9);
  });

  // TODO: Test creating token without mint/melt authority
});

describe('mintTokens', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should mint new tokens', async () => {
    // Setting up the custom token
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token to Mint',
      'TMINT',
      100,
    );

    // Minting more of the tokens
    const mintAmount = getRandomInt(100, 50);
    const mintResponse = await hWallet.mintTokens(tokenUid, mintAmount);
    expect(mintResponse.hash).toBeDefined();
    await waitForTxReceived(hWallet, mintResponse.hash);

    // Validating there is a correct reference to the custom token
    expect(mintResponse).toHaveProperty('tokens.length', 1);
    expect(mintResponse.tokens[0]).toEqual(tokenUid);

    // Validating a new mint authority was created by default
    const authorityOutputs = mintResponse.outputs.filter(
      o => transaction.isTokenDataAuthority(o.tokenData)
    );
    expect(authorityOutputs).toHaveLength(1);
    expect(authorityOutputs[0]).toHaveProperty('value', TOKEN_MINT_MASK);

    // Validating custom token balance
    const tokenBalance = await hWallet.getBalance(tokenUid);
    const expectedAmount = 100 + mintAmount;
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);
  });

  it('should deposit correct HTR values for minting', async () => {
    /**
     *
     * @param {HathorWallet} hWallet
     * @returns {Promise<number>}
     */
    async function getHtrBalance(hWallet) {
      const [htrBalance] = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
      return htrBalance.balance.unlocked;
    }

    // Setting up scenario
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token to Mint',
      'TMINT',
      100,
    );
    let expectedHtrFunds = 9;

    // Minting less than 100 tokens consumes 1 HTR
    let mintResponse;
    mintResponse = await hWallet.mintTokens(tokenUid, 1);
    expectedHtrFunds -= 1;
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Minting exactly 100 tokens consumes 1 HTR
    await waitUntilNextTimestamp(hWallet, mintResponse.hash);
    mintResponse = await hWallet.mintTokens(tokenUid, 100);
    expectedHtrFunds -= 1;
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Minting over 100 tokens consumes 2 HTR
    await waitUntilNextTimestamp(hWallet, mintResponse.hash);
    mintResponse = await hWallet.mintTokens(tokenUid, 101);
    expectedHtrFunds -= 2;
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Minting exactly 200 tokens consumes 2 HTR
    await waitUntilNextTimestamp(hWallet, mintResponse.hash);
    mintResponse = await hWallet.mintTokens(tokenUid, 200);
    expectedHtrFunds -= 2;
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Minting over 200 tokens consumes 3 HTR
    await waitUntilNextTimestamp(hWallet, mintResponse.hash);
    mintResponse = await hWallet.mintTokens(tokenUid, 201);
    expectedHtrFunds -= 3;
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);
  });
});

describe('meltTokens', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should melt tokens', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);

    // Creating the token
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token to Melt',
      'TMELT',
      100,
    );

    // Melting some tokens
    const meltAmount = getRandomInt(99, 10);
    const { hash } = await hWallet.meltTokens(tokenUid, meltAmount);
    await waitForTxReceived(hWallet, hash);

    // Validating custom token balance
    const tokenBalance = await hWallet.getBalance(tokenUid);
    const expectedAmount = 100 - meltAmount;
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);
  });

  it('should recover correct amount of HTR on melting', async () => {
    /**
     *
     * @param {HathorWallet} hWallet
     * @returns {Promise<number>}
     */
    async function getHtrBalance(hWallet) {
      const [htrBalance] = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
      return htrBalance.balance.unlocked;
    }

    // Setting up scenario
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 20);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token to Melt',
      'TMELT',
      1900
    );
    let expectedHtrFunds = 1;

    let meltResponse;
    // Melting less than 100 tokens recovers 0 HTR
    meltResponse = await hWallet.meltTokens(tokenUid, 99);
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting exactly 100 tokens recovers 1 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 100);
    expectedHtrFunds += 1;
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting less than 200 tokens recovers 1 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 199);
    expectedHtrFunds += 1;
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting exactly 200 tokens recovers 2 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 200);
    expectedHtrFunds += 2;
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting less than 300 tokens recovers 2 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 299);
    expectedHtrFunds += 2;
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);
  });
});

describe('delegateAuthority', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should delegate authority between wallets', async () => {
    const hWallet1 = await generateWalletHelper();
    const hWallet2 = await generateWalletHelper();

    // Creating a Custom Token on wallet 1
    await GenesisWalletHelper.injectFunds(hWallet1.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet1,
      'Delegate Token',
      'DTK',
      100,
    );

    // Delegating mint authority to wallet 2
    const { hash: delegateMintTxId } = await hWallet1.delegateAuthority(
      tokenUid,
      'mint',
      hWallet2.getAddressAtIndex(0)
    );
    await waitForTxReceived(hWallet1, delegateMintTxId);

    /*
     * Authority Token delegation usually takes longer than usual to be reflected on the local
     * caches. This forced recalculation will be executed before each authority validation below
     * to avoid a small possibility of the caches being obsolete at assertion time.
     */
    await delay(100);
    await hWallet1.preProcessWalletData();

    // Expect wallet 1 to still have one mint authority
    let authorities1 = await hWallet1.getMintAuthority(tokenUid);
    expect(authorities1).toHaveLength(1);
    expect(authorities1[0].txId).toEqual(delegateMintTxId);
    expect(authorities1[0].authorities).toEqual(1);
    // Expect wallet 2 to also have one mint authority
    await hWallet1.preProcessWalletData();
    let authorities2 = await hWallet2.getMintAuthority(tokenUid);
    expect(authorities2).toHaveLength(1);
    expect(authorities2[0].txId).toEqual(delegateMintTxId);
    expect(authorities2[0].authorities).toEqual(1);

    // Delegating melt authority to wallet 2
    await waitUntilNextTimestamp(hWallet1, delegateMintTxId);
    const { hash: delegateMeltTxId } = await hWallet1.delegateAuthority(
      tokenUid,
      'melt',
      hWallet2.getAddressAtIndex(0)
    );
    await waitForTxReceived(hWallet1, delegateMeltTxId);

    // Expect wallet 1 to still have one melt authority
    await hWallet1.preProcessWalletData();
    authorities1 = await hWallet1.getMeltAuthority(tokenUid);
    expect(authorities1).toHaveLength(1);
    expect(authorities1[0].txId).toEqual(delegateMeltTxId);
    expect(authorities1[0].authorities).toEqual(2);
    // Expect wallet 2 to also have one melt authority
    await hWallet1.preProcessWalletData();
    authorities2 = await hWallet2.getMeltAuthority(tokenUid);
    expect(authorities2).toHaveLength(1);
    expect(authorities2[0].txId).toEqual(delegateMeltTxId);
    expect(authorities2[0].authorities).toEqual(2);
  });

  it('should delegate authority to another wallet without keeping one', async () => {
    const hWallet1 = await generateWalletHelper();
    const hWallet2 = await generateWalletHelper();

    // Creating a Custom Token on wallet 1
    await GenesisWalletHelper.injectFunds(hWallet1.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet1,
      'Delegate Token',
      'DTK',
      100,
    );

    // Delegate mint authority without keeping one on wallet 1
    const { hash: giveAwayMintTx } = await hWallet1.delegateAuthority(
      tokenUid,
      'mint',
      hWallet2.getAddressAtIndex(0),
      { createAnother: false }
    );
    await waitForTxReceived(hWallet1, giveAwayMintTx);

    // Validating error on mint tokens from Wallet 1
    waitUntilNextTimestamp(hWallet1, giveAwayMintTx);
    expect(hWallet1.mintTokens(tokenUid, 100)).rejects.toThrow();
    // TODO: The type of errors on mint and melt are different. They should have a standard.

    // Validating sucess on mint tokens from Wallet 2
    await GenesisWalletHelper.injectFunds(hWallet2.getAddressAtIndex(0), 10);
    const mintTxWallet2 = await hWallet2.mintTokens(tokenUid, 100);
    expect(mintTxWallet2).toHaveProperty('hash');

    // Delegate melt authority without keeping one on wallet 1
    const { hash: giveAwayMeltTx } = await hWallet1.delegateAuthority(
      tokenUid,
      'melt',
      hWallet2.getAddressAtIndex(0),
      { createAnother: false }
    );
    await waitForTxReceived(hWallet1, giveAwayMeltTx);

    // Validating error on mint tokens from Wallet 1
    await waitUntilNextTimestamp(hWallet1, giveAwayMeltTx);
    const meltTxWallet1 = await hWallet1.meltTokens(tokenUid, 100)
      .catch(err => err);
    expect(meltTxWallet1).toHaveProperty('success', false);
    expect(meltTxWallet1.message).toContain('authority output');

    // Validating sucess on melt tokens from Wallet 2
    const meltTxWallet2 = await hWallet2.meltTokens(tokenUid, 50);
    expect(meltTxWallet2).toHaveProperty('hash');
  });
});

describe('destroyAuthority', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should destroy mint authorities', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token for MintDestroy',
      'DMINT',
      100
    );

    // Adding another mint authority
    const { hash: newMintTx } = await hWallet.delegateAuthority(
      tokenUid,
      'mint',
      hWallet.getAddressAtIndex(0)
    );
    await waitForTxReceived(hWallet, newMintTx);

    // Validating though getMintAuthority
    let mintAuthorities = await hWallet.getMintAuthority(tokenUid, { many: true });
    expect(mintAuthorities).toHaveLength(2);

    // Destroying one mint authority
    await waitUntilNextTimestamp(hWallet, newMintTx);
    const { hash: destroyMintTx } = await hWallet.destroyAuthority(tokenUid, 'mint', 1);
    await waitForTxReceived(hWallet, destroyMintTx);
    mintAuthorities = await hWallet.getMintAuthority(tokenUid, { many: true });
    expect(mintAuthorities).toHaveLength(1);

    // Destroying all mint authorities
    await waitUntilNextTimestamp(hWallet, destroyMintTx);
    const { hash: destroyAllMintTx } = await hWallet.destroyAuthority(tokenUid, 'mint', 1);
    await waitForTxReceived(hWallet, destroyAllMintTx);
    mintAuthorities = await hWallet.getMintAuthority(tokenUid, { many: true });
    expect(mintAuthorities).toHaveLength(0);

    // Trying to mint and validating its error object
    await waitUntilNextTimestamp(hWallet, destroyAllMintTx);
    const mintFailure = await hWallet.mintTokens(tokenUid, 100)
      .catch(err => err);

    // TODO: This is not the desired outcome. A fix should be implemented.
    expect(mintFailure).toBeInstanceOf(TypeError);
    expect(mintFailure.message).toEqual('this.transaction.inputs is not iterable');
  });

  it('should destroy melt authorities', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token for MeltDestroy',
      'DMELT',
      100
    );

    // Adding another melt authority
    const { hash: newMeltTx } = await hWallet.delegateAuthority(
      tokenUid,
      'melt',
      hWallet.getAddressAtIndex(0)
    );
    await waitForTxReceived(hWallet, newMeltTx);

    // Validating though getMintAuthority
    let meltAuthorities = await hWallet.getMeltAuthority(tokenUid, { many: true });
    expect(meltAuthorities).toHaveLength(2);

    // Destroying one melt authority
    await waitUntilNextTimestamp(hWallet, newMeltTx);
    const { hash: destroyMeltTx } = await hWallet.destroyAuthority(tokenUid, 'melt', 1);
    await waitForTxReceived(hWallet, destroyMeltTx);
    meltAuthorities = await hWallet.getMeltAuthority(tokenUid, { many: true });
    expect(meltAuthorities).toHaveLength(1);

    // Destroying all melt authorities
    await waitUntilNextTimestamp(hWallet, destroyMeltTx);
    const { hash: destroyAllMintTx } = await hWallet.destroyAuthority(tokenUid, 'melt', 1);
    await waitForTxReceived(hWallet, destroyAllMintTx);
    meltAuthorities = await hWallet.getMeltAuthority(tokenUid, { many: true });
    expect(meltAuthorities).toHaveLength(0);

    // Trying to melt and validating its error object
    const meltFailure = await hWallet.meltTokens(tokenUid, 100)
      .catch(err => err);
    expect(meltFailure).toHaveProperty('success', false);
    expect(meltFailure.message).toContain('authority output');
  });
});

describe('createNFT', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should create an NFT with mint/melt authorities', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 100);

    // Creating one NFT with default authorities
    const nftTx = await hWallet.createNFT(
      'New NFT',
      'NNFT',
      1,
      sampleNftAddress,
      {
        createMint: true,
        createMelt: true
      },
    );
    expect(nftTx.hash).toBeDefined();
    expect(nftTx.name).toEqual('New NFT');
    expect(nftTx.symbol).toEqual('NNFT');
    await waitForTxReceived(hWallet, nftTx.hash);

    // Validating HTR fee payment
    const htrBalance = await hWallet.getBalance(HATHOR_TOKEN_CONFIG.uid);
    expect(htrBalance[0].balance.unlocked).toEqual(98); // 1 deposit, 1 fee
    let nftBalance = await hWallet.getBalance(nftTx.hash);
    expect(nftBalance[0].balance.unlocked).toEqual(1);

    /*
     * Since NFT authority tokens cannot be read by getMintAuthority, we will try to actually
     * mint tokens to confirm the authority exists.
     */
    await waitUntilNextTimestamp(hWallet, nftTx.hash);
    const rawMintTx = await hWallet.mintTokens(
      nftTx.hash,
      10,
    );
    expect(rawMintTx).toHaveProperty('hash');
    await waitForTxReceived(hWallet, rawMintTx.hash);
    nftBalance = await hWallet.getBalance(nftTx.hash);
    expect(nftBalance[0].balance.unlocked).toEqual(11);

    /*
     * Since NFT authority tokens cannot be read by getMeltAuthority, we will try to actually
     * melt tokens to confirm the authority exists.
     */
    await waitUntilNextTimestamp(hWallet, rawMintTx.hash);
    const htrMelt = await hWallet.meltTokens(
      nftTx.hash,
      5,
    );
    expect(htrMelt).toHaveProperty('hash');
    await waitForTxReceived(hWallet, htrMelt.hash);
    nftBalance = await hWallet.getBalance(nftTx.hash);
    expect(nftBalance[0].balance.unlocked).toEqual(6);
  });

  // TODO: Test NFTs without mint/melt authorities. Maybe use getUtxos when their tests are done.
});

describe('getToken methods', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should get the correct responses for a valid token', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);

    // Validating `getTokenDetails` for custom token not in this wallet
    expect(hWallet.getTokenDetails(fakeTokenUid)).rejects.toThrow();

    // Validating `getTokens` for no custom tokens
    let getTokensResponse = await hWallet.getTokens();
    expect(getTokensResponse).toHaveLength(1);
    expect(getTokensResponse[0]).toEqual(HATHOR_TOKEN_CONFIG.uid);

    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Details Token',
      'DTOK',
      100
    );

    // Validating `getTokens` response for having custom tokens
    getTokensResponse = await hWallet.getTokens();
    expect(getTokensResponse).toHaveLength(2);
    expect(getTokensResponse[0]).toEqual(HATHOR_TOKEN_CONFIG.uid);
    expect(getTokensResponse[1]).toEqual(tokenUid);

    // Validate `getTokenDetails` response for a valid token
    let details = await hWallet.getTokenDetails(tokenUid);
    expect(details.totalSupply).toEqual(100);
    expect(details.totalTransactions).toEqual(1);
    expect(details.tokenInfo.name).toEqual('Details Token');
    expect(details.tokenInfo.symbol).toEqual('DTOK');
    expect(details.authorities.mint).toEqual(true);
    expect(details.authorities.melt).toEqual(true);

    // Emptying the custom token
    const { hash: meltTx } = await hWallet.meltTokens(tokenUid, 100);
    await waitForTxReceived(hWallet, meltTx);

    // Validating `getTokenDetails` response
    details = await hWallet.getTokenDetails(tokenUid);
    expect(details.totalSupply).toEqual(0);
    expect(details.totalTransactions).toEqual(2);
    expect(details.authorities.mint).toEqual(true);
    expect(details.authorities.melt).toEqual(true);

    // Destroying mint authority and validating getTokenDetails results
    await waitUntilNextTimestamp(hWallet, meltTx);
    const { hash: dMintTx } = await hWallet.destroyAuthority(tokenUid, 'mint', 1);
    await waitForTxReceived(hWallet, dMintTx);
    details = await hWallet.getTokenDetails(tokenUid);
    expect(details.totalTransactions).toEqual(2);
    expect(details.authorities.mint).toEqual(false);
    expect(details.authorities.melt).toEqual(true);

    // Destroying melt authority and validating getTokenDetails results
    await waitUntilNextTimestamp(hWallet, dMintTx);
    const { hash: dMeltTx } = await hWallet.destroyAuthority(tokenUid, 'melt', 1);
    await waitForTxReceived(hWallet, dMeltTx);
    details = await hWallet.getTokenDetails(tokenUid);
    expect(details.totalTransactions).toEqual(2);
    expect(details.authorities.mint).toEqual(false);
    expect(details.authorities.melt).toEqual(false);

    // Validating `getTokens` response has not changed
    getTokensResponse = await hWallet.getTokens();
    expect(getTokensResponse).toHaveLength(2);
    expect(getTokensResponse[0]).toEqual(HATHOR_TOKEN_CONFIG.uid);
    expect(getTokensResponse[1]).toEqual(tokenUid);
  });
});

describe('getTxHistory', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  let gWallet;
  beforeAll(async () => {
    const { hWallet } = await GenesisWalletHelper.getSingleton();
    gWallet = hWallet;
  });

  afterAll(() => {
    gWallet.stop();
  });

  it('should show htr transactions in correct order', async () => {
    const hWallet = await generateWalletHelper();

    let txHistory = await hWallet.getTxHistory();
    expect(txHistory).toHaveLength(0);

    // HTR transaction incoming
    const tx1 = await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);
    txHistory = await hWallet.getTxHistory();
    expect(txHistory).toHaveLength(1);
    expect(txHistory[0].txId).toEqual(tx1.hash);
    expect(txHistory[0].tokenUid).toEqual(HATHOR_TOKEN_CONFIG.uid);
    expect(txHistory[0].balance).toEqual(10);

    // HTR internal transfer
    const tx2 = await hWallet.sendTransaction(hWallet.getAddressAtIndex(1), 4);
    await waitForTxReceived(hWallet, tx2.hash);
    txHistory = await hWallet.getTxHistory();
    expect(txHistory).toHaveLength(2);
    expect(txHistory[0].txId).toEqual(tx2.hash);
    expect(txHistory[0].balance).toEqual(0); // No change in balance, just transfer

    // HTR external transfer
    await waitUntilNextTimestamp(hWallet, tx2.hash);
    const tx3 = await hWallet.sendTransaction(gWallet.getAddressAtIndex(0), 3);
    await waitForTxReceived(hWallet, tx3.hash);
    txHistory = await hWallet.getTxHistory();
    expect(txHistory).toHaveLength(3);
    expect(txHistory[0].txId).toEqual(tx3.hash);
    expect(txHistory[0].balance).toEqual(-3); // 3 less

    // Count option
    txHistory = await hWallet.getTxHistory({ count: 2 });
    expect(txHistory.length).toEqual(2);
    expect(txHistory[0].txId).toEqual(tx3.hash);
    expect(txHistory[1].txId).toEqual(tx2.hash);

    // Skip option
    txHistory = await hWallet.getTxHistory({ skip: 2 });
    expect(txHistory.length).toEqual(1);
    expect(txHistory[0].txId).toEqual(tx1.hash);

    // Count + Skip options
    txHistory = await hWallet.getTxHistory({
      count: 2,
      skip: 1
    });
    expect(txHistory.length).toEqual(2);
    expect(txHistory[0].txId).toEqual(tx2.hash);
    expect(txHistory[1].txId).toEqual(tx1.hash);
  });

  it('should show custom token transactions in correct order', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet.getAddressAtIndex(0), 10);

    let txHistory = await hWallet.getTxHistory({
      token_id: fakeTokenUid,
    });
    expect(txHistory).toHaveLength(0);

    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'txHistory Token',
      'TXHT',
      100
    );

    // Custom token creation
    txHistory = await hWallet.getTxHistory({ token_id: tokenUid });
    expect(txHistory).toHaveLength(1);
    expect(txHistory[0].txId).toEqual(tokenUid);
    expect(txHistory[0].balance).toEqual(100);

    // Custom token internal transfer
    const { hash: tx1Hash } = await hWallet.sendTransaction(
      hWallet.getAddressAtIndex(0),
      10,
      { token: tokenUid }
    );
    await waitForTxReceived(hWallet, tx1Hash);
    txHistory = await hWallet.getTxHistory({ token_id: tokenUid });
    expect(txHistory).toHaveLength(2);
    expect(txHistory[0].txId).toEqual(tx1Hash);
    expect(txHistory[0].balance).toEqual(0); // No change in balance, just transfer

    // Custom token external transfer
    await waitUntilNextTimestamp(hWallet, tx1Hash);
    const { hash: tx2Hash } = await hWallet.sendTransaction(
      gWallet.getAddressAtIndex(0),
      10,
      { token: tokenUid }
    );
    await waitForTxReceived(hWallet, tx2Hash);
    txHistory = await hWallet.getTxHistory({ token_id: tokenUid });
    expect(txHistory).toHaveLength(3);
    expect(txHistory[0].txId).toEqual(tx2Hash);
    expect(txHistory[0].balance).toEqual(-10); // 10 less

    // Custom token melting
    await waitUntilNextTimestamp(hWallet, tx2Hash);
    const { hash: tx3Hash } = await hWallet.meltTokens(tokenUid, 20);
    await waitForTxReceived(hWallet, tx3Hash);
    txHistory = await hWallet.getTxHistory({ token_id: tokenUid });
    expect(txHistory).toHaveLength(4);
    expect(txHistory[0].txId).toEqual(tx3Hash);
    expect(txHistory[0].balance).toEqual(-20); // 20 less

    // Custom token minting
    await waitUntilNextTimestamp(hWallet, tx3Hash);
    const { hash: tx4Hash } = await hWallet.mintTokens(tokenUid, 30);
    await waitForTxReceived(hWallet, tx4Hash);
    txHistory = await hWallet.getTxHistory({ token_id: tokenUid });
    expect(txHistory).toHaveLength(5);
    expect(txHistory[0].txId).toEqual(tx4Hash);
    expect(txHistory[0].balance).toEqual(30); // 30 more

    // Count option
    txHistory = await hWallet.getTxHistory({
      token_id: tokenUid,
      count: 3
    });
    expect(txHistory.length).toEqual(3);
    expect(txHistory[0].txId).toEqual(tx4Hash);
    expect(txHistory[1].txId).toEqual(tx3Hash);
    expect(txHistory[2].txId).toEqual(tx2Hash);

    // Skip option
    txHistory = await hWallet.getTxHistory({
      token_id: tokenUid,
      skip: 3
    });
    expect(txHistory.length).toEqual(2);
    expect(txHistory[0].txId).toEqual(tx1Hash);
    expect(txHistory[1].txId).toEqual(tokenUid);

    // Count + Skip options
    txHistory = await hWallet.getTxHistory({
      token_id: tokenUid,
      skip: 2,
      count: 2
    });
    expect(txHistory.length).toEqual(2);
    expect(txHistory[0].txId).toEqual(tx2Hash);
    expect(txHistory[1].txId).toEqual(tx1Hash);
  });
});

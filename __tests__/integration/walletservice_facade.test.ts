import HathorWalletServiceWallet from '../../src/wallet/wallet';
import {
  CreateTokenTransaction,
  MemoryStore,
  FeeHeader,
  Storage,
  Network,
  transactionUtils,
} from '../../src';
import { WALLET_CONSTANTS } from './configuration/test-constants';
import { NATIVE_TOKEN_UID } from '../../src/constants';
import {
  buildWalletInstance,
  emptyWallet,
  initializeServiceGlobalConfigs,
  pollForTx,
} from './helpers/service-facade.helper';
import { SendTxError, UtxoError, WalletRequestError } from '../../src/errors';
import { GetAddressesObject } from '../../src/wallet/types';
import { TokenVersion, WalletAddressMode } from '../../src/types';
import { GenesisWalletServiceHelper } from './helpers/genesis-wallet.helper';

// Set base URL for the wallet service API inside the privatenet test container
initializeServiceGlobalConfigs();

/** Genesis Wallet, used to fund all tests. Assigned in beforeAll. */
let gWallet: HathorWalletServiceWallet;
/** Wallet instance used in tests */
let wallet: HathorWalletServiceWallet;
const addressesWallet = {
  words:
    'pumpkin tank father organ can doll romance damage because barely vault pride will man rack horn lamp remove enemy brain desert exchange boil salon',
  addresses: [
    'WRsDG9VhM4N9DPSpbnpFKnngLEXonaBsuH',
    'WSTMdCz4BuzGv5q6g8woaCHeyppTZdjXWx',
    'WPbCV3Lrh28ntoQY2hvC2ppU5TimCZdRaw',
    'WaAgCebJjWfQCKcDwtpffQ4kt2im7fbsUr',
    'WXN2wRybweJY4xunPkz6pwfGUmoumCCcUP',
    'WbEA4E7Rnx98TtRox3UazMQRm1yNoAJcfm',
    'WZs2Ci9ZxyMzmfdbGfR2nTp9xsxS7rSsDN',
    'Wf1waSNgXmMoitFjx7TADMemKyCWjhvLUb',
    'WVTMecGGC9kGzUbQqjB4J7i4KVhLVyMagy',
    'WjHom47afCW8qEFtBqMq3MT22zxLkuvQag',
  ],
};
const feeTokenWallet = {
  words:
    'keen kit sentence twenty color you ability way casino broom blossom pink adapt memory entry beach theory anxiety vendor student fork inch coin stumble',
  addresses: [
    'WPrDUUpuufRCByRvxCcb4U7RL2UNoxoSsq',
    'Wd2YDVD3YhyAnC4NSKbGR9aP2U6CTDF7Ja',
    'Wb2V7KtBpsB1G3dHTojUFN5csmXap9YmRp',
    'Wj1zD6XyrvPo4rnh1XUe3TVFNzyyaHJREw',
    'WjBJV5MAwXUXzcdZS2eCLzfDXmJDBbrNRa',
    'WfBsRc5nP5Vva5wLUa9DJkBc4RKT8hQ4Bi',
    'WNrAJ5xsbLLfSTxu7iP8bzhGrEK9GXscac',
    'WSgR5fExGsKPtFv4uFyEzojTjhtSdPiZyc',
    'WUBJyFdhWEfwmJFcH59Acwp5LjVp2y5bDX',
    'WPzdPxrUcatvMprWBLDnao6CXWxks59AkE',
  ],
};
/** Dedicated wallet for tests that require an empty wallet (never funded) */
const emptyFeeWallet = {
  words:
    'feel video weapon cradle taste liar produce category balance knife crunch still discover door awful decorate divorce eager empty link word ride call slogan',
  addresses: [
    'WmnBf7FqCh8UvD81Wyxo7pJmJeGKpHXE8f',
    'WbQ6See4d84zKEbf4jBsgDgYnQwYUe4yq3',
    'WYbqDqmcSVvqoCkxUht5LWxeduHN8vVv5p',
    'WPM3GUmLN8ksaxxdN2hEG5kUqsL3q4jzUv',
    'WQsgazdmWioqqRT8nFuUKj8B7FgPRqZxJ3',
    'Wbva7MG1CQp83WtVFGxkKDYZ3BTpfZoKJC',
    'WeU2mUfHVNkNKQq6wU42a39D2hWqcmps5W',
    'WX85ehjqnv9rwRYqS8dKoXdGJhCtNKkmQd',
    'WQZysm8wLjZqy3j39RwShNFFFGfy17D9xw',
    'Wfh8oHVEJcUqLeyX9k8YCF6Lnq8Q5wT3in',
  ],
};
const singleAddressWallet1 = {
  words:
    'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind',
  addresses: [
    'WewDeXWyvHP7jJTs7tjLoQfoB72LLxJQqN',
    'WmtWgtk5GxdcDKwjNwmXXn74nQWTPWhKfx',
    'WPynsVhyU6nP7RSZAkqfijEutC88KgAyFc',
    'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp',
    'WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi',
    'Wc4dKp6hBgr5PU9gBmzJofc93XZGAEEUXD',
    'WUujvZnk3LMbFWUW7CnZbjn5JZzALaqLfm',
    'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ',
    'WXN7sf6WzhpESgUuRCBrjzjzHtWTCfV8Cq',
    'WYaMN32qQ9CAUNsDnbtwi1U41JY9prYhvR',
    'WWbt2ww4W45YLUAumnumZiyWrABYDzCTdN',
    'WgpRs9NxhkBPxe7ptm9RcuLdABb7DdVUA5',
    'WPzpVP34vx6X5Krj4jeiQz9VW87F4LEZnV',
    'WSn9Bn6EDPSWZqNQdpV3FxGjpTEMsqQHYQ',
    'WmYnieT3vzzY83eHphQHs6HJ5mYyPwcKSE',
    'WZfcHjgkfK9UroTzpiricB6gtg99QKraG1',
    'WiHovoQ5ZLKPpQjZYkLVeoVgP7LoVLK518',
    'Wi5AvNTnh4mZft65kzsRbDYEPGbTRhd5q3',
    'Weg6WEncAEJs5qDbGUxcLTR3iycM3hrt4C',
    'WSVarF73e6UVccGwb44FvTtqFWsHQmjKCt',
  ],
};
const singleAddressWallet2 = {
  words:
    'glad drop admit april disagree picnic claim soon permit ethics cross soul pulp desert weather capital praise nose wise color else flock royal merit',
  addresses: [
    'WjE2yiEeBYSoHLnTXkGgJvB1Afn3vG3LX6',
    'WaGshSrBBCrWAjAgNHZSU3DJXTysAso5q3',
    'WS3LUTDKSgejR28v6Gi2ejT3RH2diDAS3g',
    'WR6188ey4v6BUfY29UyHgMaVLmqQ7PGxFa',
    'WTPeL8fApUQgz7UhaL694Xqt4YcDTPMGu1',
    'WdqpeFjGoUhT8Kyfbc2qjFyRsy6agwe3VU',
    'WZMjeMMnx3BPNagTqbHW2XkP1nrzxPVGCw',
    'WPgxrd5BcfDpMynrsWXAySbLhS6DCmTeKL',
    'WY7NCX2j98VfStbTyyxgai9y3xma63W1Bk',
    'WYYsfkTSRQ6fzQtdeSVMYLsPkBA6MemPhv',
    'Wjzb9KiBVL4xNArQd8ckR3UtvBmYo8NxYG',
    'WdCyoh1JzvxJhgQcrCVkZ3SpAoUwqVSEfS',
    'WfFpwweGNQ1QurAwqYLwSuccHcUz12q3Zi',
    'Wddb5Maxq6B7rFYH1JZJvZY7kTQezwrafL',
    'Wfw58Z5GrYfp4Ecmg1hDLBCQspPQC2gpqH',
    'WU931UJrREpFn8dhi3HNn4nLNkVjx9hdj5',
    'WakAnQEvsUgxUd8kGkmeeaUPC2XNPDXxFu',
    'WZUBn2K9evu3U9jPe8Y92LvYFWgctVov9L',
    'Whwv9XaKtDUpyXpEJPhvT9WdQEpfeeadr1',
    'WUL7Bc2o7ekAZHo19YVZCjc5As1ZeM3XRv',
  ],
};

/** Default pin to simplify the tests */
const pinCode = '123456';
/** Default password to simplify the tests */
const password = 'testpass';

beforeAll(async () => {
  await GenesisWalletServiceHelper.start();
  gWallet = await GenesisWalletServiceHelper.getSingleton();
});

afterAll(async () => {
  await GenesisWalletServiceHelper.stop();
});

describe('empty wallet address methods', () => {
  const knownAddresses = emptyWallet.addresses;
  const unknownAddress = WALLET_CONSTANTS.miner.addresses[0];

  beforeEach(async () => {
    ({ wallet } = await buildWalletInstance({ words: emptyWallet.words }));
    await wallet.start({ pinCode, password });
  });

  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true });
    }
  });

  it('getAddressIndex returns correct index for known address', async () => {
    for (let i = 0; i < knownAddresses.length; i++) {
      const index = await wallet.getAddressIndex(knownAddresses[i]);
      expect(index).toBe(i);
    }
  });

  it('getAddressIndex returns null for unknown address', async () => {
    const index = await wallet.getAddressIndex(unknownAddress);
    expect(index).toBeNull();
  });

  it('getAddressPathForIndex returns correct path for index', async () => {
    for (let i = 0; i < knownAddresses.length; i++) {
      const path = await wallet.getAddressPathForIndex(i);
      expect(path.endsWith(`/${i}`)).toBe(true);
      expect(path).toMatch(/m\/44'\/280'\/0'\/0\/[0-9]+/);
    }
  });

  it('getAddressAtIndex returns correct address for index', async () => {
    for (let i = 0; i < knownAddresses.length; i++) {
      const address = await wallet.getAddressAtIndex(i);
      expect(address).toBe(knownAddresses[i]);
    }
  });

  it('getAddressPrivKey returns HDPrivateKey for known index', async () => {
    for (let i = 0; i < knownAddresses.length; i++) {
      const privKey = await wallet.getAddressPrivKey(pinCode, i);
      expect(privKey.constructor.name).toBe('HDPrivateKey');
      // Should have a publicKey and privateKey
      expect(privKey.publicKey).toBeDefined();
      expect(privKey.privateKey).toBeDefined();
    }
  });

  it('isAddressMine returns true for known addresses', async () => {
    for (const address of knownAddresses) {
      const result = await wallet.isAddressMine(address);
      expect(result).toBe(true);
    }
  });

  it('isAddressMine returns false for unknown address', async () => {
    const result = await wallet.isAddressMine(unknownAddress);
    expect(result).toBe(false);
  });

  it('checkAddressesMine returns correct map for known and unknown addresses', async () => {
    const addresses = [...knownAddresses, unknownAddress];
    const result = await wallet.checkAddressesMine(addresses);
    for (let i = 0; i < knownAddresses.length; i++) {
      expect(result[knownAddresses[i]]).toBe(true);
    }
    expect(result[unknownAddress]).toBe(false);
  });

  it('getPrivateKeyFromAddress returns PrivateKey for known address', async () => {
    for (const address of knownAddresses) {
      const privKey = await wallet.getPrivateKeyFromAddress(address, { pinCode });
      expect(privKey.constructor.name).toBe('PrivateKey');
      expect(privKey.toString()).toMatch(/[A-Fa-f0-9]{64}/);
    }
  });

  it('getPrivateKeyFromAddress throws for unknown address', async () => {
    await expect(wallet.getPrivateKeyFromAddress(unknownAddress, { pinCode })).rejects.toThrow(
      /does not belong to this wallet/
    );
  });
});

describe.skip('websocket events', () => {});

// balances tests moved to shared/get-balance.test.ts and service-specific/get-balance.test.ts

describe('address management methods', () => {
  const knownAddresses = addressesWallet.addresses;

  beforeEach(async () => {
    ({ wallet } = await buildWalletInstance({ words: addressesWallet.words }));
    await wallet.start({ pinCode, password });
  });

  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true });
    }
  });

  describe('getAllAddresses', () => {
    it('should return expected addresses on getAllAddresses', async () => {
      const allAddresses: GetAddressesObject[] = [];
      for await (const addr of wallet.getAllAddresses()) {
        allAddresses.push(addr);
      }

      // Should return an array of addresses
      expect(allAddresses.length).toBeGreaterThan(0);

      // Should include the known addresses from addressesWallet
      allAddresses.forEach(addrObj => {
        expect(knownAddresses).toContain(addrObj.address);
      });

      // Should be in order (index 0, 1, 2, etc.)
      for (let i = 0; i < knownAddresses.length; i++) {
        expect(allAddresses[i].address).toBe(knownAddresses[i]);
      }
    });

    it('should return consistent results on multiple calls', async () => {
      const allAddressesFirstCall: GetAddressesObject[] = [];
      for await (const addr of wallet.getAllAddresses()) {
        allAddressesFirstCall.push(addr);
      }
      const allAddressesSecondCall: GetAddressesObject[] = [];
      for await (const addr of wallet.getAllAddresses()) {
        allAddressesSecondCall.push(addr);
      }

      expect(allAddressesFirstCall.length).toBe(allAddressesSecondCall.length);
      expect(allAddressesFirstCall).toEqual(allAddressesSecondCall);
    });
  });

  describe('getCurrentAddress, getNextAddress', () => {
    it('should return current address with index and address string', () => {
      const currentAddress = wallet.getCurrentAddress();

      // Should return an object with index and address
      expect(currentAddress).toEqual(
        expect.objectContaining({
          index: expect.any(Number),
          address: expect.any(String),
        })
      );

      expect(currentAddress.index).toBeGreaterThanOrEqual(0);
      expect(knownAddresses).toContain(currentAddress.address);
      expect(currentAddress.addressPath).toMatch(/^m\/44'\/280'\/0'\/0\/\d+$/);
      expect(currentAddress.info).toBeFalsy();
    });

    it('should return consistent results when called multiple times without changes', () => {
      const first = wallet.getCurrentAddress();
      const second = wallet.getCurrentAddress();

      expect(first).toEqual(second);
    });

    it('should mark addresses as used and not return them anymore', async () => {
      const initialCurrent = wallet.getCurrentAddress();
      const secondCurrent = wallet.getCurrentAddress({ markAsUsed: true });
      const thirdCurrent = wallet.getCurrentAddress();

      expect(initialCurrent).toEqual(secondCurrent);
      expect(thirdCurrent.index).toBe(secondCurrent.index + 1);
      expect(thirdCurrent.address).not.toBe(secondCurrent.address);
    });

    it('should have the same mark as used behavior with getNextAddress', async () => {
      const currentBefore = wallet.getCurrentAddress();
      const nextAddress = wallet.getNextAddress();
      const currentAfter = wallet.getCurrentAddress();

      expect(nextAddress.index).toBe(currentBefore.index + 1);
      expect(nextAddress.address).not.toBe(currentBefore.address);
      expect(currentAfter).toEqual(nextAddress);
    });

    it('should inform when the limit for new addresses has been reached', async () => {
      // Advance to near the end of known addresses
      for (let i = 0; i < knownAddresses.length - 1; i++) {
        wallet.getNextAddress();
      }

      const current = wallet.getNextAddress();
      expect(current.index).toBe(knownAddresses.length - 1);
      expect(current.address).toBe(knownAddresses[knownAddresses.length - 1]);
      expect(current.info).toBe('GAP_LIMIT_REACHED');
    });
  });

  describe('getAddressDetails', () => {
    it('should return details for known addresses', async () => {
      // Test first known addresses to verify index mapping
      for (let i = 0; i < knownAddresses.length; i++) {
        const details = await wallet.getAddressDetails(knownAddresses[i]);
        expect(details).toEqual(
          expect.objectContaining({
            address: knownAddresses[i],
            index: i,
            transactions: 0,
            seqnum: 0,
          })
        );
      }
    });

    it('should throw error for unknown address', async () => {
      const unknownAddress = WALLET_CONSTANTS.miner.addresses[0];

      await expect(wallet.getAddressDetails(unknownAddress)).rejects.toThrow(WalletRequestError);
    });
  });
});

describe('Fee-based tokens', () => {
  let feeWallet: HathorWalletServiceWallet;

  afterEach(async () => {
    if (feeWallet) {
      await feeWallet.stop({ cleanStorage: true });
    }
  });

  it('should create a fee token and charge correct fee', async () => {
    // Setup wallet and fund it
    const initialFunding = 10n;
    const fundTx = await gWallet.sendTransaction(feeTokenWallet.addresses[0], initialFunding, {
      pinCode,
    });
    await pollForTx(gWallet, fundTx.hash!);

    ({ wallet: feeWallet } = await buildWalletInstance({ words: feeTokenWallet.words }));
    await feeWallet.start({ pinCode, password });
    await pollForTx(feeWallet, fundTx.hash!);

    // Capture HTR balance before token creation
    let htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const htrBeforeCreate = htrBalance[0].balance.unlocked;

    // Create fee token
    const tokenAmount = 8582n;
    const createTokenTx = (await feeWallet.createNewToken('FeeToken', 'FTK', tokenAmount, {
      pinCode,
      tokenVersion: TokenVersion.FEE,
    })) as CreateTokenTransaction;
    await pollForTx(feeWallet, createTokenTx.hash!);

    // Validate transaction structure before sending it
    expect(createTokenTx).toMatchObject({
      hash: expect.any(String),
      name: 'FeeToken',
      symbol: 'FTK',
      tokenVersion: TokenVersion.FEE,
    });

    // Fee: only token output pays fee = 0.01 HTR (authorities don't pay fee)
    expect(createTokenTx.headers).toHaveLength(1);
    expect(createTokenTx.headers[0].entries[0].amount).toBe(1n);

    // HTR charged fee only (not 1% deposit)
    htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBeforeCreate - htrBalance[0].balance.unlocked).toBe(1n);

    // Token balance - should be 8582n (same as token amount)
    const tokenBalance = await feeWallet.getBalance(createTokenTx.hash!);
    expect(tokenBalance[0].balance.unlocked).toBe(tokenAmount);

    // Token version via getTokenDetails
    const tokenDetails = await feeWallet.getTokenDetails(createTokenTx.hash!);
    expect(tokenDetails.tokenInfo?.version).toBe(TokenVersion.FEE);
  });

  it('should create a fee token without authorities and charge same fee', async () => {
    // Setup wallet and fund it
    const initialFunding = 10n;
    const fundTx = await gWallet.sendTransaction(feeTokenWallet.addresses[0], initialFunding, {
      pinCode,
    });
    await pollForTx(gWallet, fundTx.hash!);

    ({ wallet: feeWallet } = await buildWalletInstance({ words: feeTokenWallet.words }));
    await feeWallet.start({ pinCode, password });
    await pollForTx(feeWallet, fundTx.hash!);

    // Capture HTR balance before token creation
    let htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const htrBeforeCreate = htrBalance[0].balance.unlocked;

    // Create fee token without authorities
    const tokenAmount = 500n;
    const createTokenTx = (await feeWallet.createNewToken('NoAuthFeeToken', 'NAFT', tokenAmount, {
      pinCode,
      tokenVersion: TokenVersion.FEE,
      createMint: false,
      createMelt: false,
    })) as CreateTokenTransaction;
    await pollForTx(feeWallet, createTokenTx.hash!);

    // Fee: same 0.01 HTR (authorities don't affect fee)
    expect(createTokenTx.headers).toHaveLength(1);
    expect((createTokenTx.headers[0] as FeeHeader).entries[0].amount).toBe(1n);

    // HTR charged fee only - verify relative change
    htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBeforeCreate - htrBalance[0].balance.unlocked).toBe(1n);

    // Validate no authority outputs
    const authorityOutputs = createTokenTx.outputs.filter(
      o => o.tokenData === 129 // AUTHORITY_TOKEN_DATA + 1
    );
    expect(authorityOutputs).toHaveLength(0);

    // Token details
    const tokenDetails = await feeWallet.getTokenDetails(createTokenTx.hash!);
    expect(tokenDetails.authorities.mint).toBe(false);
    expect(tokenDetails.authorities.melt).toBe(false);
    expect(tokenDetails.tokenInfo.version).toBe(TokenVersion.FEE);
  });

  it('should mint fee tokens charging fee instead of deposit', async () => {
    // Setup wallet and fund it
    const initialFunding = 20n;
    const fundTx = await gWallet.sendTransaction(feeTokenWallet.addresses[0], initialFunding, {
      pinCode,
    });
    await pollForTx(gWallet, fundTx.hash!);

    ({ wallet: feeWallet } = await buildWalletInstance({ words: feeTokenWallet.words }));
    await feeWallet.start({ pinCode, password });
    await pollForTx(feeWallet, fundTx.hash!);

    // Capture HTR balance before creating token
    let htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const htrBeforeCreate = htrBalance[0].balance.unlocked;

    // Create fee token first
    const createTokenTx = (await feeWallet.createNewToken('MintFeeToken', 'MFT', 100n, {
      pinCode,
      tokenVersion: TokenVersion.FEE,
    })) as CreateTokenTransaction;
    await pollForTx(feeWallet, createTokenTx.hash!);
    const tokenUid = createTokenTx.hash!;

    // Verify token creation fee was charged (1n)
    htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const htrAfterCreate = htrBalance[0].balance.unlocked;
    expect(htrBeforeCreate - htrAfterCreate).toBe(1n);

    // Mint tokens
    const mintAmount = 500n;
    const mintResponse = await feeWallet.mintTokens(tokenUid, mintAmount, { pinCode });
    await pollForTx(feeWallet, mintResponse.hash!);

    // Fee: only token output = 0.01 HTR (authority doesn't pay fee)
    // (NOT 1% deposit which would be 5 HTR)
    expect(mintResponse.headers).toHaveLength(1);
    expect(mintResponse.headers[0].entries[0].amount).toBe(1n);

    // HTR balance reduced by fee only
    htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toBe(htrAfterCreate - 1n);

    // Token balance increased
    const tokenBalance = await feeWallet.getBalance(tokenUid);
    expect(tokenBalance[0].balance.unlocked).toBe(600n); // 100 + 500
  });

  it('should melt fee tokens charging fee without withdraw', async () => {
    // Setup wallet and fund it
    const initialFunding = 20n;
    const fundTx = await gWallet.sendTransaction(feeTokenWallet.addresses[0], initialFunding, {
      pinCode,
    });
    await pollForTx(gWallet, fundTx.hash!);

    ({ wallet: feeWallet } = await buildWalletInstance({ words: feeTokenWallet.words }));
    await feeWallet.start({ pinCode, password });
    await pollForTx(feeWallet, fundTx.hash!);

    // Capture HTR balance before creating token
    let htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const htrBeforeCreate = htrBalance[0].balance.unlocked;

    // Create fee token first
    const createTokenTx = (await feeWallet.createNewToken('MeltFeeToken', 'MLFT', 1000n, {
      pinCode,
      tokenVersion: TokenVersion.FEE,
    })) as CreateTokenTransaction;
    await pollForTx(feeWallet, createTokenTx.hash!);
    const tokenUid = createTokenTx.hash!;

    // Verify token was created and is in wallet
    let tokenBalance = await feeWallet.getBalance(tokenUid);
    expect(tokenBalance[0].balance.unlocked).toBe(1000n);

    // Verify token creation fee was charged (1n)
    htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const htrAfterCreate = htrBalance[0].balance.unlocked;
    expect(htrBeforeCreate - htrAfterCreate).toBe(1n);

    // Melt tokens
    const meltAmount = 300n;
    const meltResponse = await feeWallet.meltTokens(tokenUid, meltAmount, { pinCode });
    await pollForTx(feeWallet, meltResponse.hash!);

    // Fee: only token change output = 0.01 HTR (authority doesn't pay fee)
    expect(meltResponse.headers).toHaveLength(1);
    expect(meltResponse.headers[0].entries[0].amount).toBe(1n);

    htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toBe(htrAfterCreate - 1n);

    // Token balance decreased
    tokenBalance = await feeWallet.getBalance(tokenUid);
    expect(tokenBalance[0].balance.unlocked).toBe(700n); // 1000 - 300
  });

  it('should send fee token transaction with change and charge fee for both outputs', async () => {
    // Setup wallet and fund it
    const initialFunding = 20n;
    const fundTx = await gWallet.sendTransaction(feeTokenWallet.addresses[0], initialFunding, {
      pinCode,
    });
    await pollForTx(gWallet, fundTx.hash!);

    ({ wallet: feeWallet } = await buildWalletInstance({ words: feeTokenWallet.words }));
    await feeWallet.start({ pinCode, password });
    await pollForTx(feeWallet, fundTx.hash!);

    // Capture HTR balance before creating token
    let htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const htrBeforeCreate = htrBalance[0].balance.unlocked;

    // Create fee token first
    const tokenAmount = 1000n;
    const createTokenTx = (await feeWallet.createNewToken('SendFeeToken', 'SFT', tokenAmount, {
      pinCode,
      tokenVersion: TokenVersion.FEE,
    })) as CreateTokenTransaction;
    await pollForTx(feeWallet, createTokenTx.hash!);
    const tokenUid = createTokenTx.hash!;

    // Verify token was created and is in wallet
    let tokenBalance = await feeWallet.getBalance(tokenUid);
    expect(tokenBalance[0].balance.unlocked).toBe(tokenAmount);

    // Verify token creation fee was charged (1n)
    htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const htrAfterCreate = htrBalance[0].balance.unlocked;
    expect(htrBeforeCreate - htrAfterCreate).toBe(1n);

    // Send half of tokens (will generate 2 outputs: destination + change)
    const sendAmount = 500n;
    const sendTx = await feeWallet.sendTransaction(feeTokenWallet.addresses[5], sendAmount, {
      token: tokenUid,
      pinCode,
    });
    await pollForTx(feeWallet, sendTx.hash!);

    // Fee: 2 token outputs (destination + change) = 0.02 HTR
    expect(sendTx.headers).toHaveLength(1);
    expect((sendTx.headers[0] as FeeHeader).entries[0].amount).toBe(2n);

    // HTR balance reduced by fee
    htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toBe(htrAfterCreate - 2n);

    // Token balance stays the same (internal transaction)
    tokenBalance = await feeWallet.getBalance(tokenUid);
    expect(tokenBalance[0].balance.unlocked).toBe(tokenAmount);
  });

  it('should melt all fee tokens with minimum fee', async () => {
    // Setup wallet and fund it
    const initialFunding = 20n;
    const fundTx = await gWallet.sendTransaction(feeTokenWallet.addresses[0], initialFunding, {
      pinCode,
    });
    await pollForTx(gWallet, fundTx.hash!);

    ({ wallet: feeWallet } = await buildWalletInstance({ words: feeTokenWallet.words }));
    await feeWallet.start({ pinCode, password });
    await pollForTx(feeWallet, fundTx.hash!);

    // Capture HTR balance before creating token
    let htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const htrBeforeCreate = htrBalance[0].balance.unlocked;

    // Create fee token first
    const tokenAmount = 500n;
    const createTokenTx = (await feeWallet.createNewToken('MeltAllFeeToken', 'MAFT', tokenAmount, {
      pinCode,
      tokenVersion: TokenVersion.FEE,
    })) as CreateTokenTransaction;
    await pollForTx(feeWallet, createTokenTx.hash!);
    const tokenUid = createTokenTx.hash!;

    // Verify token was created and is in wallet
    let tokenBalance = await feeWallet.getBalance(tokenUid);
    expect(tokenBalance[0].balance.unlocked).toBe(tokenAmount);

    // Verify token creation fee was charged (1n)
    htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const htrAfterCreate = htrBalance[0].balance.unlocked;
    expect(htrBeforeCreate - htrAfterCreate).toBe(1n);

    // Melt ALL tokens (no change output)
    const meltResponse = await feeWallet.meltTokens(tokenUid, tokenAmount, { pinCode });
    await pollForTx(feeWallet, meltResponse.hash!);

    // Fee: minimum 0.01 HTR even with no token output (only authority output)
    expect(meltResponse.headers).toHaveLength(1);
    expect((meltResponse.headers[0] as FeeHeader).entries[0].amount).toBe(1n);

    // HTR balance reduced by fee
    htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toBe(htrAfterCreate - 1n);

    // Token balance should be zero
    tokenBalance = await feeWallet.getBalance(tokenUid);
    expect(tokenBalance[0]?.balance.unlocked ?? 0n).toBe(0n);
  });

  it('should fail to create fee token when wallet has no HTR to pay the fee', async () => {
    // Use dedicated empty wallet that was never funded
    // This avoids race conditions from draining HTR to other wallets
    const { wallet: emptyWalletInstance } = await buildWalletInstance({
      words: emptyFeeWallet.words,
    });
    await emptyWalletInstance.start({ pinCode, password });

    // Verify no HTR available (wallet was never funded)
    const balance = await emptyWalletInstance.getBalance(NATIVE_TOKEN_UID);
    expect(balance[0]?.balance.unlocked ?? 0n).toBe(0n);

    // Try to create fee token without HTR to pay the fee
    await expect(
      emptyWalletInstance.createNewToken('NoFundsFeeToken', 'NFFT', 1000n, {
        pinCode,
        tokenVersion: TokenVersion.FEE,
      })
    ).rejects.toThrow(UtxoError);
  });

  it('should fail to send fee tokens when wallet has no HTR to pay the fee', async () => {
    // Setup wallet (may have accumulated HTR from previous tests)
    const initialFunding = 1n;
    const fundTx = await gWallet.sendTransaction(feeTokenWallet.addresses[0], initialFunding, {
      pinCode,
    });
    await pollForTx(gWallet, fundTx.hash!);

    ({ wallet: feeWallet } = await buildWalletInstance({ words: feeTokenWallet.words }));
    await feeWallet.start({ pinCode, password });
    await pollForTx(feeWallet, fundTx.hash!);

    // Create fee token first (costs 1n fee)
    const tokenAmount = 1000n;
    const createTokenTx = (await feeWallet.createNewToken('NoHtrFeeToken', 'NHFT', tokenAmount, {
      pinCode,
      tokenVersion: TokenVersion.FEE,
    })) as CreateTokenTransaction;
    await pollForTx(feeWallet, createTokenTx.hash!);
    const tokenUid = createTokenTx.hash!;

    // Drain any remaining HTR by sending it all to gWallet
    let htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const remainingHtr = htrBalance[0]?.balance.unlocked ?? 0n;
    if (remainingHtr > 0n) {
      const drainTx = await feeWallet.sendTransaction(
        WALLET_CONSTANTS.genesis.addresses[0],
        remainingHtr,
        { pinCode }
      );
      await pollForTx(feeWallet, drainTx.hash!);
    }

    // Verify no HTR left
    htrBalance = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]?.balance.unlocked ?? 0n).toBe(0n);

    // Verify we have tokens
    const tokenBalance = await feeWallet.getBalance(tokenUid);
    expect(tokenBalance[0].balance.unlocked).toBe(tokenAmount);

    // Try to send fee tokens without HTR to pay the fee
    await expect(
      feeWallet.sendTransaction(feeTokenWallet.addresses[5], 100n, {
        token: tokenUid,
        pinCode,
      })
    ).rejects.toThrow(SendTxError);
  });

  it('should calculate correct HTR change when pre-selected inputs generate fee token change', async () => {
    // This test verifies that when:
    // 1. User pre-selects inputs (fee token + HTR)
    // 2. Fee token input exceeds output (generates change)
    // 3. Fee token change increments the fee
    // The HTR change is correctly calculated considering the updated fee

    // Setup wallet and fund it with enough HTR
    const initialFunding = 20n;
    const fundTx = await gWallet.sendTransaction(feeTokenWallet.addresses[0], initialFunding, {
      pinCode,
    });
    await pollForTx(gWallet, fundTx.hash!);

    ({ wallet: feeWallet } = await buildWalletInstance({ words: feeTokenWallet.words }));
    await feeWallet.start({ pinCode, password });
    await pollForTx(feeWallet, fundTx.hash!);

    // Create fee token
    const tokenAmount = 200n;
    const createTokenTx = (await feeWallet.createNewToken(
      'PreSelectFeeToken',
      'PSFT',
      tokenAmount,
      {
        pinCode,
        tokenVersion: TokenVersion.FEE,
      }
    )) as CreateTokenTransaction;
    await pollForTx(feeWallet, createTokenTx.hash!);
    const tokenUid = createTokenTx.hash!;

    // Verify token was created
    const tokenBalance = await feeWallet.getBalance(tokenUid);
    expect(tokenBalance[0].balance.unlocked).toBe(tokenAmount);

    // Get current HTR balance (after token creation fee of 1n)
    const htrBalanceBefore = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const htrBefore = htrBalanceBefore[0].balance.unlocked;

    // Get the UTXOs we'll use as pre-selected inputs
    const feeTokenUtxos = await feeWallet.getUtxos({ token: tokenUid });
    const htrUtxos = await feeWallet.getUtxos({ token: NATIVE_TOKEN_UID });

    expect(feeTokenUtxos.utxos.length).toBeGreaterThan(0);
    expect(htrUtxos.utxos.length).toBeGreaterThan(0);

    const feeTokenUtxo = feeTokenUtxos.utxos[0];
    const htrUtxo = htrUtxos.utxos[0];

    // Pre-select inputs
    const inputs = [
      { txId: feeTokenUtxo.tx_id, index: feeTokenUtxo.index },
      { txId: htrUtxo.tx_id, index: htrUtxo.index },
    ];

    // Outputs:
    // - 50n fee token to external address (generates 1n fee) -> will have change (generates +1n fee)
    // - 1n HTR output to external address
    // Total fee: 2n (1 for fee token output + 1 for fee token change)
    // HTR needed: 1n (output) + 2n (fee) = 3n
    const outputs = [
      {
        // Send to external address so it actually leaves the wallet
        address: emptyWallet.addresses[1],
        value: 50n,
        token: tokenUid,
      },
      {
        // Send to external address so it actually leaves the wallet
        address: emptyWallet.addresses[0],
        value: 1n,
        token: NATIVE_TOKEN_UID,
      },
    ];

    // Send transaction with pre-selected inputs
    const sendTx = await feeWallet.sendManyOutputsTransaction(outputs, {
      inputs,
      pinCode,
    });
    await pollForTx(feeWallet, sendTx.hash!);

    // Verify fee header has correct amount (2n = 2 fee token outputs)
    expect(sendTx.headers).toHaveLength(1);
    expect((sendTx.headers[0] as FeeHeader).entries[0].amount).toBe(2n);

    // Verify HTR balance after transaction
    // HTR spent: 1n (output) + 2n (fee) = 3n
    const htrBalanceAfter = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const htrAfter = htrBalanceAfter[0].balance.unlocked;
    expect(htrBefore - htrAfter).toBe(3n);

    // Verify fee token balance (should stay the same, just moved internally + sent 50n)
    const tokenBalanceAfter = await feeWallet.getBalance(tokenUid);
    // 200n - 50n sent = 150n remaining
    expect(tokenBalanceAfter[0].balance.unlocked).toBe(150n);
  });

  it('should calculate correct HTR change with prepareTxData when pre-selected inputs generate fee token change', async () => {
    // This test verifies that prepareTxData correctly handles the same scenario:
    // 1. User pre-selects inputs (fee token + HTR)
    // 2. Fee token input exceeds output (generates change)
    // 3. Fee token change increments the fee
    // The fee header is correctly calculated considering all fee token outputs

    // Setup wallet
    ({ wallet: feeWallet } = await buildWalletInstance({ words: feeTokenWallet.words }));
    await feeWallet.start({ pinCode, password });

    // Fund wallet with HTR for token creation and transaction fees
    const initialFunding = 20n;
    const fundTx = await gWallet.sendTransaction(feeTokenWallet.addresses[0], initialFunding, {
      pinCode,
    });
    await pollForTx(gWallet, fundTx.hash!);
    await pollForTx(feeWallet, fundTx.hash!);

    // Get HTR balance before token creation
    const htrBalanceBeforeTokenCreation = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const htrBeforeTokenCreation = htrBalanceBeforeTokenCreation[0].balance.unlocked;

    // Create fee token (costs 1n fee)
    const tokenAmount = 200n;
    const createTokenTx = (await feeWallet.createNewToken('FeeBasedToken', 'FBT', tokenAmount, {
      pinCode,
      tokenVersion: TokenVersion.FEE,
    })) as CreateTokenTransaction;
    await pollForTx(feeWallet, createTokenTx.hash!);
    const tokenUid = createTokenTx.hash!;

    // Verify token was created
    const tokenBalance = await feeWallet.getBalance(tokenUid);
    expect(tokenBalance[0].balance.unlocked).toBe(tokenAmount);

    // Get current HTR balance (after token creation fee of 1n)
    const htrBalanceBefore = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const htrBefore = htrBalanceBefore[0].balance.unlocked;

    // Verify token creation cost 1n fee
    expect(htrBeforeTokenCreation - htrBefore).toBe(1n);

    // Get the fee token UTXO (should have full amount)
    const feeTokenUtxos = await feeWallet.getUtxos({ token: tokenUid });
    expect(feeTokenUtxos.utxos.length).toBeGreaterThan(0);
    const feeTokenUtxo = feeTokenUtxos.utxos[0];
    expect(feeTokenUtxo.amount).toBe(200n);

    // Get a single HTR UTXO to use as pre-selected input
    // We need one that has enough for output (1n) + fee (2n) = 3n minimum
    const htrUtxos = await feeWallet.getUtxos({ token: NATIVE_TOKEN_UID });
    expect(htrUtxos.utxos.length).toBeGreaterThan(0);

    // Find a UTXO with at least 3n (1n output + 2n fee)
    const htrUtxo = htrUtxos.utxos.find(utxo => utxo.amount >= 3n);
    expect(htrUtxo).toBeDefined();

    // Pre-select inputs
    const inputs = [
      { txId: feeTokenUtxo.tx_id, index: feeTokenUtxo.index },
      { txId: htrUtxo!.tx_id, index: htrUtxo!.index },
    ];

    // Outputs:
    // - 50n fee token to external address (generates 1n fee) -> will have change (generates +1n fee)
    // - 1n HTR output to external address
    // Total fee: 2n (1 for fee token output + 1 for fee token change)
    const outputs = [
      {
        // Send to external address so it actually leaves the wallet
        address: emptyWallet.addresses[1],
        value: 50n,
        token: tokenUid,
      },
      {
        // Send to external address so it actually leaves the wallet
        address: emptyWallet.addresses[0],
        value: 1n,
        token: NATIVE_TOKEN_UID,
      },
    ];

    // Use sendManyOutputsSendTransaction to get the SendTransaction object
    const sendTx = await feeWallet.sendManyOutputsSendTransaction(outputs, {
      inputs,
      pinCode,
    });

    // Call prepareTxData directly to verify the transaction data
    // prepareTxData also creates the Transaction object from fullTxData
    const txData = await sendTx.prepareTxData();
    sendTx.transaction = transactionUtils.createTransactionFromData(txData, feeWallet.network);

    // Verify fee header has correct amount (2n = 2 fee token outputs: 1 external + 1 change)
    expect(txData.headers).toHaveLength(1);
    expect((txData.headers![0] as FeeHeader).entries[0].amount).toBe(2n);

    // Sign the transaction and run from mining
    await sendTx.signTx();
    const tx = await sendTx.runFromMining();
    await pollForTx(feeWallet, tx.hash!);

    // Verify fee header on the final transaction
    expect(tx.headers).toHaveLength(1);
    expect((tx.headers[0] as FeeHeader).entries[0].amount).toBe(2n);

    // Verify HTR balance change
    // From the pre-selected UTXO: spent 1n (output) + 2n (fee) = 3n
    // Change returned: htrUtxoAmount - 3n
    const htrBalanceAfter = await feeWallet.getBalance(NATIVE_TOKEN_UID);
    const htrAfter = htrBalanceAfter[0].balance.unlocked;

    // The total balance change should be 3n (1n sent + 2n fee)
    expect(htrBefore - htrAfter).toBe(3n);

    // Verify fee token balance (should stay the same, just moved internally + sent 50n)
    const tokenBalanceAfter = await feeWallet.getBalance(tokenUid);
    // 200n - 50n sent = 150n remaining
    expect(tokenBalanceAfter[0].balance.unlocked).toBe(150n);
  });
});

describe('single-address mode', () => {
  afterEach(async () => {
    if (wallet) {
      await wallet.stop({ cleanStorage: true });
    }
  });

  it('should enable single-address mode and keep index 0 as current address after receiving tx', async () => {
    ({ wallet } = await buildWalletInstance({ words: singleAddressWallet1.words }));
    await wallet.start({ pinCode, password });

    await wallet.enableSingleAddressMode();

    const currentAddress = wallet.getCurrentAddress();
    expect(currentAddress.index).toBe(0);
    expect(currentAddress.address).toBe(singleAddressWallet1.addresses[0]);

    await GenesisWalletServiceHelper.injectFunds(singleAddressWallet1.addresses[0], 10n, wallet);

    const currentAddressAfterTx = wallet.getCurrentAddress();
    expect(currentAddressAfterTx.index).toBe(0);
    expect(currentAddressAfterTx.address).toBe(singleAddressWallet1.addresses[0]);

    const nextAddress = wallet.getNextAddress();
    expect(nextAddress.index).toBe(0);
    expect(nextAddress.address).toBe(singleAddressWallet1.addresses[0]);
  });

  it('should succeed enabling single-address mode when wallet only has tx on index 0', async () => {
    ({ wallet } = await buildWalletInstance({ words: singleAddressWallet2.words }));
    await wallet.start({ pinCode, password });

    await GenesisWalletServiceHelper.injectFunds(singleAddressWallet2.addresses[0], 5n, wallet);

    await wallet.enableSingleAddressMode();

    const currentAddress = wallet.getCurrentAddress();
    expect(currentAddress.index).toBe(0);
    expect(currentAddress.address).toBe(singleAddressWallet2.addresses[0]);

    const nextAddress = wallet.getNextAddress();
    expect(nextAddress.index).toBe(0);
    expect(nextAddress.address).toBe(singleAddressWallet2.addresses[0]);
  });

  it('should fail to enable single-address mode when wallet has tx on index > 0', async () => {
    ({ wallet } = await buildWalletInstance({ words: singleAddressWallet2.words }));
    await wallet.start({ pinCode, password });

    await GenesisWalletServiceHelper.injectFunds(singleAddressWallet2.addresses[1], 10n, wallet);

    await expect(wallet.enableSingleAddressMode()).rejects.toThrow(
      'Cannot enable single-address policy'
    );
  });

  it('should fallback to start in multi-address mode via constructor when wallet has tx on index > 0', async () => {
    // First, start wallet normally and fund index 1
    ({ wallet } = await buildWalletInstance({ words: singleAddressWallet2.words }));
    await wallet.start({ pinCode, password });

    await GenesisWalletServiceHelper.injectFunds(singleAddressWallet2.addresses[1], 10n, wallet);

    await wallet.stop({ cleanStorage: true });

    // Now try to re-start with singleAddressMode: true via constructor
    const store = new MemoryStore();
    const storage = new Storage(store);
    wallet = new HathorWalletServiceWallet({
      requestPassword: jest.fn().mockResolvedValue('test-password'),
      seed: singleAddressWallet2.words,
      network: new Network('testnet'),
      storage,
      enableWs: false,
      singleAddressMode: true,
    });

    await wallet.start({ pinCode, password });

    await expect(wallet.getAddressMode()).resolves.toBe(WalletAddressMode.MULTI);
  });

  it('should start in single-address mode via constructor', async () => {
    const store = new MemoryStore();
    const storage = new Storage(store);
    wallet = new HathorWalletServiceWallet({
      requestPassword: jest.fn().mockResolvedValue('test-password'),
      seed: singleAddressWallet1.words,
      network: new Network('testnet'),
      storage,
      enableWs: false,
      singleAddressMode: true,
    });

    await wallet.start({ pinCode, password });

    const currentAddress = wallet.getCurrentAddress();
    expect(currentAddress.index).toBe(0);
    expect(currentAddress.address).toBe(singleAddressWallet1.addresses[0]);

    const nextAddress = wallet.getNextAddress();
    expect(nextAddress.index).toBe(0);
    expect(nextAddress.address).toBe(singleAddressWallet1.addresses[0]);
  });
});

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
import { SendTxError, UtxoError } from '../../src/errors';
import { TokenVersion, WalletAddressMode } from '../../src/types';
import { GenesisWalletServiceHelper } from './helpers/genesis-wallet.helper';

// Set base URL for the wallet service API inside the privatenet test container
initializeServiceGlobalConfigs();

/** Genesis Wallet, used to fund all tests */
const gWallet: HathorWalletServiceWallet = GenesisWalletServiceHelper.getSingleton();
/** Wallet instance used in tests */
let wallet: HathorWalletServiceWallet;
const utxosWallet = {
  words:
    'provide bunker age agree renew size popular license best kidney range flag they bulk survey letter concert mobile february clean nuclear inherit voyage capable',
  addresses: [
    'WQvAdYAqZf69nsgzVwSMwfRWcBRHJJU1qH',
    'We4fZtzxod2M3w1u8h4TNpaMYrYWqXxNqd',
    'WioaJZPzytLVniJ9MTinLiWih1VaoRfaUV',
    'WmRLJj5P1rj1bErNADJnweq8mXBNLmNiAL',
    'WXpXoREmV2hFuMX83dup7YMqJqRW5Y94Av',
    'WirQUza1XdqnN7DcAMdXvysTntq9DB3xz6',
    'Wb26hUGD6du7nkecrAeaRbBoZS4Z3dynby',
    'WXgFTQm7uNYTj8gsz3GWNg58jCvaPn96hD',
    'WdcFv1fKjbPPqSXHkdo22QE2bbZnbXADHK',
    'WTm47mTSd7ompdinkZM3LiF4VE7AeQttzo',
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

/**
 * Obsolete function, use GenesisWalletServiceHelper.injectFunds instead.
 * @deprecated
 */
const sendFundTx = GenesisWalletServiceHelper.injectFunds;

beforeAll(async () => {
  await GenesisWalletServiceHelper.start();
});

afterAll(async () => {
  await GenesisWalletServiceHelper.stop();
});

// empty wallet address method tests moved to shared/addresses.test.ts and service-specific/addresses.test.ts

describe.skip('websocket events', () => {});

// balances tests moved to shared/get-balance.test.ts and service-specific/get-balance.test.ts

// address management method tests moved to shared/addresses.test.ts and service-specific/addresses.test.ts

describe('getUtxos, getUtxosForAmount', () => {
  let utxosTestWallet: HathorWalletServiceWallet;
  let createdTokenUid: string;

  beforeAll(async () => {
    // Create and fund the utxos wallet for testing
    ({ wallet: utxosTestWallet } = buildWalletInstance({ words: utxosWallet.words }));
    await utxosTestWallet.start({ pinCode, password });

    // Fund the wallet with multiple transactions to create various UTXOs
    await sendFundTx(utxosWallet.addresses[0], 100n, utxosTestWallet);

    // Create additional UTXOs by sending to different addresses
    const fundTx2 = await utxosTestWallet.sendTransaction(utxosWallet.addresses[1], 20n, {
      pinCode,
      changeAddress: utxosWallet.addresses[0],
    });
    await pollForTx(utxosTestWallet, fundTx2.hash!);
    const fundTx3 = await utxosTestWallet.sendTransaction(utxosWallet.addresses[2], 30n, {
      pinCode,
      changeAddress: utxosWallet.addresses[0],
    });
    await pollForTx(utxosTestWallet, fundTx3.hash!);
    // Create a custom token to test authority UTXOs
    const createTokenTx = await utxosTestWallet.createNewToken('UtxoTestToken', 'UTT', 200n, {
      pinCode,
      address: utxosWallet.addresses[1],
      mintAuthorityAddress: utxosWallet.addresses[2],
      meltAuthorityAddress: utxosWallet.addresses[3],
      changeAddress: utxosWallet.addresses[1],
    });

    createdTokenUid = createTokenTx.hash!;

    await pollForTx(utxosTestWallet, createdTokenUid);
  });

  afterAll(async () => {
    if (utxosTestWallet) {
      await utxosTestWallet.stop({ cleanStorage: true });
    }
  });

  describe('getUtxos', () => {
    it('should return all available UTXOs without filters', async () => {
      const utxoData = await utxosTestWallet.getUtxos();

      // Validate the structure of the response
      expect(utxoData).toEqual(
        expect.objectContaining({
          total_amount_available: expect.any(BigInt),
          total_utxos_available: expect.any(BigInt),
          total_amount_locked: expect.any(BigInt),
          total_utxos_locked: expect.any(BigInt),
          utxos: expect.any(Array),
        })
      );

      // Should have at least some UTXOs from our funding transactions
      expect(utxoData.total_utxos_available).toBe(3n);
      expect(utxoData.total_amount_available).toBe(98n);
      expect(utxoData.utxos.length).toBe(3);

      // Validate UTXO structure
      utxoData.utxos.forEach(utxo => {
        expect(utxo).toEqual(
          expect.objectContaining({
            address: expect.any(String),
            amount: expect.any(BigInt),
            tx_id: expect.any(String),
            locked: expect.any(Boolean),
            index: expect.any(Number),
          })
        );
        expect(utxo.amount).toBeGreaterThan(0n);
        expect(utxosWallet.addresses).toContain(utxo.address);
      });
    });

    it('should filter UTXOs by specific token', async () => {
      const nativeTokenUtxos = await utxosTestWallet.getUtxos({ token: NATIVE_TOKEN_UID });
      const customTokenUtxos = await utxosTestWallet.getUtxos({ token: createdTokenUid });

      // Should have native token UTXOs
      expect(nativeTokenUtxos.total_utxos_available).toBe(3n);
      expect(nativeTokenUtxos.utxos).toHaveLength(3);
      expect(nativeTokenUtxos.total_amount_available).toBe(98n);

      // Should have custom token UTXOs
      expect(customTokenUtxos.total_utxos_available).toBe(1n);
      expect(customTokenUtxos.utxos).toHaveLength(1);
      expect(customTokenUtxos.total_amount_available).toBe(200n); // The amount we created
    });

    it('should filter UTXOs by specific address', async () => {
      let currentFilterAddress = utxosWallet.addresses[1];

      // Should have UTXOs for the specific address, native token
      let addressUtxos = await utxosTestWallet.getUtxos({
        filter_address: currentFilterAddress,
      });
      expect(addressUtxos.utxos).toHaveLength(1);
      expect(addressUtxos.utxos[0].address).toBe(currentFilterAddress);
      expect(addressUtxos.utxos[0].amount).toBe(18n);

      // Should have UTXOs for the specific address, custom token
      addressUtxos = await utxosTestWallet.getUtxos({
        filter_address: currentFilterAddress,
        token: createdTokenUid,
      });
      expect(addressUtxos.utxos).toHaveLength(1);
      expect(addressUtxos.utxos[0].address).toBe(currentFilterAddress);
      expect(addressUtxos.utxos[0].amount).toBe(200n);

      // Should not return authority UTXOs: this is a dedicated feature of getAuthorityUtxo
      currentFilterAddress = await utxosWallet.addresses[2];
      addressUtxos = await utxosTestWallet.getUtxos({
        filter_address: currentFilterAddress,
        token: createdTokenUid,
      });
      expect(addressUtxos.utxos.length).toBe(0);
    });

    it('should limit the number of UTXOs returned', async () => {
      const limitedUtxos = await utxosTestWallet.getUtxos({ max_utxos: 2 });

      expect(limitedUtxos.utxos).toHaveLength(2);
    });

    it('should filter UTXOs by amount range', async () => {
      const smallUtxos = await utxosTestWallet.getUtxos({
        amount_smaller_than: 25,
      });
      expect(smallUtxos.total_utxos_available).toBe(1n);
      expect(smallUtxos.utxos[0].amount).toBe(18n);

      const bigUtxos = await utxosTestWallet.getUtxos({
        amount_bigger_than: 40,
      });
      expect(bigUtxos.total_utxos_available).toBe(1n);
      expect(bigUtxos.utxos[0].amount).toBe(50n);
    });
  });

  // getAuthorityUtxo tests moved to shared/authority-utxos.test.ts and service-specific/authority-utxos.test.ts
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

    ({ wallet: feeWallet } = buildWalletInstance({ words: feeTokenWallet.words }));
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

    ({ wallet: feeWallet } = buildWalletInstance({ words: feeTokenWallet.words }));
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

    ({ wallet: feeWallet } = buildWalletInstance({ words: feeTokenWallet.words }));
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

    ({ wallet: feeWallet } = buildWalletInstance({ words: feeTokenWallet.words }));
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

    ({ wallet: feeWallet } = buildWalletInstance({ words: feeTokenWallet.words }));
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

    ({ wallet: feeWallet } = buildWalletInstance({ words: feeTokenWallet.words }));
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
    const { wallet: emptyWalletInstance } = buildWalletInstance({ words: emptyFeeWallet.words });
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

    ({ wallet: feeWallet } = buildWalletInstance({ words: feeTokenWallet.words }));
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

    ({ wallet: feeWallet } = buildWalletInstance({ words: feeTokenWallet.words }));
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
    ({ wallet: feeWallet } = buildWalletInstance({ words: feeTokenWallet.words }));
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
    ({ wallet } = buildWalletInstance({ words: singleAddressWallet1.words }));
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
    ({ wallet } = buildWalletInstance({ words: singleAddressWallet2.words }));
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
    ({ wallet } = buildWalletInstance({ words: singleAddressWallet2.words }));
    await wallet.start({ pinCode, password });

    await GenesisWalletServiceHelper.injectFunds(singleAddressWallet2.addresses[1], 10n, wallet);

    await expect(wallet.enableSingleAddressMode()).rejects.toThrow(
      'Cannot enable single-address policy'
    );
  });

  it('should fallback to start in multi-address mode via constructor when wallet has tx on index > 0', async () => {
    // First, start wallet normally and fund index 1
    ({ wallet } = buildWalletInstance({ words: singleAddressWallet2.words }));
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

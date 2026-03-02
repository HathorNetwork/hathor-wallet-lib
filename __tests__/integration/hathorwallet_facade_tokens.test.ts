import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import { getRandomInt } from './utils/core.util';
import {
  createTokenHelper,
  DEFAULT_PIN_CODE,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from './helpers/wallet.helper';
import HathorWallet from '../../src/new/wallet';
import {
  NATIVE_TOKEN_UID,
  TOKEN_MELT_MASK,
  TOKEN_MINT_MASK,
  TOKEN_AUTHORITY_MASK,
} from '../../src/constants';
import { NftValidationError } from '../../src/errors';
import SendTransaction from '../../src/new/sendTransaction';
import transaction from '../../src/utils/transaction';
import { TokenVersion } from '../../src/types';
import { parseScriptData } from '../../src/utils/scripts';
import FeeHeader from '../../src/headers/fee';
import Header from '../../src/headers/base';
import CreateTokenTransaction from '../../src/models/create_token_transaction';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';
const sampleNftData =
  'ipfs://bafybeiccfclkdtucu6y4yc5cpr6y3yuinr67svmii46v5cfcrkp47ihehy/albums/QXBvbGxvIDEwIE1hZ2F6aW5lIDI3L04=/21716695748_7390815218_o.jpg';

const validateFeeAmount = (headers: Header[], amount: bigint) => {
  // validate fee amount
  expect(headers).toHaveLength(1);
  expect(headers[0]).toEqual(
    expect.objectContaining({
      entries: expect.arrayContaining([
        expect.objectContaining({
          tokenIndex: 0,
          amount,
        }),
      ]),
    })
  );
};

describe('createNewToken', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should create a new token', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);

    // Creating the new token
    const newTokenResponse = await hWallet.createNewToken('TokenName', 'TKN', 100n);

    // Validating the creation tx
    expect(newTokenResponse).toMatchObject({
      hash: expect.any(String),
      name: 'TokenName',
      symbol: 'TKN',
      version: 2,
    });
    const tokenUid = newTokenResponse.hash;

    // Validating wallet balance is updated with this new token
    await waitForTxReceived(hWallet, tokenUid);
    const tknBalance = await hWallet.getBalance(tokenUid);
    expect(tknBalance[0].token.version).toBe(TokenVersion.DEPOSIT);
    expect(tknBalance[0].balance.unlocked).toBe(100n);
  });

  it('should create a new token fee token', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);

    // Creating the new token
    const newTokenResponse = await hWallet.createNewToken('TokenName', 'TKN', 8582n, {
      tokenVersion: TokenVersion.FEE,
    });

    // Validating the creation tx
    expect(newTokenResponse).toMatchObject({
      hash: expect.any(String),
      name: 'TokenName',
      symbol: 'TKN',
      version: 2,
      tokenVersion: TokenVersion.FEE,
      headers: [new FeeHeader([{ tokenIndex: 0, amount: 1n }])],
    });
    const tokenUid = newTokenResponse.hash;

    // Validating wallet balance is updated with this new token
    await waitForTxReceived(hWallet, tokenUid);
    const tknBalance = await hWallet.getBalance(tokenUid);
    expect(tknBalance[0].token.version).toBe(TokenVersion.FEE);
    expect(tknBalance[0].balance.unlocked).toBe(8582n);
  });

  it('should create a new token on the correct addresses', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);

    // Creating the new token
    const destinationAddress = await hWallet.getAddressAtIndex(4);
    const changeAddress = await hWallet.getAddressAtIndex(8);
    const { hash: dbtUid } = await hWallet.createNewToken('NewToken Name', 'NTKN', 100n, {
      address: destinationAddress,
      changeAddress,
    });
    await waitForTxReceived(hWallet, dbtUid);
    const { hash: fbtUid } = await hWallet.createNewToken('FeeBasedToken', 'FBT', 8582n, {
      address: destinationAddress,
      changeAddress,
      tokenVersion: TokenVersion.FEE,
    });
    await waitForTxReceived(hWallet, fbtUid);
    // Validating the tokens are on the correct addresses
    const { utxos: utxosDbt } = await hWallet.getUtxos({ token: dbtUid });
    const { utxos: utxosFbt } = await hWallet.getUtxos({ token: fbtUid });
    expect(utxosDbt).toContainEqual(
      expect.objectContaining({ address: destinationAddress, amount: 100n })
    );
    expect(utxosFbt).toContainEqual(
      expect.objectContaining({ address: destinationAddress, amount: 8582n })
    );

    const { utxos: utxosHtr } = await hWallet.getUtxos();
    expect(utxosHtr).toContainEqual(
      expect.objectContaining({ address: changeAddress, amount: 8n })
    );
  });

  it('should create a new token without mint/melt authorities', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 2n);

    // Creating the new token
    const dbtResponse = await hWallet.createNewToken('Immutable Token', 'ITKN', 100n, {
      createMint: false,
      createMelt: false,
    });
    expect(dbtResponse).toHaveProperty('hash');
    await waitForTxReceived(hWallet, dbtResponse.hash);
    let htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', 1n);

    const fbtResponse = await hWallet.createNewToken('FeeBasedToken', 'FBT', 8582n, {
      createMint: false,
      createMelt: false,
      tokenVersion: TokenVersion.FEE,
    });
    expect(fbtResponse).toHaveProperty('hash');
    validateFeeAmount(fbtResponse.headers, 1n);
    await waitForTxReceived(hWallet, fbtResponse.hash);
    htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', 0n);
  });

  it('Create token using mint/melt address', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr10 = await hWallet.getAddressAtIndex(10);
    const addr11 = await hWallet.getAddressAtIndex(11);
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 2n);

    // Creating the new token
    const dbtResponse = await hWallet.createNewToken('New Token', 'NTKN', 100n, {
      createMint: true,
      mintAuthorityAddress: addr10,
      createMelt: true,
      meltAuthorityAddress: addr11,
    });
    // Validating the creation tx
    expect(dbtResponse).toHaveProperty('hash');
    await waitForTxReceived(hWallet, dbtResponse.hash);

    // Creating the new token
    const fbtResponse = await hWallet.createNewToken('New Token', 'NTKN', 8582n, {
      createMint: true,
      mintAuthorityAddress: addr10,
      createMelt: true,
      meltAuthorityAddress: addr11,
      tokenVersion: TokenVersion.FEE,
    });

    expect(fbtResponse).toHaveProperty('hash');
    await waitForTxReceived(hWallet, fbtResponse.hash);

    const validateAuthorityOutputs = async (
      response: CreateTokenTransaction,
      expectedAmount: bigint
    ) => {
      // Validating a new mint authority was created by default
      const authorityOutputs = response.outputs.filter(o =>
        transaction.isAuthorityOutput({ token_data: o.tokenData })
      );
      expect(authorityOutputs).toHaveLength(2);
      const mintOutput = authorityOutputs.filter(o => o.value === TOKEN_MINT_MASK);
      const mintP2pkh = mintOutput[0].parseScript(hWallet.getNetworkObject());
      // Validate that the mint output was sent to the correct address
      expect(mintP2pkh.address.base58).toEqual(addr10);

      const meltOutput = authorityOutputs.filter(o => o.value === TOKEN_MELT_MASK);
      const meltP2pkh = meltOutput[0].parseScript(hWallet.getNetworkObject());
      // Validate that the melt output was sent to the correct address
      expect(meltP2pkh.address.base58).toEqual(addr11);

      // Validating custom token balance
      const tokenBalance = await hWallet.getBalance(response.hash);
      expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);
    };

    validateAuthorityOutputs(dbtResponse, 100n);
    validateAuthorityOutputs(fbtResponse, 8582n);
  });

  it('Create token using external mint/melt address', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const hWallet2 = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr2_0 = await hWallet2.getAddressAtIndex(0);
    const addr2_1 = await hWallet2.getAddressAtIndex(1);
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 1n);

    // Error creating token with external address
    await expect(
      hWallet.createNewToken('New Token', 'NTKN', 100n, {
        createMint: true,
        mintAuthorityAddress: addr2_0,
      })
    ).rejects.toThrow('must belong to your wallet');

    await expect(
      hWallet.createNewToken('New Token', 'NTKN', 100n, {
        createMelt: true,
        meltAuthorityAddress: addr2_1,
      })
    ).rejects.toThrow('must belong to your wallet');

    // Creating the new token allowing external address
    const newTokenResponse = await hWallet.createNewToken('New Token', 'NTKN', 100n, {
      createMint: true,
      mintAuthorityAddress: addr2_0,
      allowExternalMintAuthorityAddress: true,
      createMelt: true,
      meltAuthorityAddress: addr2_1,
      allowExternalMeltAuthorityAddress: true,
    });

    // Validating the creation tx
    expect(newTokenResponse).toHaveProperty('hash');
    await waitForTxReceived(hWallet, newTokenResponse.hash);
    await waitForTxReceived(hWallet2, newTokenResponse.hash);

    // Validating a new mint authority was created by default
    const authorityOutputs = newTokenResponse.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs).toHaveLength(2);
    const mintOutput = authorityOutputs.filter(o => o.value === TOKEN_MINT_MASK);
    const mintP2pkh = mintOutput[0].parseScript(hWallet.getNetworkObject());
    // Validate that the mint output was sent to the correct address
    expect(mintP2pkh.address.base58).toEqual(addr2_0);

    const meltOutput = authorityOutputs.filter(o => o.value === TOKEN_MELT_MASK);
    const meltP2pkh = meltOutput[0].parseScript(hWallet.getNetworkObject());
    // Validate that the melt output was sent to the correct address
    expect(meltP2pkh.address.base58).toEqual(addr2_1);

    // Validating custom token balance
    const tokenBalance = await hWallet.getBalance(newTokenResponse.hash);
    const expectedAmount = 100n;
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);
  });
});

describe('mintTokens', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should mint new tokens', async () => {
    // Setting up the custom token
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 2n);
    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Token to Mint', 'TMINT', 100n);
    const options = { tokenVersion: TokenVersion.FEE };
    const { hash: fbtUid } = await createTokenHelper(
      hWallet,
      'FeeBasedToken',
      'FBT',
      8582n,
      options
    );
    await waitForTxReceived(hWallet, fbtUid);

    // Should not mint more tokens than the HTR funds allow
    await expect(hWallet.mintTokens(tokenUid, 9000n)).rejects.toThrow(
      /^Not enough HTR tokens for deposit or fee: 90 required, \d+ available$/
    );
    await expect(hWallet.mintTokens(fbtUid, 9000n)).rejects.toThrow(
      /^Not enough HTR tokens for deposit or fee: 1 required, \d+ available$/
    );

    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 9n);

    // Minting more of the tokens
    const mintAmount = BigInt(getRandomInt(100, 50));
    const mintResponse = await hWallet.mintTokens(tokenUid, mintAmount);
    expect(mintResponse.hash).toBeDefined();
    await waitForTxReceived(hWallet, mintResponse.hash);

    // Validating there is a correct reference to the custom token
    expect(mintResponse).toHaveProperty('tokens.length', 1);
    expect(mintResponse.tokens[0]).toEqual(tokenUid);

    // Validating a new mint authority was created by default
    const authorityOutputs = mintResponse.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs).toHaveLength(1);
    expect(authorityOutputs[0]).toHaveProperty('value', TOKEN_MINT_MASK);

    // Validating custom token balance
    const tokenBalance = await hWallet.getBalance(tokenUid);
    const expectedAmount = 100n + mintAmount;
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);

    // Mint tokens with defined mint authority address
    const address0 = await hWallet.getAddressAtIndex(0);

    const mintResponse2 = await hWallet.mintTokens(tokenUid, 100n, {
      mintAuthorityAddress: address0,
    });
    expect(mintResponse2.hash).toBeDefined();
    await waitForTxReceived(hWallet, mintResponse2.hash);

    // Validating there is a correct reference to the custom token
    expect(mintResponse2).toHaveProperty('tokens.length', 1);
    expect(mintResponse2.tokens[0]).toEqual(tokenUid);

    // Validating a new mint authority was created by default
    const authorityOutputs2 = mintResponse2.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs2).toHaveLength(1);
    const authorityOutput = authorityOutputs2[0];
    expect(authorityOutput.value).toEqual(TOKEN_MINT_MASK);
    const p2pkh = authorityOutput.parseScript(hWallet.getNetworkObject());
    // Validate that the authority output was sent to the correct address
    expect(p2pkh.address.base58).toEqual(address0);

    // Validating custom token balance
    const tokenBalance2 = await hWallet.getBalance(tokenUid);
    const expectedAmount2 = expectedAmount + 100n;
    expect(tokenBalance2[0]).toHaveProperty('balance.unlocked', expectedAmount2);

    // Mint tokens with external address should return error by default
    const hWallet2 = await generateWalletHelper();
    const externalAddress = await hWallet2.getAddressAtIndex(0);

    await expect(
      hWallet.mintTokens(tokenUid, 100, { mintAuthorityAddress: externalAddress })
    ).rejects.toThrow('must belong to your wallet');

    // Mint tokens with external address but allowing it
    const mintResponse4 = await hWallet.mintTokens(tokenUid, 100n, {
      mintAuthorityAddress: externalAddress,
      allowExternalMintAuthorityAddress: true,
    });
    expect(mintResponse4.hash).toBeDefined();
    await waitForTxReceived(hWallet, mintResponse4.hash);
    await waitForTxReceived(hWallet2, mintResponse4.hash);

    // Validating there is a correct reference to the custom token
    expect(mintResponse4).toHaveProperty('tokens.length', 1);
    expect(mintResponse4.tokens[0]).toEqual(tokenUid);

    // Validating a new mint authority was created by default
    const authorityOutputs4 = mintResponse4.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs4).toHaveLength(1);
    const authorityOutput4 = authorityOutputs4[0];
    expect(authorityOutput4.value).toEqual(TOKEN_MINT_MASK);
    const p4pkh = authorityOutput4.parseScript(hWallet.getNetworkObject());
    // Validate that the authority output was sent to the correct address
    expect(p4pkh.address.base58).toEqual(externalAddress);

    // Validating custom token balance
    const tokenBalance4 = await hWallet.getBalance(tokenUid);
    const expectedAmount4 = expectedAmount2 + 100n;
    expect(tokenBalance4[0]).toHaveProperty('balance.unlocked', expectedAmount4);

    // Delegate mint back to wallet 1
    const delegateResponse = await hWallet2.delegateAuthority(tokenUid, 'mint', address0);
    expect(delegateResponse.hash).toBeDefined();
    await waitForTxReceived(hWallet, delegateResponse.hash);
    await waitForTxReceived(hWallet2, delegateResponse.hash);

    const mintResponse5 = await hWallet.mintTokens(tokenUid, 100n, { data: ['foobar'] });
    expect(mintResponse5.hash).toBeDefined();
    await waitForTxReceived(hWallet, mintResponse5.hash);

    // Validating there is a correct reference to the custom token
    expect(mintResponse5).toHaveProperty('tokens.length', 1);
    expect(mintResponse5.tokens[0]).toEqual(tokenUid);

    // Validating custom token balance
    const tokenBalance5 = await hWallet.getBalance(tokenUid);
    const expectedAmount5 = expectedAmount4 + 100n;
    expect(tokenBalance5[0]).toHaveProperty('balance.unlocked', expectedAmount5);

    const dataOutput5 = mintResponse5.outputs[mintResponse5.outputs.length - 1];
    expect(dataOutput5).toHaveProperty('value', 1n);
    expect(dataOutput5).toHaveProperty('script', Buffer.from([6, 102, 111, 111, 98, 97, 114, 172]));

    const mintResponse6 = await hWallet.mintTokens(tokenUid, 100n, {
      unshiftData: true,
      data: ['foobar'],
    });
    expect(mintResponse6.hash).toBeDefined();
    await waitForTxReceived(hWallet, mintResponse6.hash);

    // Validating there is a correct reference to the custom token
    expect(mintResponse6).toHaveProperty('tokens.length', 1);
    expect(mintResponse6.tokens[0]).toEqual(tokenUid);

    // Validating custom token balance
    const tokenBalance6 = await hWallet.getBalance(tokenUid);
    const expectedAmount6 = expectedAmount5 + 100n;
    expect(tokenBalance6[0]).toHaveProperty('balance.unlocked', expectedAmount6);

    const dataOutput6 = mintResponse6.outputs[0];
    expect(dataOutput6).toHaveProperty('value', 1n);
    expect(dataOutput6).toHaveProperty('script', Buffer.from([6, 102, 111, 111, 98, 97, 114, 172]));
  });

  it('should deposit correct HTR values for minting', async () => {
    /**
     *
     * @param {HathorWallet} hWallet
     * @returns {Promise<number>}
     */
    async function getHtrBalance(hWallet) {
      const [htrBalance] = await hWallet.getBalance(NATIVE_TOKEN_UID);
      return htrBalance.balance.unlocked;
    }

    // Setting up scenario
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 13n);
    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Token to Mint', 'TMINT', 100n);
    const { hash: fbtUid } = await createTokenHelper(hWallet, 'FeeBasedToken', 'FBT', 8582n, {
      tokenVersion: TokenVersion.FEE,
    });
    let expectedHtrFunds = 11n;

    // Minting less than 1.00 tokens consumes 0.01 HTR
    let mintResponse;
    mintResponse = await hWallet.mintTokens(tokenUid, 1n);
    expectedHtrFunds -= 1n;
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Minting exactly 1.00 tokens consumes 0.01 HTR
    await waitUntilNextTimestamp(hWallet, mintResponse.hash);
    mintResponse = await hWallet.mintTokens(tokenUid, 100n);
    expectedHtrFunds -= 1n;
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Minting between 1.00 and 2.00 tokens consumes 0.02 HTR
    await waitUntilNextTimestamp(hWallet, mintResponse.hash);
    mintResponse = await hWallet.mintTokens(tokenUid, 101n);
    expectedHtrFunds -= 2n;
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Minting exactly 2.00 tokens consumes 0.02 HTR
    await waitUntilNextTimestamp(hWallet, mintResponse.hash);
    mintResponse = await hWallet.mintTokens(tokenUid, 200n);
    expectedHtrFunds -= 2n;
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Minting between 2.00 and 3.00 tokens consumes 0.03 HTR
    await waitUntilNextTimestamp(hWallet, mintResponse.hash);
    mintResponse = await hWallet.mintTokens(tokenUid, 201n);
    expectedHtrFunds -= 3n;
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // fee token minting
    // minting less than 1.00 tokens consumes 0.01 HTR based in the outputs length
    mintResponse = await hWallet.mintTokens(fbtUid, 1n);
    expectedHtrFunds -= 1n;
    expect(mintResponse.tokens.length).toBe(1);
    expect(mintResponse.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tokenData: 0,
          value: expectedHtrFunds,
        }),
        expect.objectContaining({
          tokenData: 1,
          value: 1n,
        }),
        expect.objectContaining({
          tokenData: TOKEN_AUTHORITY_MASK + 1,
          value: TOKEN_MINT_MASK,
        }),
      ])
    );
    expect(mintResponse.headers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({
              tokenIndex: 0,
              amount: 1n,
            }),
          ]),
        }),
      ])
    );
    await waitForTxReceived(hWallet, mintResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // minting any amount of tokens should consume 0.01 HTR
    const randomMintAmount = BigInt(Math.floor(Math.random() * (1_000_000_000 - 2 + 1)) + 2);
    mintResponse = await hWallet.mintTokens(fbtUid, randomMintAmount);
    expect(mintResponse.tokens.length).toBe(1);
    expect(mintResponse.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tokenData: 1,
          value: randomMintAmount,
        }),
        expect.objectContaining({
          tokenData: TOKEN_AUTHORITY_MASK + 1,
          value: TOKEN_MINT_MASK,
        }),
      ])
    );
    validateFeeAmount(mintResponse.headers, 1n);
    expectedHtrFunds -= 1n;
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
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 15n);

    // Creating the token
    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Token to Melt', 'TMELT', 500n);

    // Should not melt more than there is available
    await expect(hWallet.meltTokens(tokenUid, 999n)).rejects.toThrow(
      'Not enough tokens to melt: 999 requested, 500 available'
    );

    // Melting some tokens
    const meltAmount = BigInt(getRandomInt(99, 10));
    const { hash } = await hWallet.meltTokens(tokenUid, meltAmount);
    await waitForTxReceived(hWallet, hash);

    // Validating custom token balance
    const tokenBalance = await hWallet.getBalance(tokenUid);
    const expectedAmount = 500n - meltAmount;
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);

    // Melt tokens with defined melt authority address
    const address0 = await hWallet.getAddressAtIndex(0);
    const meltResponse = await hWallet.meltTokens(tokenUid, 100n, {
      meltAuthorityAddress: address0,
    });
    await waitForTxReceived(hWallet, meltResponse.hash);

    // Validating a new melt authority was created by default
    const authorityOutputs = meltResponse.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs).toHaveLength(1);
    const authorityOutput = authorityOutputs[0];
    expect(authorityOutput.value).toEqual(TOKEN_MELT_MASK);
    const p2pkh = authorityOutput.parseScript(hWallet.getNetworkObject());
    // Validate that the authority output was sent to the correct address
    expect(p2pkh.address.base58).toEqual(address0);

    // Validating custom token balance
    const tokenBalance2 = await hWallet.getBalance(tokenUid);
    const expectedAmount2 = expectedAmount - 100n;
    expect(tokenBalance2[0]).toHaveProperty('balance.unlocked', expectedAmount2);

    // Melt tokens with external address should return error
    const hWallet2 = await generateWalletHelper();
    const externalAddress = await hWallet2.getAddressAtIndex(0);

    await expect(
      hWallet.meltTokens(tokenUid, 100n, { meltAuthorityAddress: externalAddress })
    ).rejects.toThrow('must belong to your wallet');

    // Melt tokens with external address but allowing it
    const meltResponse3 = await hWallet.meltTokens(tokenUid, 100n, {
      meltAuthorityAddress: externalAddress,
      allowExternalMeltAuthorityAddress: true,
    });
    await waitForTxReceived(hWallet, meltResponse3.hash);
    await waitForTxReceived(hWallet2, meltResponse3.hash);

    // Validating a new melt authority was created by default
    const authorityOutputs3 = meltResponse3.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs3).toHaveLength(1);
    const authorityOutput3 = authorityOutputs3[0];
    expect(authorityOutput3.value).toEqual(TOKEN_MELT_MASK);
    const p3pkh = authorityOutput3.parseScript(hWallet.getNetworkObject());
    // Validate that the authority output was sent to the correct address
    expect(p3pkh.address.base58).toEqual(externalAddress);

    // Validating custom token balance
    const tokenBalance3 = await hWallet.getBalance(tokenUid);
    const expectedAmount3 = expectedAmount2 - 100n;
    expect(tokenBalance3[0]).toHaveProperty('balance.unlocked', expectedAmount3);

    // Delegate melt back to wallet 1
    const delegateResponse = await hWallet2.delegateAuthority(tokenUid, 'melt', address0);
    expect(delegateResponse.hash).toBeDefined();
    await waitForTxReceived(hWallet, delegateResponse.hash);
    await waitForTxReceived(hWallet2, delegateResponse.hash);

    const meltResponse4 = await hWallet.meltTokens(tokenUid, 100n, { data: ['foobar'] });
    expect(meltResponse4.hash).toBeDefined();
    await waitForTxReceived(hWallet, meltResponse4.hash);

    // Validating there is a correct reference to the custom token
    expect(meltResponse4).toHaveProperty('tokens.length', 1);
    expect(meltResponse4.tokens[0]).toEqual(tokenUid);

    // Validating custom token balance
    const tokenBalance4 = await hWallet.getBalance(tokenUid);
    const expectedAmount4 = expectedAmount3 - 100n;
    expect(tokenBalance4[0]).toHaveProperty('balance.unlocked', expectedAmount4);

    const dataOutput4 = meltResponse4.outputs[meltResponse4.outputs.length - 1];
    expect(dataOutput4).toHaveProperty('value', 1n);
    expect(dataOutput4).toHaveProperty('script', Buffer.from([6, 102, 111, 111, 98, 97, 114, 172]));

    const meltResponse5 = await hWallet.meltTokens(tokenUid, 100n, {
      unshiftData: true,
      data: ['foobar'],
    });
    expect(meltResponse5.hash).toBeDefined();
    await waitForTxReceived(hWallet, meltResponse5.hash);

    // Validating there is a correct reference to the custom token
    expect(meltResponse5).toHaveProperty('tokens.length', 1);
    expect(meltResponse5.tokens[0]).toEqual(tokenUid);

    // Validating custom token balance
    const tokenBalance5 = await hWallet.getBalance(tokenUid);
    const expectedAmount5 = expectedAmount4 - 100n;
    expect(tokenBalance5[0]).toHaveProperty('balance.unlocked', expectedAmount5);

    const dataOutput5 = meltResponse5.outputs[0];
    expect(dataOutput5).toHaveProperty('value', 1n);
    expect(dataOutput5).toHaveProperty('script', Buffer.from([6, 102, 111, 111, 98, 97, 114, 172]));
  });

  it('should melt fee based tokens', async () => {
    const hWallet = await generateWalletHelper();
    let expectedHtrAmount = 15n;
    await GenesisWalletHelper.injectFunds(
      hWallet,
      await hWallet.getAddressAtIndex(0),
      expectedHtrAmount
    );

    // Creating the token
    const { hash: fbtUid } = await createTokenHelper(hWallet, 'FeeBasedToken', 'FBT', 8582n, {
      tokenVersion: TokenVersion.FEE,
    });
    expectedHtrAmount -= 1n; // 14

    let htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    // Should not melt more than there is available
    await expect(hWallet.meltTokens(fbtUid, 99999n)).rejects.toThrow(
      'Not enough tokens to melt: 99999 requested, 8582 available'
    );

    htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    // Melting some tokens
    const meltAmount = BigInt(getRandomInt(99, 10));
    const { hash, headers } = await hWallet.meltTokens(fbtUid, meltAmount);
    await waitForTxReceived(hWallet, hash);
    validateFeeAmount(headers, 1n);
    expectedHtrAmount -= 1n; // 13

    htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    // Validating custom token balance
    const tokenBalance = await hWallet.getBalance(fbtUid);
    const expectedAmount = 8582n - meltAmount;
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);

    // Melt tokens with defined melt authority address
    const address0 = await hWallet.getAddressAtIndex(0);
    const meltResponse = await hWallet.meltTokens(fbtUid, 1000n, {
      meltAuthorityAddress: address0,
    });
    validateFeeAmount(meltResponse.headers, 1n);
    await waitForTxReceived(hWallet, meltResponse.hash);
    expectedHtrAmount -= 1n; // 12

    htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    // Validating a new melt authority was created by default
    const authorityOutputs = meltResponse.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs).toHaveLength(1);
    const authorityOutput = authorityOutputs[0];
    expect(authorityOutput.value).toEqual(TOKEN_MELT_MASK);
    const p2pkh = authorityOutput.parseScript(hWallet.getNetworkObject());
    // Validate that the authority output was sent to the correct address
    expect(p2pkh.address.base58).toEqual(address0);

    // Validating custom token balance
    const tokenBalance2 = await hWallet.getBalance(fbtUid);
    const expectedAmount2 = expectedAmount - 1000n;
    expect(tokenBalance2[0]).toHaveProperty('balance.unlocked', expectedAmount2);

    // Melt tokens with external address should return error
    const hWallet2 = await generateWalletHelper();
    const externalAddress = await hWallet2.getAddressAtIndex(0);

    await expect(
      hWallet.meltTokens(fbtUid, 100n, { meltAuthorityAddress: externalAddress })
    ).rejects.toThrow('must belong to your wallet');

    // Melt tokens with external address but allowing it
    const meltResponse3 = await hWallet.meltTokens(fbtUid, 100n, {
      meltAuthorityAddress: externalAddress,
      allowExternalMeltAuthorityAddress: true,
    });
    validateFeeAmount(meltResponse3.headers, 1n);
    await waitForTxReceived(hWallet, meltResponse3.hash);
    await waitForTxReceived(hWallet2, meltResponse3.hash);
    expectedHtrAmount -= 1n; // 11

    htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    // Validating a new melt authority was created by default
    const authorityOutputs3 = meltResponse3.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs3).toHaveLength(1);
    const authorityOutput3 = authorityOutputs3[0];
    expect(authorityOutput3.value).toEqual(TOKEN_MELT_MASK);
    const p3pkh = authorityOutput3.parseScript(hWallet.getNetworkObject());
    // Validate that the authority output was sent to the correct address
    expect(p3pkh.address.base58).toEqual(externalAddress);

    // Validating custom token balance
    const tokenBalance3 = await hWallet.getBalance(fbtUid);
    const expectedAmount3 = expectedAmount2 - 100n;
    expect(tokenBalance3[0]).toHaveProperty('balance.unlocked', expectedAmount3);

    // Delegate melt back to wallet 1
    const delegateResponse = await hWallet2.delegateAuthority(fbtUid, 'melt', address0);
    expect(delegateResponse.hash).toBeDefined();
    await waitForTxReceived(hWallet, delegateResponse.hash);
    await waitForTxReceived(hWallet2, delegateResponse.hash);

    const meltResponse4 = await hWallet.meltTokens(fbtUid, 100n, { data: ['foobar'] });
    validateFeeAmount(meltResponse4.headers, 1n);
    expect(meltResponse4.hash).toBeDefined();
    await waitForTxReceived(hWallet, meltResponse4.hash);
    expectedHtrAmount -= 2n; // 9 fee + 1 htr from data output

    htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    // Validating there is a correct reference to the custom token
    expect(meltResponse4).toHaveProperty('tokens.length', 1);
    expect(meltResponse4.tokens[0]).toEqual(fbtUid);

    // Validating custom token balance
    const tokenBalance4 = await hWallet.getBalance(fbtUid);
    const expectedAmount4 = expectedAmount3 - 100n;
    expect(tokenBalance4[0]).toHaveProperty('balance.unlocked', expectedAmount4);

    const dataOutput4 = meltResponse4.outputs[meltResponse4.outputs.length - 1];
    expect(dataOutput4).toHaveProperty('value', 1n);
    expect(dataOutput4).toHaveProperty('script', Buffer.from([6, 102, 111, 111, 98, 97, 114, 172]));

    const meltResponse5 = await hWallet.meltTokens(fbtUid, 100n, {
      unshiftData: true,
      data: ['foobar'],
    });
    validateFeeAmount(meltResponse.headers, 1n);
    expect(meltResponse5.hash).toBeDefined();
    await waitForTxReceived(hWallet, meltResponse5.hash);
    expectedHtrAmount -= 2n; // 7 fee + 1 htr from data output

    htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    // Validating there is a correct reference to the custom token
    expect(meltResponse5).toHaveProperty('tokens.length', 1);
    expect(meltResponse5.tokens[0]).toEqual(fbtUid);

    // Validating custom token balance
    const tokenBalance5 = await hWallet.getBalance(fbtUid);
    const expectedAmount5 = expectedAmount4 - 100n;
    expect(tokenBalance5[0]).toHaveProperty('balance.unlocked', expectedAmount5);

    const dataOutput5 = meltResponse5.outputs[0];
    expect(dataOutput5).toHaveProperty('value', 1n);
    expect(dataOutput5).toHaveProperty('script', Buffer.from([6, 102, 111, 111, 98, 97, 114, 172]));

    // melting without any output should charge 1 fee
    const meltResponse6 = await hWallet.meltTokens(fbtUid, expectedAmount5);
    validateFeeAmount(meltResponse6.headers, 1n);
    expect(meltResponse6.hash).toBeDefined();
    expect(meltResponse6.outputs).toHaveLength(2);
    expect(meltResponse6.outputs.filter(o => o.tokenData === 1).length).toBe(0);
    await waitForTxReceived(hWallet, meltResponse6.hash);
    expectedHtrAmount -= 1n; // 6 fee

    htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0]).toHaveProperty('balance.unlocked', expectedHtrAmount);

    const tokenBalance6 = await hWallet.getBalance(fbtUid);
    expect(tokenBalance6[0]).toHaveProperty('balance.unlocked', 0n);
  });

  it('should recover correct amount of HTR on melting', async () => {
    /**
     *
     * @param {HathorWallet} hWallet
     * @returns {Promise<number>}
     */
    async function getHtrBalance(hWallet) {
      const [htrBalance] = await hWallet.getBalance(NATIVE_TOKEN_UID);
      return htrBalance.balance.unlocked;
    }

    // Setting up scenario
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 20n);
    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Token to Melt', 'TMELT', 1900n);
    let expectedHtrFunds = 1n;

    let meltResponse;
    // Melting less than 1.00 tokens recovers 0 HTR
    meltResponse = await hWallet.meltTokens(tokenUid, 99n);
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting exactly 1.00 tokens recovers 0.01 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 100n);
    expectedHtrFunds += 1n;
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting between 1.00 and 2.00 tokens recovers 0.01 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 199n);
    expectedHtrFunds += 1n;
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting exactly 2.00 tokens recovers 0.02 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 200n);
    expectedHtrFunds += 2n;
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);

    // Melting between 2.00 and 3.00 tokens recovers 0.02 HTR
    await waitUntilNextTimestamp(hWallet, meltResponse.hash);
    meltResponse = await hWallet.meltTokens(tokenUid, 299n);
    expectedHtrFunds += 2n;
    await waitForTxReceived(hWallet, meltResponse.hash);
    expect(await getHtrBalance(hWallet)).toBe(expectedHtrFunds);
  });
});

describe('delegateAuthority', () => {
  /*
   * Since these tests need two wallets and the authority tokens are independent from token to token
   * we can reuse the wallets themselves and only do the build/cleanup operations once.
   */

  let hWallet1;
  let hWallet2;

  beforeAll(async () => {
    hWallet1 = await generateWalletHelper();
    hWallet2 = await generateWalletHelper();
  });

  afterAll(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should delegate authority between wallets', async () => {
    // Creating a Custom Token on wallet 1
    await GenesisWalletHelper.injectFunds(hWallet1, await hWallet1.getAddressAtIndex(0), 10n);
    const { hash: tokenUid } = await createTokenHelper(hWallet1, 'Delegate Token', 'DTK', 100n);

    // Should handle trying to delegate without the authority
    await expect(
      hWallet1.delegateAuthority(fakeTokenUid, 'mint', await hWallet2.getAddressAtIndex(0))
    ).rejects.toThrow();

    // Delegating mint authority to wallet 2
    const { hash: delegateMintTxId } = await hWallet1.delegateAuthority(
      tokenUid,
      'mint',
      await hWallet2.getAddressAtIndex(0)
    );
    await waitForTxReceived(hWallet1, delegateMintTxId);
    await waitForTxReceived(hWallet2, delegateMintTxId);

    // Expect wallet 1 to still have one mint authority
    let authorities1 = await hWallet1.getMintAuthority(tokenUid);
    expect(authorities1).toHaveLength(1);
    expect(authorities1[0]).toMatchObject({
      txId: delegateMintTxId,
      authorities: TOKEN_MINT_MASK,
    });
    // Expect wallet 2 to also have one mint authority
    let authorities2 = await hWallet2.getMintAuthority(tokenUid);
    expect(authorities2).toHaveLength(1);
    expect(authorities2[0]).toMatchObject({
      txId: delegateMintTxId,
      authorities: TOKEN_MINT_MASK,
    });

    // Delegating melt authority to wallet 2
    await waitUntilNextTimestamp(hWallet1, delegateMintTxId);
    const { hash: delegateMeltTxId } = await hWallet1.delegateAuthority(
      tokenUid,
      'melt',
      await hWallet2.getAddressAtIndex(0)
    );
    await waitForTxReceived(hWallet1, delegateMeltTxId);
    await waitForTxReceived(hWallet2, delegateMeltTxId);

    // Expect wallet 1 to still have one melt authority
    authorities1 = await hWallet1.getMeltAuthority(tokenUid);
    expect(authorities1).toHaveLength(1);
    expect(authorities1[0]).toMatchObject({
      txId: delegateMeltTxId,
      authorities: TOKEN_MELT_MASK,
    });
    // Expect wallet 2 to also have one melt authority
    authorities2 = await hWallet2.getMeltAuthority(tokenUid);
    expect(authorities2).toHaveLength(1);
    expect(authorities2[0]).toMatchObject({
      txId: delegateMeltTxId,
      authorities: TOKEN_MELT_MASK,
    });
  });

  it('should delegate authority to another wallet without keeping one', async () => {
    // Creating a Custom Token on wallet 1
    await GenesisWalletHelper.injectFunds(hWallet1, await hWallet1.getAddressAtIndex(0), 10n);
    const { hash: tokenUid } = await createTokenHelper(hWallet1, 'Delegate Token', 'DTK', 100n);

    // Delegate mint authority without keeping one on wallet 1
    const { hash: giveAwayMintTx } = await hWallet1.delegateAuthority(
      tokenUid,
      'mint',
      await hWallet2.getAddressAtIndex(0),
      { createAnother: false }
    );
    await waitForTxReceived(hWallet1, giveAwayMintTx);
    await waitForTxReceived(hWallet2, giveAwayMintTx);

    // Validating error on mint tokens from Wallet 1
    await waitUntilNextTimestamp(hWallet1, giveAwayMintTx);
    await expect(hWallet1.mintTokens(tokenUid, 100n)).rejects.toThrow();
    // TODO: The type of errors on mint and melt are different. They should have a standard.

    // Validating success on mint tokens from Wallet 2
    await GenesisWalletHelper.injectFunds(hWallet2, await hWallet2.getAddressAtIndex(0), 10n);
    const mintTxWallet2 = await hWallet2.mintTokens(tokenUid, 100n);
    expect(mintTxWallet2).toHaveProperty('hash');
    await waitForTxReceived(hWallet2, mintTxWallet2.hash);

    // Delegate melt authority without keeping one on wallet 1
    const { hash: giveAwayMeltTx } = await hWallet1.delegateAuthority(
      tokenUid,
      'melt',
      await hWallet2.getAddressAtIndex(0),
      { createAnother: false }
    );
    await waitForTxReceived(hWallet1, giveAwayMeltTx);
    await waitForTxReceived(hWallet2, giveAwayMeltTx);

    // Validating error on mint tokens from Wallet 1
    await waitUntilNextTimestamp(hWallet1, giveAwayMeltTx);
    await expect(hWallet1.meltTokens(tokenUid, 100n)).rejects.toThrow('authority output');

    // Validating success on melt tokens from Wallet 2
    await expect(hWallet2.meltTokens(tokenUid, 50n)).resolves.toHaveProperty('hash');
  });

  it('should delegate mint authority to another wallet while keeping one', async () => {
    // Creating a Custom Token on wallet 1
    await GenesisWalletHelper.injectFunds(hWallet1, await hWallet1.getAddressAtIndex(0), 10n);
    const { hash: tokenUid } = await createTokenHelper(hWallet1, 'Delegate Token 2', 'DTK2', 100n);

    // Creating another mint authority token on the same wallet
    const { hash: duplicateMintAuth } = await hWallet1.delegateAuthority(
      tokenUid,
      'mint',
      await hWallet1.getAddressAtIndex(1),
      { createAnother: true }
    );
    await waitForTxReceived(hWallet1, duplicateMintAuth);

    // Confirming two authority tokens on wallet1
    let auth1 = await hWallet1.getMintAuthority(tokenUid, { many: true });
    expect(auth1).toMatchObject([
      {
        txId: duplicateMintAuth,
        index: 0,
        address: await hWallet1.getAddressAtIndex(1),
        authorities: TOKEN_MINT_MASK,
      },
      {
        txId: duplicateMintAuth,
        index: 1,
        address: expect.any(String),
        authorities: TOKEN_MINT_MASK,
      },
    ]);

    // Now having two mint authority tokens on wallet 1, delegate a single one to wallet 2
    const { hash: delegateMintAuth } = await hWallet1.delegateAuthority(
      tokenUid,
      'mint',
      await hWallet2.getAddressAtIndex(1),
      { createAnother: false }
    );
    await waitForTxReceived(hWallet1, delegateMintAuth);
    await waitForTxReceived(hWallet2, delegateMintAuth);

    // Confirming only one authority token was sent from wallet1 to wallet2
    auth1 = await hWallet1.getMintAuthority(tokenUid, { many: true });
    expect(auth1).toMatchObject([
      {
        txId: duplicateMintAuth,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MINT_MASK,
      },
    ]);

    // Confirming one authority token was received by wallet2
    const auth2 = await hWallet2.getMintAuthority(tokenUid, { many: true });
    expect(auth2).toMatchObject([
      {
        txId: delegateMintAuth,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MINT_MASK,
      },
    ]);
  });

  it('should delegate melt authority to another wallet while keeping one', async () => {
    // Creating a Custom Token on wallet 1
    await GenesisWalletHelper.injectFunds(hWallet1, await hWallet1.getAddressAtIndex(0), 10n);
    const { hash: tokenUid } = await createTokenHelper(hWallet1, 'Delegate Token 2', 'DTK2', 100n);

    // Creating another melt authority token on the same wallet
    const { hash: duplicateMeltAuth } = await hWallet1.delegateAuthority(
      tokenUid,
      'melt',
      await hWallet1.getAddressAtIndex(1),
      { createAnother: true }
    );
    await waitForTxReceived(hWallet1, duplicateMeltAuth);

    // Confirming two authority tokens on wallet1
    let auth1 = await hWallet1.getMeltAuthority(tokenUid, { many: true });
    expect(auth1).toMatchObject([
      {
        txId: duplicateMeltAuth,
        index: 0,
        address: await hWallet1.getAddressAtIndex(1),
        authorities: TOKEN_MELT_MASK,
      },
      {
        txId: duplicateMeltAuth,
        index: 1,
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
      },
    ]);

    // Now having two melt authority tokens on wallet 1, delegate a single one to wallet 2
    const { hash: delegateMintAuth } = await hWallet1.delegateAuthority(
      tokenUid,
      'melt',
      await hWallet2.getAddressAtIndex(1),
      { createAnother: false }
    );
    await waitForTxReceived(hWallet1, delegateMintAuth);
    await waitForTxReceived(hWallet2, delegateMintAuth);

    // Confirming only one authority token was sent from wallet1 to wallet2
    auth1 = await hWallet1.getMeltAuthority(tokenUid, { many: true });
    expect(auth1).toMatchObject([
      {
        txId: duplicateMeltAuth,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
      },
    ]);

    // Confirming one authority token was received by wallet2
    const auth2 = await hWallet2.getMeltAuthority(tokenUid, { many: true });
    expect(auth2).toMatchObject([
      {
        txId: delegateMintAuth,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
      },
    ]);
  });
});

describe('destroyAuthority', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should destroy mint authorities', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token for MintDestroy',
      'DMINT',
      100n
    );

    // Adding another mint authority
    const { hash: newMintTx } = await hWallet.delegateAuthority(
      tokenUid,
      'mint',
      await hWallet.getAddressAtIndex(0)
    );
    await waitForTxReceived(hWallet, newMintTx);

    // Validating though getMintAuthority
    let mintAuthorities = await hWallet.getMintAuthority(tokenUid, { many: true });
    expect(mintAuthorities).toHaveLength(2);

    // Trying to destroy more authorities than there are available
    await expect(hWallet.destroyAuthority(tokenUid, 'mint', 3)).rejects.toThrow('utxos-available');

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
    await expect(hWallet.mintTokens(tokenUid, 100n)).rejects.toThrow('authority output');
  });

  it('should destroy melt authorities', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'Token for MeltDestroy',
      'DMELT',
      100n
    );

    // Adding another melt authority
    const { hash: newMeltTx } = await hWallet.delegateAuthority(
      tokenUid,
      'melt',
      await hWallet.getAddressAtIndex(0)
    );
    await waitForTxReceived(hWallet, newMeltTx);

    // Validating though getMeltAuthority
    let meltAuthorities = await hWallet.getMeltAuthority(tokenUid, { many: true });
    expect(meltAuthorities).toHaveLength(2);

    // Trying to destroy more authorities than there are available
    await expect(hWallet.destroyAuthority(tokenUid, 'melt', 3)).rejects.toThrow('utxos-available');

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
    await expect(hWallet.meltTokens(tokenUid, 100n)).rejects.toThrow('authority output');
  });
});

describe('create token with data outputs', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should create a token with data outputs', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);
    const tx = await createTokenHelper(hWallet, 'Token with data outputs', 'DOUT', 100n, {
      data: ['test1', 'test2'],
    });

    // Make sure the last 2 outputs are the data outputs
    const lastOutput = tx.outputs[tx.outputs.length - 1];
    expect(lastOutput.value).toBe(1n);
    expect(lastOutput.tokenData).toBe(0);
    const lastOutputScript = parseScriptData(lastOutput.script);
    expect(lastOutputScript.data).toBe('test2');

    const outputBeforeLast = tx.outputs[tx.outputs.length - 2];
    expect(outputBeforeLast.value).toBe(1n);
    expect(outputBeforeLast.tokenData).toBe(0);
    const outputBeforeLastScript = parseScriptData(outputBeforeLast.script);
    expect(outputBeforeLastScript.data).toBe('test1');

    expect(() => {
      tx.validateNft(hWallet.getNetworkObject());
    }).toThrow(NftValidationError);
  });
});

describe('createNFT', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should create an NFT with mint/melt authorities', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);

    // Creating one NFT with default authorities
    const nftTx = await hWallet.createNFT('New NFT', 'NNFT', 1n, sampleNftData, {
      createMint: true,
      createMelt: true,
    });
    expect(nftTx).toMatchObject({
      hash: expect.any(String),
      name: 'New NFT',
      symbol: 'NNFT',
    });
    await waitForTxReceived(hWallet, nftTx.hash);

    // Validating HTR fee payment
    const htrBalance = await hWallet.getBalance(NATIVE_TOKEN_UID);
    expect(htrBalance[0].balance.unlocked).toEqual(8n); // 1 deposit, 1 fee
    let nftBalance = await hWallet.getBalance(nftTx.hash);
    expect(nftBalance[0].balance.unlocked).toEqual(1n);

    // Validating mint authority
    let mintAuth = await hWallet.getMintAuthority(nftTx.hash, { many: true });
    expect(mintAuth).toHaveLength(1);
    expect(mintAuth[0]).toHaveProperty('txId', nftTx.hash);

    // Minting new NFT tokens and not creating new authorities
    await waitUntilNextTimestamp(hWallet, nftTx.hash);
    const rawMintTx = await hWallet.mintTokens(nftTx.hash, 10n, { createAnotherMint: false });
    expect(rawMintTx).toHaveProperty('hash');
    await waitForTxReceived(hWallet, rawMintTx.hash);
    nftBalance = await hWallet.getBalance(nftTx.hash);
    expect(nftBalance[0].balance.unlocked).toEqual(11n);

    // There should be no mint authority anymore
    mintAuth = await hWallet.getMintAuthority(nftTx.hash, { many: true });
    expect(mintAuth).toHaveLength(0);

    // Validating melt authority
    let meltAuth = await hWallet.getMeltAuthority(nftTx.hash, { many: true });
    expect(meltAuth).toHaveLength(1);
    expect(meltAuth[0]).toHaveProperty('txId', nftTx.hash);

    // Melting NFT tokens and not creating new authorities
    await waitUntilNextTimestamp(hWallet, rawMintTx.hash);
    const htrMelt = await hWallet.meltTokens(nftTx.hash, 5n, { createAnotherMelt: false });
    expect(htrMelt).toHaveProperty('hash');
    await waitForTxReceived(hWallet, htrMelt.hash);
    nftBalance = await hWallet.getBalance(nftTx.hash);
    expect(nftBalance[0].balance.unlocked).toEqual(6n);

    // There should be no melt authority anymore
    meltAuth = await hWallet.getMeltAuthority(nftTx.hash, { many: true });
    expect(meltAuth).toHaveLength(0);
  });

  it('should create an NFT without authorities', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);

    // Creating one NFT without authorities, and with a specific destination address
    const nftTx = await hWallet.createNFT('New NFT 2', 'NNFT2', 1n, sampleNftData, {
      createMint: false,
      createMelt: false,
      address: await hWallet.getAddressAtIndex(3),
      changeAddress: await hWallet.getAddressAtIndex(4),
    });
    expect(nftTx.hash).toBeDefined();
    await waitForTxReceived(hWallet, nftTx.hash);

    // Checking for authority outputs on the transaction
    const authorityOutputs = nftTx.outputs.filter(o => transaction.isAuthorityOutput(o));
    expect(authorityOutputs).toHaveLength(0);

    // Checking for the destination address
    const fullTx = await hWallet.getTx(nftTx.hash);
    const nftOutput = fullTx.outputs.find(o => o.token === nftTx.hash);
    expect(nftOutput).toHaveProperty('decoded.address', await hWallet.getAddressAtIndex(3));
  });

  it('Create token using mint/melt address', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr10 = await hWallet.getAddressAtIndex(10);
    const addr11 = await hWallet.getAddressAtIndex(11);
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);

    // Creating the new token
    const newTokenResponse = await hWallet.createNFT('New Token', 'NTKN', 100n, sampleNftData, {
      createMint: true,
      mintAuthorityAddress: addr10,
      createMelt: true,
      meltAuthorityAddress: addr11,
    });

    // Validating the creation tx
    expect(newTokenResponse).toHaveProperty('hash');
    await waitForTxReceived(hWallet, newTokenResponse.hash);

    // Validating a new mint authority was created by default
    const authorityOutputs = newTokenResponse.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs).toHaveLength(2);
    const mintOutput = authorityOutputs.filter(o => o.value === TOKEN_MINT_MASK);
    const mintP2pkh = mintOutput[0].parseScript(hWallet.getNetworkObject());
    // Validate that the mint output was sent to the correct address
    expect(mintP2pkh.address.base58).toEqual(addr10);

    const meltOutput = authorityOutputs.filter(o => o.value === TOKEN_MELT_MASK);
    const meltP2pkh = meltOutput[0].parseScript(hWallet.getNetworkObject());
    // Validate that the melt output was sent to the correct address
    expect(meltP2pkh.address.base58).toEqual(addr11);

    // Validating custom token balance
    const tokenBalance = await hWallet.getBalance(newTokenResponse.hash);
    const expectedAmount = 100n;
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);
  });

  it('Create token using external mint/melt address', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();
    const hWallet2 = await generateWalletHelper();
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr2_0 = await hWallet2.getAddressAtIndex(0);
    const addr2_1 = await hWallet2.getAddressAtIndex(1);
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);

    // Error creating token with external address
    await expect(
      hWallet.createNFT('New Token', 'NTKN', 100n, sampleNftData, {
        createMint: true,
        mintAuthorityAddress: addr2_0,
      })
    ).rejects.toThrow('must belong to your wallet');

    await expect(
      hWallet.createNFT('New Token', 'NTKN', 100n, sampleNftData, {
        createMelt: true,
        meltAuthorityAddress: addr2_1,
      })
    ).rejects.toThrow('must belong to your wallet');

    // Creating the new token allowing external address
    const newTokenResponse = await hWallet.createNFT('New Token', 'NTKN', 100n, sampleNftData, {
      createMint: true,
      mintAuthorityAddress: addr2_0,
      allowExternalMintAuthorityAddress: true,
      createMelt: true,
      meltAuthorityAddress: addr2_1,
      allowExternalMeltAuthorityAddress: true,
    });

    // Validating the creation tx
    expect(newTokenResponse).toHaveProperty('hash');
    await waitForTxReceived(hWallet, newTokenResponse.hash);
    await waitForTxReceived(hWallet2, newTokenResponse.hash);

    // Validating a new mint authority was created by default
    const authorityOutputs = newTokenResponse.outputs.filter(o =>
      transaction.isAuthorityOutput({ token_data: o.tokenData })
    );
    expect(authorityOutputs).toHaveLength(2);
    const mintOutput = authorityOutputs.filter(o => o.value === TOKEN_MINT_MASK);
    const mintP2pkh = mintOutput[0].parseScript(hWallet.getNetworkObject());
    // Validate that the mint output was sent to the correct address
    expect(mintP2pkh.address.base58).toEqual(addr2_0);

    const meltOutput = authorityOutputs.filter(o => o.value === TOKEN_MELT_MASK);
    const meltP2pkh = meltOutput[0].parseScript(hWallet.getNetworkObject());
    // Validate that the melt output was sent to the correct address
    expect(meltP2pkh.address.base58).toEqual(addr2_1);

    // Validating custom token balance
    const tokenBalance = await hWallet.getBalance(newTokenResponse.hash);
    const expectedAmount = 100n;
    expect(tokenBalance[0]).toHaveProperty('balance.unlocked', expectedAmount);
  });
});

describe('getToken methods', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should get the correct responses for a valid token', async () => {
    const hWallet = await generateWalletHelper();
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 10n);

    // Validating `getTokenDetails` for custom token not in this wallet
    await expect(hWallet.getTokenDetails(fakeTokenUid)).rejects.toThrow('Unknown token');

    // Validating `getTokens` for no custom tokens
    let getTokensResponse = await hWallet.getTokens();
    expect(getTokensResponse).toHaveLength(1);
    expect(getTokensResponse[0]).toEqual(NATIVE_TOKEN_UID);

    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Details Token', 'DTOK', 100n);

    // Validating `getTokens` response for having custom tokens
    getTokensResponse = await hWallet.getTokens();
    expect(getTokensResponse).toStrictEqual([NATIVE_TOKEN_UID, tokenUid]);

    // Validate `getTokenDetails` response for a valid token
    let details = await hWallet.getTokenDetails(tokenUid);
    expect(details).toStrictEqual({
      totalSupply: 100n,
      totalTransactions: 1,
      tokenInfo: {
        id: tokenUid,
        name: 'Details Token',
        symbol: 'DTOK',
        version: TokenVersion.DEPOSIT,
      },
      authorities: { mint: true, melt: true },
    });

    // Emptying the custom token
    const { hash: meltTx } = await hWallet.meltTokens(tokenUid, 100n);
    await waitForTxReceived(hWallet, meltTx);

    // Validating `getTokenDetails` response
    details = await hWallet.getTokenDetails(tokenUid);
    expect(details).toMatchObject({
      totalSupply: 0n,
      totalTransactions: 2,
      authorities: { mint: true, melt: true },
    });

    // Destroying mint authority and validating getTokenDetails results
    await waitUntilNextTimestamp(hWallet, meltTx);
    const { hash: dMintTx } = await hWallet.destroyAuthority(tokenUid, 'mint', 1);
    await waitForTxReceived(hWallet, dMintTx);
    details = await hWallet.getTokenDetails(tokenUid);
    expect(details).toMatchObject({
      totalTransactions: 2,
      authorities: { mint: false, melt: true },
    });

    // Destroying melt authority and validating getTokenDetails results
    await waitUntilNextTimestamp(hWallet, dMintTx);
    const { hash: dMeltTx } = await hWallet.destroyAuthority(tokenUid, 'melt', 1);
    await waitForTxReceived(hWallet, dMeltTx);
    details = await hWallet.getTokenDetails(tokenUid);
    expect(details).toMatchObject({
      totalTransactions: 2,
      authorities: { mint: false, melt: false },
    });

    // Validating `getTokens` response has not changed
    getTokensResponse = await hWallet.getTokens();
    expect(getTokensResponse).toStrictEqual([NATIVE_TOKEN_UID, tokenUid]);
  });
});

describe('signTx', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should sign the transaction', async () => {
    // Creating the wallet with the funds
    const hWallet = await generateWalletHelper();

    const addr0 = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);

    const { hash: tokenUid } = await createTokenHelper(hWallet, 'Signatures token', 'SIGT', 100n);

    const network = hWallet.getNetworkObject();
    // Build a Transaction to sign
    let sendTransaction = new SendTransaction({
      storage: hWallet.storage,
      outputs: [
        { address: await hWallet.getAddressAtIndex(5), value: 5n, token: NATIVE_TOKEN_UID },
        { address: await hWallet.getAddressAtIndex(6), value: 100n, token: tokenUid },
      ],
    });
    const txData = await sendTransaction.prepareTxData();
    const tx = transaction.createTransactionFromData(txData, network);
    tx.prepareToSend();

    // Sign transaction
    await hWallet.signTx(tx);
    sendTransaction = new SendTransaction({ storage: hWallet.storage, transaction: tx });
    const minedTx = await sendTransaction.runFromMining('mine-tx');
    expect(minedTx.nonce).toBeDefined();
    expect(minedTx.parents).not.toHaveLength(0);

    // Push transaction to test if fullnode will validate it.
    await sendTransaction.handlePushTx();
    await waitForTxReceived(hWallet, sendTransaction.transaction.hash);
  });
});

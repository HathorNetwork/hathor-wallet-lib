import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import { delay } from './utils/core.util';
import {
  createTokenHelper,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from './helpers/wallet.helper';
import { NATIVE_TOKEN_UID, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../src/constants';
import {
  WALLET_CONSTANTS,
} from './configuration/test-constants';
import dateFormatter from '../../src/utils/date';
import { AddressError } from '../../src/errors';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

describe('getAddressInfo', () => {
  /** @type HathorWallet */
  let hWallet;
  beforeAll(async () => {
    hWallet = await generateWalletHelper();
  });

  afterAll(async () => {
    await hWallet.stop();
  });

  it('should display correct values for HTR transactions with no change', async () => {
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr1 = await hWallet.getAddressAtIndex(1);

    // Validating empty address information
    await expect(hWallet.getAddressInfo(addr0)).resolves.toMatchObject({
      total_amount_received: 0n,
      total_amount_sent: 0n,
      total_amount_available: 0n,
      total_amount_locked: 0n, // Validating this field only once to check it's returned
      token: NATIVE_TOKEN_UID, // Validating this field only once to ensure it's correct
      index: 0,
    });

    // Validating address after 1 transaction
    await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);
    await expect(hWallet.getAddressInfo(addr0)).resolves.toMatchObject({
      total_amount_received: 10n,
      total_amount_sent: 0n,
      total_amount_available: 10n,
    });

    // Validating the results for two transactions
    let tx = await hWallet.sendTransaction(addr1, 10n);
    await waitForTxReceived(hWallet, tx.hash);
    await expect(hWallet.getAddressInfo(addr0)).resolves.toMatchObject({
      total_amount_received: 10n,
      total_amount_sent: 10n,
      total_amount_available: 0n,
      index: 0, // Ensuring the index is correct
    });
    await expect(hWallet.getAddressInfo(addr1)).resolves.toMatchObject({
      total_amount_received: 10n,
      total_amount_sent: 0n,
      total_amount_available: 10n,
      index: 1, // Ensuring the index is correct
    });

    // Validating the results for the funds returning to previously used address
    await waitUntilNextTimestamp(hWallet, tx.hash);
    tx = await hWallet.sendTransaction(addr0, 10n);
    await waitForTxReceived(hWallet, tx.hash);
    await expect(hWallet.getAddressInfo(addr0)).resolves.toMatchObject({
      total_amount_received: 20n,
      total_amount_sent: 10n,
      total_amount_available: 10n,
    });
    await expect(hWallet.getAddressInfo(addr1)).resolves.toMatchObject({
      total_amount_received: 10n,
      total_amount_sent: 10n,
      total_amount_available: 0n,
    });
  });

  it('should throw for an address outside the wallet', async () => {
    await expect(hWallet.getAddressInfo(WALLET_CONSTANTS.genesis.addresses[0])).rejects.toThrow(
      AddressError
    );
  });

  it('should display correct values for transactions with change', async () => {
    const addr2 = await hWallet.getAddressAtIndex(2);
    const addr3 = await hWallet.getAddressAtIndex(3);

    // Ensure both are empty addresses
    expect((await hWallet.getAddressInfo(addr2)).total_amount_received).toStrictEqual(0n);
    expect((await hWallet.getAddressInfo(addr3)).total_amount_received).toStrictEqual(0n);

    await delay(500);
    // Move all the wallet's funds to addr2
    let tx = await hWallet.sendTransaction(addr2, 10n);
    await waitForTxReceived(hWallet, tx.hash);
    await expect(hWallet.getAddressInfo(addr2)).resolves.toMatchObject({
      total_amount_received: 10n,
      total_amount_sent: 0n,
      total_amount_available: 10n,
    });

    // Move only a part of the funds to addr3, the change is returned to addr2
    tx = await hWallet.sendTransaction(addr3, 4n, { changeAddress: addr2 });
    await waitForTxReceived(hWallet, tx.hash);
    await expect(hWallet.getAddressInfo(addr2)).resolves.toMatchObject({
      total_amount_received: 16n, // 10 from one transaction, 6 from the transaction change
      total_amount_sent: 10n, // All the funds were sent
      total_amount_available: 6n, // Only the change remains available
    });
    await expect(hWallet.getAddressInfo(addr3)).resolves.toMatchObject({
      total_amount_received: 4n,
      total_amount_sent: 0n,
      total_amount_available: 4n,
    });
  });

  it('should return correct values for locked utxos', async () => {
    const timelock1 = Date.now().valueOf() + 5000; // 5 seconds of locked resources
    const timelockTimestamp = dateFormatter.dateToTimestamp(new Date(timelock1));
    const rawTimelockTx = await hWallet.sendManyOutputsTransaction([
      {
        address: await hWallet.getAddressAtIndex(0),
        value: 7n,
        token: NATIVE_TOKEN_UID,
      },
      {
        address: await hWallet.getAddressAtIndex(0),
        value: 3n,
        token: NATIVE_TOKEN_UID,
        timelock: timelockTimestamp,
      },
    ]);
    await waitForTxReceived(hWallet, rawTimelockTx.hash);

    // Validating locked balance
    await expect(hWallet.getAddressInfo(await hWallet.getAddressAtIndex(0))).resolves.toMatchObject(
      {
        total_amount_available: 7n,
        total_amount_locked: 3n,
      }
    );
  });

  it('should test custom token transactions', async () => {
    // Generating a new wallet to avoid conflict with HTR wallet
    const hWalletCustom = await generateWalletHelper();
    const addr0Custom = await hWalletCustom.getAddressAtIndex(0);
    const addr1Custom = await hWalletCustom.getAddressAtIndex(1);

    // Creating custom token
    await GenesisWalletHelper.injectFunds(hWalletCustom, addr0Custom, 1n);
    const { hash: tokenUid } = await createTokenHelper(
      hWalletCustom,
      'getAddressInfo Token',
      'GAIT',
      100n,
      { address: addr0Custom }
    );

    // Validating address information both in HTR and in custom token
    await expect(hWalletCustom.getAddressInfo(addr0Custom)).resolves.toMatchObject({
      total_amount_received: 1n,
      total_amount_sent: 1n, // Custom token mint consumed this balance
      total_amount_available: 0n,
      total_amount_locked: 0n,
      token: NATIVE_TOKEN_UID,
      index: 0,
    });
    await expect(
      hWalletCustom.getAddressInfo(addr0Custom, { token: tokenUid })
    ).resolves.toMatchObject({
      total_amount_received: 100n,
      total_amount_sent: 0n,
      total_amount_available: 100n,
      total_amount_locked: 0n,
      token: tokenUid,
      index: 0,
    });

    // Validating address after 1 transaction
    const tx = await hWalletCustom.sendTransaction(addr1Custom, 40n, { token: tokenUid });
    await waitForTxReceived(hWalletCustom, tx.hash);
    await expect(
      hWalletCustom.getAddressInfo(addr0Custom, { token: tokenUid })
    ).resolves.toMatchObject({
      total_amount_received: 100n,
      total_amount_sent: 100n,
      total_amount_available: 0n,
      token: tokenUid,
      index: 0,
    });
    await expect(
      hWalletCustom.getAddressInfo(addr1Custom, { token: tokenUid })
    ).resolves.toMatchObject({
      total_amount_received: 40n,
      total_amount_sent: 0n,
      total_amount_available: 40n,
      token: tokenUid,
      index: 1,
    });
  });
});

describe('getUtxosForAmount', () => {
  /** @type HathorWallet */
  let hWallet;
  let fundTx1hash;

  beforeAll(async () => {
    hWallet = await generateWalletHelper();
  });

  afterAll(async () => {
    hWallet.stop();
    await GenesisWalletHelper.clearListeners();
  });

  it('should throw on an empty wallet', async () => {
    // Should throw for invalid requested amount
    await expect(hWallet.getUtxosForAmount(0)).rejects.toThrow('positive integer');
    await expect(hWallet.getUtxosForAmount(-1)).rejects.toThrow('positive integer');

    // Should throw for an amount higher than available funds
    await expect(hWallet.getUtxosForAmount(1)).rejects.toThrow('utxos to fill total amount');
  });

  it('should work on a wallet containing a single tx', async () => {
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr1 = await hWallet.getAddressAtIndex(1);
    const tx1 = await GenesisWalletHelper.injectFunds(hWallet, addr0, 10n);
    fundTx1hash = tx1.hash;

    // No change amount
    await expect(hWallet.getUtxosForAmount(10n)).resolves.toStrictEqual({
      changeAmount: 0n,
      utxos: [
        {
          txId: fundTx1hash,
          index: expect.any(Number),
          token: NATIVE_TOKEN_UID,
          tokenId: NATIVE_TOKEN_UID,
          type: 1,
          address: addr0,
          value: 10n,
          authorities: 0n,
          timelock: null,
          height: null,
          heightlock: null,
          locked: false,
          addressPath: expect.any(String),
        },
      ],
    });

    await expect(hWallet.getUtxosForAmount(6n)).resolves.toStrictEqual({
      changeAmount: 4n,
      utxos: [
        expect.objectContaining({
          address: addr0,
          value: 10n,
        }),
      ],
    });

    // Should filter by address
    await expect(hWallet.getUtxosForAmount(10n, { filter_address: addr0 })).resolves.toStrictEqual({
      changeAmount: 0n,
      utxos: [expect.anything()],
    });
    await expect(hWallet.getUtxosForAmount(10n, { filter_address: addr1 })).rejects.toThrow(
      'utxos to fill total amount'
    );

    // Should throw for an amount higher than available funds
    await expect(hWallet.getUtxosForAmount(31n)).rejects.toThrow('utxos to fill total amount');
  });

  it('should work on a wallet containing multiple txs', async () => {
    const addr0 = await hWallet.getAddressAtIndex(0);
    const addr1 = await hWallet.getAddressAtIndex(1);
    const tx2 = await GenesisWalletHelper.injectFunds(hWallet, addr1, 20n);

    /*
     * Since we don't know which order the transactions will be stored on the history,
     * we can't make tests that depend on utxo ordering. These will be done on the unit
     * tests.
     */

    // Should select only one utxo to satisfy the amount when both can do it
    expect((await hWallet.getUtxosForAmount(7n)).utxos).toHaveLength(1);
    expect((await hWallet.getUtxosForAmount(10n)).utxos).toHaveLength(1);

    // Should select the least amount of utxos that can satisfy the amount
    await expect(hWallet.getUtxosForAmount(20n)).resolves.toStrictEqual({
      changeAmount: 0n,
      utxos: [
        expect.objectContaining({
          txId: tx2.hash,
          address: addr1,
          value: 20n,
        }),
      ],
    });

    // Should select more than one utxo to cover an amount
    await expect(hWallet.getUtxosForAmount(29n)).resolves.toStrictEqual({
      changeAmount: 1n,
      utxos: expect.arrayContaining([
        expect.objectContaining({
          txId: fundTx1hash,
          value: 10n,
        }),
        expect.objectContaining({
          txId: tx2.hash,
          value: 20n,
        }),
      ]),
    });

    // Should filter by address
    await expect(hWallet.getUtxosForAmount(10n, { filter_address: addr0 })).resolves.toStrictEqual({
      changeAmount: 0n,
      utxos: [
        expect.objectContaining({
          txId: fundTx1hash,
          address: addr0,
          value: 10n,
        }),
      ],
    });
    await expect(hWallet.getUtxosForAmount(10n, { filter_address: addr1 })).resolves.toStrictEqual({
      changeAmount: 10n,
      utxos: [
        expect.objectContaining({
          txId: tx2.hash,
          address: addr1,
          value: 20n,
        }),
      ],
    });

    // Should throw for an amount higher than available funds
    await expect(hWallet.getUtxosForAmount(31n)).rejects.toThrow('utxos to fill total amount');
  });

  it('should filter by custom token', async () => {
    const addr2 = await hWallet.getAddressAtIndex(2);
    const addr3 = await hWallet.getAddressAtIndex(3);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'getUtxosForAmount Test Token',
      'GUFAT',
      200n,
      { address: addr2 }
    );

    // Should work only with the token filter
    await expect(hWallet.getUtxosForAmount(6n, { token: tokenUid })).resolves.toStrictEqual({
      changeAmount: 194n,
      utxos: [
        expect.objectContaining({
          address: addr2,
          value: 200n,
          tokenId: tokenUid,
        }),
      ],
    });
    // Explicitly filtering for HTR
    await expect(hWallet.getUtxosForAmount(6n, { token: NATIVE_TOKEN_UID })).resolves.toStrictEqual(
      {
        changeAmount: expect.any(BigInt),
        utxos: [expect.objectContaining({ tokenId: NATIVE_TOKEN_UID })],
      }
    );
    // Implicitly filtering for HTR
    await expect(hWallet.getUtxosForAmount(6n)).resolves.toStrictEqual({
      changeAmount: expect.any(BigInt),
      utxos: [expect.objectContaining({ tokenId: NATIVE_TOKEN_UID })],
    });

    // The token filter should work combined with the address filter
    await expect(
      hWallet.getUtxosForAmount(6n, { token: tokenUid, filter_address: addr2 })
    ).resolves.toStrictEqual({
      changeAmount: 194n,
      utxos: [
        expect.objectContaining({
          address: addr2,
          value: 200n,
        }),
      ],
    });
    await expect(
      hWallet.getUtxosForAmount(6n, { token: tokenUid, filter_address: addr3 })
    ).rejects.toThrow('utxos to fill');
  });

  it('should not retrieve utxos marked as selected', async () => {
    // Retrieving the utxo's data and marking it as selected
    const addr = await hWallet.getAddressAtIndex(11);
    await GenesisWalletHelper.injectFunds(hWallet, addr, 100n);

    const utxosAddr1 = await hWallet.getUtxos({ filter_address: addr });
    const singleUtxoAddr1 = utxosAddr1.utxos[0];
    await hWallet.markUtxoSelected(singleUtxoAddr1.tx_id, singleUtxoAddr1.index, true);

    // Validate that it will not be retrieved on getUtxosForAmount
    await expect(hWallet.getUtxosForAmount(50n, { filter_address: addr })).rejects.toThrow(
      'utxos to fill'
    );
  });
});

describe('getAuthorityUtxos', () => {
  /** @type HathorWallet */
  let hWallet;
  /** @type string */
  let tokenHash;
  beforeAll(async () => {
    hWallet = await generateWalletHelper();
  });
  afterAll(async () => {
    hWallet.stop();
    await GenesisWalletHelper.clearListeners();
  });

  it('should work on an empty wallet', async () => {
    // Testing the wrapper method
    expect(await hWallet.getAuthorityUtxos(fakeTokenUid, 'mint')).toStrictEqual([]);
    expect(await hWallet.getAuthorityUtxos(fakeTokenUid, 'melt')).toStrictEqual([]);
    await expect(hWallet.getAuthorityUtxos(fakeTokenUid, 'invalid')).rejects.toThrow(
      'This should never happen.'
    ); // TODO: Improve this error message
  });

  it('should find one authority utxo', async () => {
    // Creating the token
    await GenesisWalletHelper.injectFunds(hWallet, await hWallet.getAddressAtIndex(0), 1n);
    const { hash: tokenUid } = await createTokenHelper(
      hWallet,
      'getAuthorityUtxos Token',
      'GAUT',
      100n
    );
    tokenHash = tokenUid;

    // Validating the wrapper method
    expect(await hWallet.getAuthorityUtxos(tokenHash, 'mint')).toStrictEqual([
      {
        txId: tokenHash,
        index: expect.any(Number),
        address: expect.any(String),
        token: tokenHash,
        authorities: 1n,
        value: 1n,
        height: null,
        timelock: null,
        type: expect.any(Number),
      },
    ]);
    expect(await hWallet.getAuthorityUtxos(tokenHash, 'melt')).toStrictEqual([
      {
        txId: tokenHash,
        index: expect.any(Number),
        address: expect.any(String),
        token: tokenHash,
        timelock: null,
        height: null,
        authorities: TOKEN_MELT_MASK,
        value: 2n,
        type: expect.any(Number),
      },
    ]);
  });

  it('should find many "mint" authority utxos', async () => {
    // Delegating the mint to another address on the same wallet
    const mintDelegationTx = await hWallet.delegateAuthority(
      tokenHash,
      'mint',
      await hWallet.getAddressAtIndex(1),
      { createAnother: false }
    );
    await waitForTxReceived(hWallet, mintDelegationTx.hash);

    // Should not find the spent utxo
    expect(await hWallet.getAuthorityUtxos(tokenHash, 'mint')).toMatchObject([
      {
        txId: mintDelegationTx.hash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MINT_MASK,
      },
    ]);
  });

  it('should find many "melt" authority utxos', async () => {
    // Delegating the mint to another address on the same wallet
    const meltDelegationTx = await hWallet.delegateAuthority(
      tokenHash,
      'melt',
      await hWallet.getAddressAtIndex(1),
      { createAnother: true }
    );
    await waitForTxReceived(hWallet, meltDelegationTx.hash);

    // When searching for "many", should find both the authority tokens
    const expectedMeltAuthUtxos = [
      {
        txId: meltDelegationTx.hash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
        height: null,
        timelock: null,
        token: tokenHash,
        type: expect.any(Number),
        value: TOKEN_MELT_MASK,
      },
      {
        txId: meltDelegationTx.hash,
        index: expect.any(Number),
        address: expect.any(String),
        authorities: TOKEN_MELT_MASK,
        height: null,
        timelock: null,
        token: tokenHash,
        type: expect.any(Number),
        value: TOKEN_MELT_MASK,
      },
    ];
    expect(await hWallet.getAuthorityUtxos(tokenHash, 'melt')).toStrictEqual(expectedMeltAuthUtxos);
  });
});

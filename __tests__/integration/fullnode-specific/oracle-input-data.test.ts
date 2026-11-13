/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Oracle input data signing (`unsafeGetOracleInputData`) on the fullnode facade.
 *
 * When the oracle script is an address, the wallet signs the result with that address' key, but
 * only if the address belongs to the loaded wallet. That ownership check uses the async
 * `isAddressMine`, so it must be awaited: a non-awaited Promise is always truthy, the check never
 * fires, and the failure surfaces later as an unrelated AddressError from the key lookup.
 */

import { crypto } from 'bitcore-lib';
import {
  DEFAULT_PIN_CODE,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
} from '../helpers/wallet.helper';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  getOracleBuffer,
  getOracleInputData,
  getOracleSignedDataFromUser,
  unsafeGetOracleInputData,
} from '../../../src/nano_contracts/utils';
import { OracleParseError } from '../../../src/errors';
import { NATIVE_TOKEN_UID } from '../../../src/constants';

const NC_ID = '000063f99b133c7630bc9d0117919f5b8726155412ad063dbbd618bdc7f85d7a';

describe('[Fullnode] oracle input data', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('rejects an oracle address that belongs to another wallet', async () => {
    const hWallet = await generateWalletHelper();
    const otherWallet = await generateWalletHelper();
    const network = hWallet.getNetworkObject();
    const foreignOracle = getOracleBuffer(await otherWallet.getAddressAtIndex(0), network);

    const result = unsafeGetOracleInputData(foreignOracle, Buffer.from('oracle-result'), hWallet, {
      pinCode: DEFAULT_PIN_CODE,
    });

    await expect(result).rejects.toThrow(OracleParseError);
    await expect(result).rejects.toThrow('Oracle address is not from the loaded wallet.');
  });

  it('signs the result with the key of an oracle address from the loaded wallet', async () => {
    const hWallet = await generateWalletHelper();
    const network = hWallet.getNetworkObject();
    const address = await hWallet.getAddressAtIndex(0);
    const ownOracle = getOracleBuffer(address, network);

    const inputData = await unsafeGetOracleInputData(
      ownOracle,
      Buffer.from('oracle-result'),
      hWallet,
      { pinCode: DEFAULT_PIN_CODE }
    );

    // The input data is <signature><public key>; it must carry this address' own public key.
    const key = await hWallet.getPrivateKeyFromAddress(address, { pinCode: DEFAULT_PIN_CODE });
    expect(inputData.length).toBeGreaterThan(0);
    expect(inputData.toString('hex')).toContain(key.publicKey.toString());
  });

  /**
   * An oracle signature is ECDSA over sha256(value) with the address' key, encoded as P2PKH input
   * data, and an input signature is ECDSA over sha256(sha256(dataToSign)). So signing a value
   * equal to sha256(dataToSign) of a transaction gives that transaction's input signature.
   */
  it('refuses to sign 32 bytes, which could be the signature hash of a transaction', async () => {
    const hWallet = await generateWalletHelper();
    const network = hWallet.getNetworkObject();
    const oracleAddress = await hWallet.getAddressAtIndex(0);
    const fundTx = await GenesisWalletHelper.injectFunds(hWallet, oracleAddress, 10n);
    await waitForTxReceived(hWallet, fundTx!.hash!);

    // A transaction spending the oracle address' funds, not signed.
    const sendTx = await hWallet.sendManyOutputsSendTransaction(
      [{ address: await hWallet.getAddressAtIndex(1), value: 10n, token: NATIVE_TOKEN_UID }],
      { pinCode: DEFAULT_PIN_CODE }
    );
    const tx = await sendTx.prepareTx();
    expect(tx.inputs[0].hash).toBe(fundTx!.hash);
    const attackValue = crypto.Hash.sha256(tx.getDataToSign());
    expect(attackValue).toHaveLength(32);

    await expect(
      unsafeGetOracleInputData(getOracleBuffer(oracleAddress, network), attackValue, hWallet, {
        pinCode: DEFAULT_PIN_CODE,
      })
    ).rejects.toThrow(
      new OracleParseError(
        'Refusing to sign 32 bytes of oracle data: it could be a transaction signature hash.'
      )
    );
    await sendTx.releaseUtxos();
  });

  it.each([
    ['30 bytes', 'ab'.repeat(30)],
    ['63 hex characters', NC_ID.slice(1)],
    ['65 hex characters', `${NC_ID}0`],
    ['a 0x prefix', `0x${NC_ID.slice(2)}`],
    ['a non-hex character', `${NC_ID.slice(0, 63)}g`],
    ['an empty string', ''],
  ])('refuses a nano contract id of %s', async (_label, ncId) => {
    const hWallet = await generateWalletHelper();
    const oracle = getOracleBuffer(await hWallet.getAddressAtIndex(0), hWallet.getNetworkObject());
    const error = new OracleParseError('Invalid nano contract id: expected 64 hex characters.');

    await expect(
      getOracleInputData(oracle, ncId, Buffer.from([0x01, 0x2f]), hWallet, {
        pinCode: DEFAULT_PIN_CODE,
      })
    ).rejects.toThrow(error);
    await expect(
      getOracleSignedDataFromUser(oracle, ncId, 'SignedData[str]', '/', hWallet, {
        pinCode: DEFAULT_PIN_CODE,
      })
    ).rejects.toThrow(error);
  });

  it.each([
    ['lowercase', NC_ID],
    ['uppercase', NC_ID.toUpperCase()],
  ])('signs sha256(nano contract id || result) for a %s id', async (_label, ncId) => {
    const hWallet = await generateWalletHelper();
    const address = await hWallet.getAddressAtIndex(0);
    const oracle = getOracleBuffer(address, hWallet.getNetworkObject());
    const result = Buffer.from([0x01, 0x2f]);

    const inputData = await getOracleInputData(oracle, ncId, result, hWallet, {
      pinCode: DEFAULT_PIN_CODE,
    });

    // P2PKH input data: <push signature><push public key>.
    const signature = inputData.subarray(1, 1 + inputData[0]);
    const publicKey = inputData.subarray(2 + inputData[0]);
    const key = await hWallet.getPrivateKeyFromAddress(address, { pinCode: DEFAULT_PIN_CODE });
    expect(publicKey.toString('hex')).toBe(key.publicKey.toString());
    const signed = crypto.Hash.sha256(Buffer.concat([Buffer.from(NC_ID, 'hex'), result]));
    expect(crypto.ECDSA.verify(signed, crypto.Signature.fromDER(signature), key.publicKey)).toBe(
      true
    );
  });
});

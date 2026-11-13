/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { crypto, PrivateKey } from 'bitcore-lib';
import Network from '../../src/models/network';
import Address from '../../src/models/address';
import Transaction from '../../src/models/transaction';
import Input from '../../src/models/input';
import Output from '../../src/models/output';
import P2PKH from '../../src/models/p2pkh';
import { OracleParseError } from '../../src/errors';
import {
  getOracleBuffer,
  getOracleInputData,
  getOracleSignedDataFromUser,
  unsafeGetOracleInputData,
} from '../../src/nano_contracts/utils';

/**
 * An oracle signature is ECDSA over sha256(value) with the oracle address' key, returned as P2PKH
 * input data. A transaction input signature is the same over sha256(sha256(dataToSign)). So the
 * oracle signer must never sign a value that can equal sha256(dataToSign): 32 bytes.
 */
describe('oracle input data', () => {
  const network = new Network('testnet');
  const oracleKey = new PrivateKey('5c'.repeat(32), network.bitcoreNetwork);
  const oracleAddress = oracleKey.toAddress(network.bitcoreNetwork).toString();
  const otherAddress = new PrivateKey('11'.repeat(32), network.bitcoreNetwork)
    .toAddress(network.bitcoreNetwork)
    .toString();
  const oracle = getOracleBuffer(oracleAddress, network);

  const NC_ID = '000063f99b133c7630bc9d0117919f5b8726155412ad063dbbd618bdc7f85d7a';
  const RESULT = Buffer.from([0x01, 0x2f]); // the str "/" serialized
  const NC_ID_ERROR = new OracleParseError('Invalid nano contract id: expected 64 hex characters.');
  const LENGTH_ERROR = new OracleParseError(
    'Refusing to sign 32 bytes of oracle data: it could be a transaction signature hash.'
  );

  // The parts of a wallet the oracle helpers use.
  const getPrivateKeyFromAddress = jest.fn(async () => oracleKey);
  const wallet = {
    getNetworkObject: () => network,
    storage: { isReadonly: async () => false, hasPrivateKeyMethod: () => false },
    isAddressMine: async (address: string) => address === oracleAddress,
    getPrivateKeyFromAddress,
  } as never;

  /** A transaction that spends an output of the oracle address. */
  function spendOracleFunds(value: bigint): Transaction {
    const script = new P2PKH(new Address(otherAddress, { network })).createScript();
    return new Transaction([new Input('ab'.repeat(32), 0)], [new Output(value, script)]);
  }

  /** Whether P2PKH input data (<signature> <public key>) signs `hash` with the oracle key. */
  function signs(inputData: Buffer, hash: Buffer): boolean {
    const signature = inputData.subarray(1, 1 + inputData[0]);
    const publicKey = inputData.subarray(2 + inputData[0]);
    return (
      publicKey.toString('hex') === oracleKey.publicKey.toString() &&
      crypto.ECDSA.verify(hash, crypto.Signature.fromDER(signature), oracleKey.publicKey)
    );
  }

  beforeEach(() => {
    getPrivateKeyFromAddress.mockClear();
  });

  it('refuses the signature hash of a transaction, before any key lookup', async () => {
    const tx = spendOracleFunds(1000n);
    const sighash = crypto.Hash.sha256(tx.getDataToSign());

    const result = unsafeGetOracleInputData(oracle, sighash, wallet);
    await expect(result).rejects.toBeInstanceOf(OracleParseError);
    await expect(result).rejects.toThrow(LENGTH_ERROR);
    expect(getPrivateKeyFromAddress).not.toHaveBeenCalled();
  });

  it('refuses a short contract id that completes a signature hash with the result', async () => {
    // sha256(dataToSign) = <30 bytes given as the contract id> 0x01 <one printable character>.
    let tx: Transaction | null = null;
    let sighash = Buffer.alloc(0);
    for (let value = 1n; tx === null && value < 1000000n; value += 1n) {
      const candidate = spendOracleFunds(value);
      const hash = crypto.Hash.sha256(candidate.getDataToSign());
      if (hash[30] === 0x01 && hash[31] >= 0x21 && hash[31] <= 0x7e) {
        tx = candidate;
        sighash = hash;
      }
    }
    expect(tx).not.toBeNull();
    const ncId = sighash.subarray(0, 30).toString('hex');
    const shown = String.fromCharCode(sighash[31]);

    await expect(
      getOracleSignedDataFromUser(oracle, ncId, 'SignedData[str]', shown, wallet)
    ).rejects.toThrow(NC_ID_ERROR);
    expect(getPrivateKeyFromAddress).not.toHaveBeenCalled();
  });

  it.each([
    ['30 bytes', 'ab'.repeat(30)],
    ['63 hex characters', NC_ID.slice(1)],
    ['65 hex characters', `${NC_ID}0`],
    ['a 0x prefix', `0x${NC_ID.slice(2)}`],
    ['a non-hex character', `${NC_ID.slice(0, 63)}g`],
    ['a leading space', ` ${NC_ID}`],
    ['a trailing newline', `${NC_ID}\n`],
    ['an empty string', ''],
    ['a Buffer', Buffer.from(NC_ID, 'hex')],
    ['undefined', undefined],
  ])('refuses a nano contract id of %s', async (_label, ncId) => {
    await expect(getOracleInputData(oracle, ncId as never, RESULT, wallet)).rejects.toThrow(
      NC_ID_ERROR
    );
    await expect(
      getOracleSignedDataFromUser(oracle, ncId as never, 'SignedData[str]', '/', wallet)
    ).rejects.toThrow(NC_ID_ERROR);
    expect(getPrivateKeyFromAddress).not.toHaveBeenCalled();
  });

  it('reports a malformed contract id before a malformed value', async () => {
    const result = getOracleSignedDataFromUser(
      oracle,
      'ab'.repeat(30),
      'SignedData[int]',
      'x',
      wallet
    );
    await expect(result).rejects.toBeInstanceOf(OracleParseError);
    await expect(result).rejects.toThrow(NC_ID_ERROR);
  });

  it('refuses a valid contract id with an empty result, which is 32 bytes', async () => {
    await expect(getOracleInputData(oracle, NC_ID, Buffer.alloc(0), wallet)).rejects.toThrow(
      LENGTH_ERROR
    );
    expect(getPrivateKeyFromAddress).not.toHaveBeenCalled();
  });

  it.each([
    ['lowercase', NC_ID],
    ['uppercase', NC_ID.toUpperCase()],
  ])('signs sha256(nano contract id || result) for a %s id', async (_label, ncId) => {
    const inputData = await getOracleInputData(oracle, ncId, RESULT, wallet);

    const signed = crypto.Hash.sha256(Buffer.concat([Buffer.from(NC_ID, 'hex'), RESULT]));
    expect(signs(inputData, signed)).toBe(true);
  });

  it.each([31, 33])('signs %d bytes of raw oracle data', async length => {
    const value = Buffer.alloc(length, 7);

    const inputData = await unsafeGetOracleInputData(oracle, value, wallet);

    expect(signs(inputData, crypto.Hash.sha256(value))).toBe(true);
  });

  it('returns an oracle that is not an address unchanged, for 32 bytes too', async () => {
    const dataScript = Buffer.from('0568656c6c6fac', 'hex'); // <"hello"> OP_CHECKSIG

    await expect(
      unsafeGetOracleInputData(dataScript, Buffer.alloc(32, 7), wallet)
    ).resolves.toEqual(dataScript);
    expect(getPrivateKeyFromAddress).not.toHaveBeenCalled();
  });
});

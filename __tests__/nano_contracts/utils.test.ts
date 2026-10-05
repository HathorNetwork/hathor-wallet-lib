/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { PrivateKey } from 'bitcore-lib';
import ncApi from '../../src/api/nano';
import {
  getBlueprintId,
  getOracleBuffer,
  unsafeGetOracleInputData,
} from '../../src/nano_contracts/utils';
import { NanoContractTransactionError, OracleParseError } from '../../src/errors';
import Network from '../../src/models/network';

const NC_ID = '00000eecf6a990576c12bfa9e12ee089a5b1ea65e6de1456687ba1f4dc7fd463';
const STATE_BLUEPRINT_ID = '00000000d6b22be00e31e4a7edabd0a9024611b3459a06fe1c49eeb194162702';
const CREATION_BLUEPRINT_ID = '00000013be63bc36d6a2f668e063be3536a990ef14874553057688e99f40929f';

type FakeWallet = { getFullTxById: jest.Mock };

const makeFakeWallet = (): FakeWallet => ({ getFullTxById: jest.fn() });

const stateOk = (blueprintId: string) => ({ success: true, blueprint_id: blueprintId });
const txOk = (blueprintId: string) => ({
  success: true,
  tx: { nc_id: NC_ID, nc_blueprint_id: blueprintId },
});

describe('getBlueprintId', () => {
  let stateSpy: jest.SpyInstance;

  beforeEach(() => {
    stateSpy = jest.spyOn(ncApi, 'getNanoContractState');
  });

  afterEach(() => {
    stateSpy.mockRestore();
  });

  it('throws when ncId is empty', async () => {
    const wallet = makeFakeWallet();
    await expect(getBlueprintId('', wallet as never)).rejects.toThrow(
      'Nano contract ID is not defined'
    );
    expect(stateSpy).not.toHaveBeenCalled();
    expect(wallet.getFullTxById).not.toHaveBeenCalled();
  });

  it('returns the post-upgrade blueprint id from the state endpoint', async () => {
    // Even when both endpoints would return different ids (i.e. an upgraded
    // contract), state is the source of truth.
    stateSpy.mockResolvedValue(stateOk(STATE_BLUEPRINT_ID));
    const wallet = makeFakeWallet();
    wallet.getFullTxById.mockResolvedValue(txOk(CREATION_BLUEPRINT_ID));

    const result = await getBlueprintId(NC_ID, wallet as never);

    expect(result).toBe(STATE_BLUEPRINT_ID);
    // Tx endpoint is not consulted when state succeeds.
    expect(wallet.getFullTxById).not.toHaveBeenCalled();
  });

  it('falls back to tx endpoint when the state endpoint throws', async () => {
    stateSpy.mockRejectedValue(new Error('state unavailable'));
    const wallet = makeFakeWallet();
    wallet.getFullTxById.mockResolvedValue(txOk(CREATION_BLUEPRINT_ID));

    const result = await getBlueprintId(NC_ID, wallet as never);

    expect(result).toBe(CREATION_BLUEPRINT_ID);
    expect(wallet.getFullTxById).toHaveBeenCalledWith(NC_ID);
  });

  it('falls back to tx endpoint when state response has no blueprint_id', async () => {
    // E.g. a 200 response with an unexpected shape — should still fall through.
    stateSpy.mockResolvedValue({ success: true });
    const wallet = makeFakeWallet();
    wallet.getFullTxById.mockResolvedValue(txOk(CREATION_BLUEPRINT_ID));

    const result = await getBlueprintId(NC_ID, wallet as never);

    expect(result).toBe(CREATION_BLUEPRINT_ID);
  });

  it('throws NanoContractTransactionError when both endpoints fail', async () => {
    stateSpy.mockRejectedValue(new Error('state unavailable'));
    const wallet = makeFakeWallet();
    wallet.getFullTxById.mockRejectedValue(new Error('tx unavailable'));

    await expect(getBlueprintId(NC_ID, wallet as never)).rejects.toBeInstanceOf(
      NanoContractTransactionError
    );
    // The thrown message should surface at least one underlying cause so the
    // caller can diagnose. Prefer the state error since state is the primary path.
    await expect(getBlueprintId(NC_ID, wallet as never)).rejects.toThrow(/state unavailable/);
  });

  it('throws when state has no blueprint_id and tx response is malformed', async () => {
    stateSpy.mockResolvedValue({ success: true });
    const wallet = makeFakeWallet();
    wallet.getFullTxById.mockResolvedValue({ success: true, tx: { nc_id: NC_ID } });

    await expect(getBlueprintId(NC_ID, wallet as never)).rejects.toBeInstanceOf(
      NanoContractTransactionError
    );
  });
});

describe('unsafeGetOracleInputData', () => {
  const network = new Network('testnet');
  const oracleKey = new PrivateKey();
  const oracleAddress = oracleKey.toAddress(network.bitcoreNetwork).toString();
  const oracleData = getOracleBuffer(oracleAddress, network);
  const result = Buffer.from('oracle-result');

  const makeOracleWallet = (isMine: boolean) => ({
    getNetworkObject: () => network,
    isAddressMine: jest.fn().mockResolvedValue(isMine),
    getPrivateKeyFromAddress: jest.fn().mockResolvedValue(oracleKey),
    storage: { isReadonly: jest.fn().mockResolvedValue(false) },
  });

  it('rejects an oracle address that is not from the loaded wallet', async () => {
    const wallet = makeOracleWallet(false);

    await expect(unsafeGetOracleInputData(oracleData, result, wallet as never)).rejects.toThrow(
      new OracleParseError('Oracle address is not from the loaded wallet.')
    );
    expect(wallet.isAddressMine).toHaveBeenCalledWith(oracleAddress);
    // The ownership check must stop the flow before any key is requested.
    expect(wallet.getPrivateKeyFromAddress).not.toHaveBeenCalled();
  });

  it('signs with the wallet key when the oracle address is from the loaded wallet', async () => {
    const wallet = makeOracleWallet(true);

    const inputData = await unsafeGetOracleInputData(oracleData, result, wallet as never);

    expect(wallet.getPrivateKeyFromAddress).toHaveBeenCalledWith(oracleAddress, {});
    // Input data ends with the oracle's public key (signature + pubkey script).
    expect(inputData.toString('hex')).toContain(oracleKey.publicKey.toString());
  });
});

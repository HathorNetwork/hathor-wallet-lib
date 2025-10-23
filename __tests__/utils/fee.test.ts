/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  FEE_PER_OUTPUT,
  NATIVE_TOKEN_UID,
  TOKEN_AUTHORITY_MASK,
  TOKEN_MELT_MASK,
  TOKEN_MINT_MASK,
} from '../../src/constants';
import { Fee } from '../../src/utils/fee';
import Output from '../../src/models/output';
import { MemoryStore, Storage } from '../../src/storage';
import { IDataInput, IStorage, OutputValueType } from '../../src/types';
import tokens from '../../src/utils/tokens';
import { OutputType } from '../../src/wallet/types';
import { mockGetToken } from '../__mock_helpers__/get-token.mock';

type Inputs = { [key: string]: { [key: string]: Partial<IDataInput> } };
describe('Fee test suite', () => {
  let storage: IStorage;
  const mockTokenInputs = (tokenUid: string) => ({
    swap: {
      authorities: 0n,
      token: tokenUid,
      value: 100n,
      data: '1',
    },
    mint: {
      authorities: 1n,
      token: tokenUid,
      value: 1n,
      data: (TOKEN_MINT_MASK & 1n).toString(),
    },
    melt: {
      authorities: 2n,
      token: tokenUid,
      value: 2n,
      data: (TOKEN_MELT_MASK & 1n).toString(),
    },
  });
  const mockTokenOutput = (tokenUid: string, value: OutputValueType, authorities: bigint = 0n) => ({
    type: OutputType.P2PKH,
    token: tokenUid,
    value,
    authorities,
  });

  const inputs: Inputs = {
    htr: mockTokenInputs(NATIVE_TOKEN_UID),
    // deposit based token
    dbt: mockTokenInputs('dbt'),
    // fee based token
    fbt: mockTokenInputs('fbt'),
  };

  beforeEach(() => {
    const store = new MemoryStore();
    storage = new Storage(store);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should calculate fee for create token transaction', async () => {
    // Arrange
    const outputs = [
      new Output(TOKEN_MINT_MASK, Buffer.from('asdasdas'), {
        tokenData: TOKEN_AUTHORITY_MASK + 1,
      }),
      new Output(10n, Buffer.from('asdasdas'), {
        tokenData: 1,
      }),
    ];
    const expectedFee = FEE_PER_OUTPUT;
    // Act
    const fee = Fee.calculateTokenCreationTxFee(outputs);

    // Assert
    expect(fee).toStrictEqual(expectedFee);
  });

  it('should ignore deposit based tokens and HTR', async () => {
    // Arrange
    const _inputs = [inputs.dbt.swap, inputs.dbt.mint, inputs.dbt.melt, inputs.htr.swap];

    const _outputs = [
      mockTokenOutput('dbt', 100n),
      mockTokenOutput(NATIVE_TOKEN_UID, inputs.htr.swap.value!),
    ];
    jest.spyOn(storage, 'getToken').mockImplementation(mockGetToken);

    // Act
    const ids = new Set(_inputs.concat(_outputs).map(el => el.token!));
    const _tokens = await tokens.getTokensByManyIds(storage, ids);
    const fee = await Fee.calculate(_inputs as never, _outputs as never, _tokens);

    // Assert
    expect(fee).toStrictEqual(0n);
  });

  it('should charge fee when melting without outputs', async () => {
    // Arrange
    const _inputs = [inputs.fbt.melt, inputs.fbt.swap];
    const _outputs = [];
    jest.spyOn(storage, 'getToken').mockImplementation(mockGetToken);

    // Act
    const ids = new Set(_inputs.concat(_outputs).map(el => el.token!));
    const _tokens = await tokens.getTokensByManyIds(storage, ids);
    const fee = await Fee.calculate(_inputs as never, _outputs as never, _tokens);

    // Assert
    expect(fee).toStrictEqual(FEE_PER_OUTPUT);
  });

  it('should charge fee based on the number of outputs', async () => {
    // Arrange
    const _inputs = [inputs.fbt.mint, inputs.fbt.swap, inputs.htr.swap];
    const _outputs = [
      mockTokenOutput('fbt', 100n),
      mockTokenOutput('fbt', 100n),
      mockTokenOutput('fbt', 100n),
      mockTokenOutput('fbt', 1n, 1n),
    ];
    jest.spyOn(storage, 'getToken').mockImplementation(mockGetToken);

    // Act
    const ids = new Set(_inputs.concat(_outputs).map(el => el.token!));
    const _tokens = await tokens.getTokensByManyIds(storage, ids);
    const fee = await Fee.calculate(_inputs as never, _outputs as never, _tokens);

    // Assert
    expect(fee).toStrictEqual(3n * FEE_PER_OUTPUT);
  });
});

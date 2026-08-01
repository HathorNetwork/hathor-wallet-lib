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

  /**
   * The fullnode cannot attribute a shielded input to a token at all — its
   * value (and for fully-shielded, its token) is hidden in commitments, so a
   * shielded input never counts toward chargeable_inputs on the node. The
   * wallet must mirror that, or an all-shielded spend of a FEE token would
   * over-declare the flat melt fee and fail the node's exact-match check.
   */
  describe('shielded input exclusion', () => {
    const shieldedFbtInput = { ...inputs.fbt.swap, shielded: true };

    it('excludes shielded FEE-token inputs from the melt branch', async () => {
      const _inputs = [shieldedFbtInput];
      const _outputs = [];
      jest.spyOn(storage, 'getToken').mockImplementation(mockGetToken);

      const _tokens = await tokens.getTokensByManyIds(storage, new Set(['fbt']));
      const fee = await Fee.calculate(_inputs as never, _outputs as never, _tokens);

      // All fbt inputs are shielded and there are no outputs: the node expects
      // no transparent fee at all. Before the exclusion this was FEE_PER_OUTPUT.
      expect(fee).toStrictEqual(0n);
    });

    it('keeps the melt fee when a transparent FEE-token input remains', async () => {
      const _inputs = [shieldedFbtInput, inputs.fbt.swap];
      const _outputs = [];
      jest.spyOn(storage, 'getToken').mockImplementation(mockGetToken);

      const _tokens = await tokens.getTokensByManyIds(storage, new Set(['fbt']));
      const fee = await Fee.calculate(_inputs as never, _outputs as never, _tokens);

      // The transparent input IS chargeable on the node, so the melt fee stays.
      expect(fee).toStrictEqual(FEE_PER_OUTPUT);
    });

    it('does not pull a shielded input token into the fee token set', async () => {
      // Without the exclusion, the shielded fbt input alone would add fbt to the
      // token set and the melt branch would charge it. dbt stays free either way.
      const _inputs = [shieldedFbtInput, inputs.dbt.swap];
      const _outputs = [mockTokenOutput('dbt', 100n)];
      jest.spyOn(storage, 'getToken').mockImplementation(mockGetToken);

      const _tokens = await tokens.getTokensByManyIds(storage, new Set(['fbt', 'dbt']));
      const fee = await Fee.calculate(_inputs as never, _outputs as never, _tokens);

      expect(fee).toStrictEqual(0n);
    });

    it('excludes IUtxo-shaped shielded inputs identically', async () => {
      const utxoShaped = {
        txId: 'a'.repeat(64),
        index: 0,
        token: 'fbt',
        address: 'W-addr',
        value: 100n,
        authorities: 0n,
        timelock: null,
        type: 1,
        height: null,
        shielded: true,
      };
      jest.spyOn(storage, 'getToken').mockImplementation(mockGetToken);

      const _tokens = await tokens.getTokensByManyIds(storage, new Set(['fbt']));
      const fee = await Fee.calculate([utxoShaped] as never, [] as never, _tokens);

      expect(fee).toStrictEqual(0n);
    });

    it('keeps unflagged inputs chargeable (back-compat)', async () => {
      // The wallet-service facade Utxo shape carries no `shielded` field; it
      // must keep today's behavior.
      const _inputs = [inputs.fbt.swap];
      jest.spyOn(storage, 'getToken').mockImplementation(mockGetToken);

      const _tokens = await tokens.getTokensByManyIds(storage, new Set(['fbt']));
      const fee = await Fee.calculate(_inputs as never, [] as never, _tokens);

      expect(fee).toStrictEqual(FEE_PER_OUTPUT);
    });

    it('applies to inputs only — output counting is unchanged', async () => {
      const _inputs = [shieldedFbtInput];
      const _outputs = [mockTokenOutput('fbt', 50n), mockTokenOutput('fbt', 50n)];
      jest.spyOn(storage, 'getToken').mockImplementation(mockGetToken);

      const _tokens = await tokens.getTokensByManyIds(storage, new Set(['fbt']));
      const fee = await Fee.calculate(_inputs as never, _outputs as never, _tokens);

      // Two transparent fbt outputs are charged per-output; the shielded input
      // neither adds a melt fee nor removes the output charges.
      expect(fee).toStrictEqual(2n * FEE_PER_OUTPUT);
    });
  });
});

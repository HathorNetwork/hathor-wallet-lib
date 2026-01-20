/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { selectTokens, selectAuthorities } from '../../../src/template/transaction/utils';
import { TxTemplateContext } from '../../../src/template/transaction/context';
import { getDefaultLogger } from '../../../src/types';
import { NATIVE_TOKEN_UID } from '../../../src/constants';
import Network from '../../../src/models/network';
import { ITxTemplateInterpreter } from '../../../src/template/transaction/types';

const DEBUG = false;

const address = 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ';
const token = '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e';
const txId = '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e';

const mockTokenDetails = {
  totalSupply: 1000n,
  totalTransactions: 1,
  tokenInfo: {
    name: 'TestToken',
    symbol: 'TST',
    version: 1,
  },
  authorities: {
    mint: true,
    melt: true,
  },
};

const createMockInterpreter = (changeAmount: bigint, utxos: unknown[]) => ({
  getNetwork: jest.fn().mockReturnValue(new Network('testnet')),
  getTokenDetails: jest.fn().mockResolvedValue(mockTokenDetails),
  getTx: jest.fn().mockResolvedValue({
    outputs: [
      {
        value: 100n,
        token,
        token_data: 1,
      },
    ],
  }),
  getUtxos: jest.fn().mockResolvedValue({
    changeAmount,
    utxos,
  }),
  getAuthorities: jest.fn().mockResolvedValue(utxos),
});

describe('selectTokens', () => {
  describe('token array behavior - tokens should only be in array when outputs are created', () => {
    it('should add token to array when autoChange=true and changeAmount > 0', async () => {
      const interpreter = createMockInterpreter(10n, [
        { txId, index: 0, tokenId: token, address, value: 100n, authorities: 0n },
      ]);
      const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);

      await selectTokens(
        interpreter,
        ctx,
        90n,
        { token },
        true, // autoChange
        address
      );

      // Token should be in array because a change output was created
      expect(ctx.tokens).toHaveLength(1);
      expect(ctx.tokens[0]).toBe(token);
      expect(ctx.outputs).toHaveLength(1);
      expect(ctx.outputs[0].value).toBe(10n);
    });

    it('should NOT add token to array when autoChange=false (even with changeAmount)', async () => {
      const interpreter = createMockInterpreter(10n, [
        { txId, index: 0, tokenId: token, address, value: 100n, authorities: 0n },
      ]);
      const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);

      await selectTokens(
        interpreter,
        ctx,
        90n,
        { token },
        false, // autoChange = false
        address
      );

      // Token should NOT be in array because no output was created
      expect(ctx.tokens).toHaveLength(0);
      expect(ctx.outputs).toHaveLength(0);
      // But token details should be cached
      expect(ctx.getTokenVersion(token)).toBe(1);
    });

    it('should NOT add token to array when changeAmount is 0', async () => {
      const interpreter = createMockInterpreter(0n, [
        { txId, index: 0, tokenId: token, address, value: 100n, authorities: 0n },
      ]);
      const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);

      await selectTokens(
        interpreter,
        ctx,
        100n, // exact amount, no change needed
        { token },
        true, // autoChange
        address
      );

      // Token should NOT be in array because no change output was created
      expect(ctx.tokens).toHaveLength(0);
      expect(ctx.outputs).toHaveLength(0);
      // But token details should be cached
      expect(ctx.getTokenVersion(token)).toBe(1);
    });

    it('should NOT add token to array when no UTXOs are found', async () => {
      const interpreter = createMockInterpreter(0n, []); // No UTXOs
      const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);

      await selectTokens(interpreter, ctx, 100n, { token }, true, address);

      // Token should NOT be in array because no inputs/outputs were created
      expect(ctx.tokens).toHaveLength(0);
      expect(ctx.inputs).toHaveLength(0);
      expect(ctx.outputs).toHaveLength(0);
      // But token details should be cached
      expect(ctx.getTokenVersion(token)).toBe(1);
    });

    it('should cache token details even when token is not added to array', async () => {
      const interpreter = createMockInterpreter(0n, [
        { txId, index: 0, tokenId: token, address, value: 100n, authorities: 0n },
      ]);
      const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);

      await selectTokens(interpreter, ctx, 100n, { token }, false, address);

      // Token not in array
      expect(ctx.tokens).toHaveLength(0);
      // But getTokenVersion should work (details are cached)
      expect(() => ctx.getTokenVersion(token)).not.toThrow();
      expect(ctx.getTokenVersion(token)).toBe(1);
    });
  });

  describe('HTR (native token) behavior', () => {
    it('should handle HTR correctly - never added to tokens array', async () => {
      const interpreter = createMockInterpreter(10n, [
        { txId, index: 0, tokenId: NATIVE_TOKEN_UID, address, value: 100n, authorities: 0n },
      ]) as unknown as ITxTemplateInterpreter;
      // Override getTx for HTR
      interpreter.getTx = jest.fn().mockResolvedValue({
        outputs: [{ value: 100n, token: NATIVE_TOKEN_UID, token_data: 0 }],
      });

      const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);

      await selectTokens(interpreter, ctx, 90n, { token: NATIVE_TOKEN_UID }, true, address);

      // HTR should never be in the tokens array (token_data=0 is implicit)
      expect(ctx.tokens).toHaveLength(0);
      // But an output should be created
      expect(ctx.outputs).toHaveLength(1);
      expect(ctx.outputs[0].tokenData).toBe(0);
    });
  });

  describe('inputs are correctly added', () => {
    it('should add inputs from UTXOs', async () => {
      const interpreter = createMockInterpreter(0n, [
        { txId, index: 0, tokenId: token, address, value: 50n, authorities: 0n },
        { txId, index: 1, tokenId: token, address, value: 50n, authorities: 0n },
      ]);
      // Override getTx to return two outputs
      interpreter.getTx = jest.fn().mockResolvedValue({
        outputs: [
          { value: 50n, token, token_data: 1 },
          { value: 50n, token, token_data: 1 },
        ],
      });
      const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);

      await selectTokens(interpreter, ctx, 100n, { token }, false, address);

      expect(ctx.inputs).toHaveLength(2);
      expect(ctx.inputs[0].hash).toBe(txId);
      expect(ctx.inputs[0].index).toBe(0);
      expect(ctx.inputs[1].hash).toBe(txId);
      expect(ctx.inputs[1].index).toBe(1);
    });
  });
});

describe('selectAuthorities', () => {
  describe('token array behavior - authorities should NEVER add token to array', () => {
    it('should NOT add token to array when selecting authorities', async () => {
      const interpreter = createMockInterpreter(0n, [
        { txId, index: 0, tokenId: token, address, value: 1n, authorities: 1n },
      ]);
      const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);

      await selectAuthorities(interpreter, ctx, { token, authorities: 1n }, 1);

      // Token should NOT be in array - selectAuthorities never creates outputs
      expect(ctx.tokens).toHaveLength(0);
      expect(ctx.outputs).toHaveLength(0);
      // But token details should be cached
      expect(ctx.getTokenVersion(token)).toBe(1);
    });

    it('should add inputs from authority UTXOs', async () => {
      const interpreter = createMockInterpreter(0n, [
        { txId, index: 0, tokenId: token, address, value: 1n, authorities: 1n },
      ]);
      const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);

      await selectAuthorities(interpreter, ctx, { token, authorities: 1n }, 1);

      expect(ctx.inputs).toHaveLength(1);
      expect(ctx.inputs[0].hash).toBe(txId);
      expect(ctx.inputs[0].index).toBe(0);
    });

    it('should cache token details even though token is not in array', async () => {
      const interpreter = createMockInterpreter(0n, [
        { txId, index: 0, tokenId: token, address, value: 1n, authorities: 1n },
      ]);
      const ctx = new TxTemplateContext(getDefaultLogger(), DEBUG);

      await selectAuthorities(interpreter, ctx, { token, authorities: 1n }, 1);

      // getTokenVersion should work
      expect(() => ctx.getTokenVersion(token)).not.toThrow();
      expect(ctx.getTokenVersion(token)).toBe(1);
    });
  });
});

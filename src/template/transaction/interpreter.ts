/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  TxTemplateInstructionType,
} from './instructions';
import {
  execAuthorityOutputInstruction,
  execAuthoritySelectInstruction,
  execChangeInstruction,
  execConfigInstruction,
  execDataOutputInstruction,
  execRawInputInstruction,
  execRawOutputInstruction,
  execSetVarInstruction,
  execShuffleInstruction,
  execTokenOutputInstruction,
  execUtxoSelectInstruction,
} from './executor';
import { TxTemplateContext } from './context';
import { ITxTemplateInterpreter, IGetUtxosOptions, IGetUtxoResponse } from './types';
import { IHistoryTx, OutputValueType } from '../../types';
import {
  FullNodeInput,
  FullNodeOutput,
  FullNodeToken,
  FullNodeTxResponse,
  Utxo,
} from '../../wallet/types';
import Transaction from '../../models/transaction';
import HathorWallet from '../../new/wallet';
import {
  NATIVE_TOKEN_UID,
} from '../../constants';
import transactionUtils from '../../utils/transaction';
import tokenUtils from '../../utils/tokens';
import Network from '../../models/network';

export class WalletTxTemplateInterpreter implements ITxTemplateInterpreter {
  wallet: HathorWallet;

  txCache: Record<string, IHistoryTx>;

  constructor(wallet: HathorWallet) {
    this.wallet = wallet;
    this.txCache = {};
  }

  async build(instructions: TxTemplateInstructionType[], debug: boolean = false): Promise<Transaction> {
    const context = new TxTemplateContext(this.wallet.logger, debug);

    for (const ins of instructions) {
      await runInstruction(this, context, ins);
    }

    return new Transaction(context.inputs, context.outputs, {
      signalBits: context.signalBits,
      version: context.version,
      tokens: context.tokens,
    });
  }

  async getAddress(markAsUsed: boolean = false): Promise<string> {
    const addr = await this.wallet.getCurrentAddress({ markAsUsed });
    return addr.address;
  }

  /**
   * XXX: maybe we can save the change address chosen on the context.
   * This way the same change address would be used throughout the transaction
   */
  async getChangeAddress(_ctx: TxTemplateContext) {
    const addr = await this.wallet.getCurrentAddress();
    return addr.address;
  }

  async getUtxos(amount: OutputValueType, options: IGetUtxosOptions): Promise<IGetUtxoResponse> {
    // XXX: This may throw, but maybe we should let it.
    return await this.wallet.getUtxosForAmount(amount, options);
  }

  async getAuthorities(count: number, options: IGetUtxosOptions): Promise<Utxo[]> {
    const newOptions = {
      ...options,
      max_utxos: count,
    };
    let utxos: Utxo[] = [];
    // XXX: This may throw, but maybe we should let it.
    for await (const utxo of this.wallet.storage.selectUtxos(newOptions)) {
      utxos.push(utxo);
    }
    return utxos;
  }

  async getTx(txId: string): Promise<IHistoryTx> {
    if (this.txCache[txId]) {
      return this.txCache[txId];
    }

    const histtx = await this.wallet.getTx(txId);
    if (histtx) {
      this.txCache[txId] = histtx as IHistoryTx;
      return this.txCache[txId];
    }

    function hidrateIOWithToken<T extends FullNodeInput | FullNodeOutput>(
      io: T,
      tokens: FullNodeToken[]
    ) {
      const { token_data } = io;
      if (token_data === 0) {
        return {
          ...io,
          token: NATIVE_TOKEN_UID,
        };
      }

      const tokenIdx = tokenUtils.getTokenIndexFromData(token_data);
      const tokenUid = tokens[tokenIdx - 1]?.uid;
      if (!tokenUid) {
        throw new Error(`Invalid token_data ${token_data}, token not found in tokens list`);
      }

      return { ...io, token: tokenUid } as T;
    }

    const resp = (await this.wallet.getFullTxById(txId)) as FullNodeTxResponse;
    // We can assume the wallet handles any network errors
    const { tx } = resp;
    tx.inputs = tx.inputs.map(i => hidrateIOWithToken<FullNodeInput>(i, tx.tokens));
    tx.outputs = tx.outputs.map(o => hidrateIOWithToken<FullNodeOutput>(o, tx.tokens));
    const normalizedTx = transactionUtils.convertFullNodeTxToHistoryTx(tx);
    this.txCache[txId] = normalizedTx;
    return this.txCache[txId];
  }

  getNetwork(): Network {
    return this.wallet.getNetworkObject();
  }
}

export async function runInstruction(
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: TxTemplateInstructionType
) {
  const instructionExecutor = findInstructionExecution(ins);
  await instructionExecutor(interpreter, ctx, ins);
}

export function findInstructionExecution(ins: TxTemplateInstructionType): (
  interpreter: ITxTemplateInterpreter,
  ctx: TxTemplateContext,
  ins: any
) => Promise<void> {
  if (ins.type === 'input/raw') {
    return execRawInputInstruction;
  }
  if (ins.type === 'input/utxo') {
    return execUtxoSelectInstruction;
  }
  if (ins.type === 'input/authority') {
    return execAuthoritySelectInstruction;
  }
  if (ins.type === 'output/raw') {
    return execRawOutputInstruction;
  }
  if (ins.type === 'output/data') {
    return execDataOutputInstruction;
  }
  if (ins.type === 'output/token') {
    return execTokenOutputInstruction;
  }
  if (ins.type === 'output/authority') {
    return execAuthorityOutputInstruction;
  }
  if (ins.type === 'action/shuffle') {
    return execShuffleInstruction;
  }
  if (ins.type === 'action/change') {
    return execChangeInstruction;
  }
  if (ins.type === 'action/config') {
    return execConfigInstruction;
  }
  if (ins.type === 'action/setvar') {
    return execSetVarInstruction;
  }

  throw new Error('Cannot determine the instruction to run');
}
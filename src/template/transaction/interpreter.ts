/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { TransactionTemplate } from './instructions';
import { runInstruction } from './executor';
import { TxTemplateContext } from './context';
import {
  ITxTemplateInterpreter,
  IGetUtxosOptions,
  IGetUtxoResponse,
  IWalletBalanceData,
  TxInstance,
} from './types';
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
import { CREATE_TOKEN_TX_VERSION, DEFAULT_TX_VERSION, NATIVE_TOKEN_UID } from '../../constants';
import transactionUtils from '../../utils/transaction';
import tokenUtils from '../../utils/tokens';
import Network from '../../models/network';
import CreateTokenTransaction from '../../models/create_token_transaction';

export class WalletTxTemplateInterpreter implements ITxTemplateInterpreter {
  wallet: HathorWallet;

  txCache: Record<string, IHistoryTx>;

  constructor(wallet: HathorWallet) {
    this.wallet = wallet;
    this.txCache = {};
  }

  async build(
    instructions: z.infer<typeof TransactionTemplate>,
    debug: boolean = false
  ): Promise<TxInstance> {
    const context = new TxTemplateContext(this.wallet.logger, debug);

    for (const ins of TransactionTemplate.parse(instructions)) {
      await runInstruction(this, context, ins);
    }

    if (context.version === DEFAULT_TX_VERSION) {
      return new Transaction(context.inputs, context.outputs, {
        signalBits: context.signalBits,
        version: context.version,
        tokens: context.tokens,
      });
    }
    if (context.version === CREATE_TOKEN_TX_VERSION) {
      if (!context.tokenName || !context.tokenSymbol) {
        throw new Error('Cannot create a token without a name or symbol');
      }
      return new CreateTokenTransaction(
        context.tokenName,
        context.tokenSymbol,
        context.inputs,
        context.outputs,
        { signalBits: context.signalBits }
      );
    }
    throw new Error('Unsupported Version byte provided');
  }

  async getAddress(markAsUsed: boolean = false): Promise<string> {
    const addr = await this.wallet.getCurrentAddress({ markAsUsed });
    return addr.address;
  }

  async getAddressAtIndex(index: number): Promise<string> {
    return this.wallet.getAddressAtIndex(index);
  }

  async getBalance(token: string): Promise<IWalletBalanceData> {
    const balance = await this.wallet.getBalance(token);
    return balance[0];
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
    return this.wallet.getUtxosForAmount(amount, options);
  }

  async getAuthorities(count: number, options: IGetUtxosOptions): Promise<Utxo[]> {
    const newOptions = {
      ...options,
      max_utxos: count,
    };
    const utxos: Utxo[] = [];
    // XXX: This may throw, but maybe we should let it.
    for await (const utxo of this.wallet.storage.selectUtxos(newOptions)) {
      utxos.push(utxo);
    }
    return utxos;
  }

  _hidrateIOWithToken<T extends FullNodeInput | FullNodeOutput>(
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

  async getTx(txId: string): Promise<IHistoryTx> {
    if (this.txCache[txId]) {
      return this.txCache[txId];
    }

    const histtx = await this.wallet.getTx(txId);
    if (histtx) {
      this.txCache[txId] = histtx as IHistoryTx;
      return this.txCache[txId];
    }

    const resp = (await this.wallet.getFullTxById(txId)) as FullNodeTxResponse;
    // We can assume the wallet handles any network errors
    const { tx } = resp;
    tx.inputs = tx.inputs.map(i => this._hidrateIOWithToken<FullNodeInput>(i, tx.tokens));
    tx.outputs = tx.outputs.map(o => this._hidrateIOWithToken<FullNodeOutput>(o, tx.tokens));
    const normalizedTx = transactionUtils.convertFullNodeTxToHistoryTx(tx);
    this.txCache[txId] = normalizedTx;
    return this.txCache[txId];
  }

  getNetwork(): Network {
    return this.wallet.getNetworkObject();
  }
}

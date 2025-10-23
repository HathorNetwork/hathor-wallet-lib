/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { FullNodeTxApiResponse } from '../../api/schemas/txApi';
import { TransactionTemplate, NanoAction } from './instructions';
import { runInstruction } from './executor';
import { TxTemplateContext, NanoContractContext } from './context';
import {
  ITxTemplateInterpreter,
  IGetUtxosOptions,
  IGetUtxoResponse,
  IWalletBalanceData,
  TxInstance,
} from './types';
import { IHistoryTx, OutputValueType } from '../../types';
import { IHathorWallet, Utxo } from '../../wallet/types';
import Transaction from '../../models/transaction';
import Address from '../../models/address';
import HathorWallet from '../../new/wallet';
import {
  CREATE_TOKEN_TX_VERSION,
  DEFAULT_TX_VERSION,
  NANO_CONTRACTS_INITIALIZE_METHOD,
  TOKEN_MELT_MASK,
  TOKEN_MINT_MASK,
} from '../../constants';
import transactionUtils from '../../utils/transaction';
import leb128 from '../../utils/leb128';
import tokensUtils from '../../utils/tokens';
import Network from '../../models/network';
import CreateTokenTransaction from '../../models/create_token_transaction';
import NanoContractHeader from '../../nano_contracts/header';
import { ActionTypeToActionHeaderType, NanoContractActionHeader } from '../../nano_contracts/types';
import { validateAndParseBlueprintMethodArgs } from '../../nano_contracts/utils';
import type Header from '../../headers/base';

export class WalletTxTemplateInterpreter implements ITxTemplateInterpreter {
  wallet: HathorWallet;

  txCache: Record<string, IHistoryTx>;

  constructor(wallet: HathorWallet) {
    this.wallet = wallet;
    this.txCache = {};
  }

  async getBlueprintId(nanoCtx: NanoContractContext): Promise<string> {
    if (nanoCtx.method === NANO_CONTRACTS_INITIALIZE_METHOD) {
      return nanoCtx.id;
    }

    let response;
    try {
      response = await this.wallet.getFullTxById(nanoCtx.id);
    } catch (ex: unknown) {
      throw new Error(`Error getting nano contract transaction with id ${nanoCtx.id}.`);
    }

    if (!response.tx.nc_id) {
      throw new Error(`Transaction ${nanoCtx.id} is not a nano contract.`);
    }

    return response.tx.nc_blueprint_id;
  }

  static mapActionInstructionToAction(
    ctx: TxTemplateContext,
    action: z.output<typeof NanoAction>
  ): NanoContractActionHeader {
    const tokens = ctx.tokens.map(t => ({ uid: t, name: '', symbol: '' }));
    const { token } = action;
    let amount: OutputValueType = 0n;

    // Prepare amount
    if (action.action === 'deposit' || action.action === 'withdrawal') {
      // This parse is because action.amount may be a template reference name.
      // The actual amount is discovered when running the instructions and inputed on the action.
      // So this should be a bigint, but if it is not (for any reason) we would throw an error.
      amount = z.bigint().parse(action.amount);
    }
    if (action.action === 'grant_authority' || action.action === 'acquire_authority') {
      if (action.authority === 'mint') {
        amount += TOKEN_MINT_MASK;
      }
      if (action.authority === 'melt') {
        amount += TOKEN_MELT_MASK;
      }
    }
    if (amount === 0n) {
      throw new Error('Action amount cannot be zero');
    }

    let tokenIndex: number = 0;
    // Prepare tokenIndex
    if (action.action === 'deposit' || action.action === 'grant_authority') {
      tokenIndex = action.useCreatedToken ? 1 : tokensUtils.getTokenIndex(tokens, token);
    }
    if (action.action === 'withdrawal' || action.action === 'acquire_authority') {
      tokenIndex = tokensUtils.getTokenIndex(tokens, token);
    }

    return {
      type: ActionTypeToActionHeaderType[action.action],
      amount,
      tokenIndex,
    };
  }

  async buildNanoHeader(ctx: TxTemplateContext): Promise<NanoContractHeader> {
    const nanoCtx = ctx.nanoContext;
    if (!nanoCtx) {
      throw new Error('Cannot build the header without the nano context data');
    }
    const blueprintId = await this.getBlueprintId(nanoCtx);
    const network = this.getNetwork();
    const address = new Address(nanoCtx.caller, { network });
    try {
      address.validateAddress();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not validate caller address';
      throw new Error(message);
    }
    const args = await validateAndParseBlueprintMethodArgs(
      blueprintId,
      nanoCtx.method,
      nanoCtx.args,
      network
    );

    const arr: Buffer[] = [leb128.encodeUnsigned(args.length)];
    args.forEach(arg => {
      arr.push(arg.field.toBuffer());
    });
    const serializedArgs = Buffer.concat(arr);
    const seqnum = await this.wallet.getNanoHeaderSeqnum(address.base58);
    const nanoHeaderActions = nanoCtx.actions.map(action =>
      WalletTxTemplateInterpreter.mapActionInstructionToAction(ctx, action)
    );

    return new NanoContractHeader(
      nanoCtx.id,
      nanoCtx.method,
      serializedArgs,
      nanoHeaderActions,
      seqnum,
      address,
      null
    );
  }

  async build(
    instructions: z.infer<typeof TransactionTemplate>,
    debug: boolean = false
  ): Promise<TxInstance> {
    const context = new TxTemplateContext(this.wallet.logger, debug);

    for (const ins of TransactionTemplate.parse(instructions)) {
      await runInstruction(this, context, ins);
    }

    const headers: Header[] = [];
    if (context.nanoContext) {
      const nanoHeader = await this.buildNanoHeader(context);
      headers.push(nanoHeader);
    }

    if (context.version === DEFAULT_TX_VERSION) {
      return new Transaction(context.inputs, context.outputs, {
        signalBits: context.signalBits,
        version: context.version,
        tokens: context.tokens,
        headers,
      });
    }
    if (context.version === CREATE_TOKEN_TX_VERSION) {
      if (!context.tokenName || !context.tokenSymbol) {
        throw new Error('Cannot create a token without a name or symbol');
      }
      if (!context.tokenVersion) {
        throw new Error('Cannot create a token without a token version');
      }
      return new CreateTokenTransaction(
        context.tokenName,
        context.tokenSymbol,
        context.inputs,
        context.outputs,
        { signalBits: context.signalBits, headers }
      );
    }
    throw new Error('Unsupported Version byte provided');
  }

  async buildAndSign(
    instructions: z.infer<typeof TransactionTemplate>,
    pinCode: string,
    debug: boolean = false
  ): Promise<TxInstance> {
    let tx = await this.build(instructions, debug);
    tx = await transactionUtils.signTransaction(tx, this.wallet.storage, pinCode);
    tx.prepareToSend();
    return tx;
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

  async getTx(txId: string): Promise<IHistoryTx> {
    if (this.txCache[txId]) {
      return this.txCache[txId];
    }

    const histtx = await this.wallet.getTx(txId);
    if (histtx) {
      this.txCache[txId] = histtx as IHistoryTx;
      return this.txCache[txId];
    }

    const resp = (await this.wallet.getFullTxById(txId)) as FullNodeTxApiResponse;
    // We can assume the wallet handles any network errors
    const normalizedTx = transactionUtils.convertFullNodeTxToHistoryTx(resp);
    this.txCache[txId] = normalizedTx;
    return this.txCache[txId];
  }

  getNetwork(): Network {
    return this.wallet.getNetworkObject();
  }

  getWallet(): IHathorWallet {
    return this.wallet;
  }

  getHTRDeposit(mintAmount: OutputValueType): OutputValueType {
    return tokensUtils.getMintDeposit(mintAmount, this.wallet.storage);
  }
}

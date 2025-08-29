/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  IAddressInfo,
  IAddressMetadata,
  IHistoryTx,
  IStore,
  IUtxo,
  IUtxoFilterOptions,
} from '../types';
import Transaction from '../models/transaction';
import Input from '../models/input';
import HathorWalletServiceWallet from '../wallet/wallet';
import { FullNodeTxResponse } from '../wallet/types';
import transactionUtils from '../utils/transaction';
import { Storage } from '.';

/**
 * Extended MemoryStore for wallet-service specific data storage.
 */
export class WalletServiceStorage extends Storage {
  public wallet: HathorWalletServiceWallet;

  constructor(store: IStore, wallet: HathorWalletServiceWallet) {
    super(store);

    this.wallet = wallet;
  }

  /**
   * Override: Get address information including BIP32 index from wallet service
   */
  async getAddressInfo(
    address: string
  ): Promise<(IAddressInfo & IAddressMetadata & { seqnum: number }) | null> {
    const addressDetails = await this.wallet.getAddressDetails(address);

    if (!addressDetails) {
      return null;
    }

    return {
      bip32AddressIndex: addressDetails.index,
      base58: addressDetails.address,
      seqnum: addressDetails.seqnum,
      numTransactions: addressDetails.transactions,
      balance: new Map(),
    };
  }

  /**
   * Override: Get transaction signatures using wallet-service compatible method
   */
  async getTxSignatures(tx: Transaction, pinCode: string) {
    const result = await transactionUtils.getSignatureForTx(tx, this, pinCode);
    return result;
  }

  /**
   * Get spent transactions for input signing
   * This is an async generator that yields transaction data for each input
   */
  async *getSpentTxs(inputs: Input[]) {
    const txCache = new Map<string, IHistoryTx | null>();

    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index];

      let tx = txCache.get(input.hash);
      if (tx === undefined) {
        tx = await this.getTx(input.hash);
        txCache.set(input.hash, tx);
      }

      if (tx) {
        yield { tx, input, index };
      }
    }
  }

  /**
   * Get transaction data by fetching from full node and converting format
   */
  async getTx(txId: string) {
    try {
      const fullTxResponse = await this.wallet.getFullTxById(txId);
      const result = this.convertFullNodeToHistoryTx(fullTxResponse);
      return result;
    } catch (error) {
      return null;
    }
  }

  /**
   * Override: Get current address from wallet service API
   * Uses the wallet's getCurrentAddress method which fetches from the API
   */
  async getCurrentAddress(markAsUsed?: boolean): Promise<string> {
    try {
      const currentAddress = await this.wallet.getCurrentAddress({ markAsUsed });

      return currentAddress.address;
    } catch (error) {
      throw new Error('Current address is not loaded');
    }
  }

  /**
   * Get change address for transactions
   * If specific change address provided, use it; otherwise get a new address from wallet
   */
  async getChangeAddress(options: { changeAddress?: string | null } = {}): Promise<string> {
    if (
      options.changeAddress &&
      typeof options.changeAddress === 'string' &&
      options.changeAddress.trim() !== ''
    ) {
      try {
        if (!(await this.wallet.isAddressMine(options.changeAddress))) {
          throw new Error('Change address is not from the wallet');
        }
        return options.changeAddress;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Error checking if address is mine:', error);
      }
    }

    const currentAddr = await this.wallet.getCurrentAddress({ markAsUsed: true });
    return currentAddr.address;
  }

  /**
   * Convert FullNodeTxResponse to IHistoryTx format
   * This bridges the gap between full node API format and wallet storage format
   */
  // eslint-disable-next-line class-methods-use-this
  private convertFullNodeToHistoryTx(fullTxResponse: FullNodeTxResponse): IHistoryTx {
    const { tx, meta } = fullTxResponse;

    return {
      tx_id: tx.hash,
      signalBits: 0,
      version: tx.version,
      weight: tx.weight,
      timestamp: tx.timestamp,
      is_voided: meta.voided_by.length > 0,
      nonce: Number.parseInt(tx.nonce ?? '0', 10),
      inputs: tx.inputs.map(input => ({
        ...input,
        decoded: {
          ...input.decoded,
          type: input.decoded.type ?? undefined,
        },
      })) as IHistoryTx['inputs'],
      outputs: tx.outputs.map(output => ({
        ...output,
        decoded: {
          ...output.decoded,
          type: output.decoded.type ?? undefined,
        },
      })) as IHistoryTx['outputs'],
      parents: tx.parents,
      tokens: tx.tokens.map(token => token.uid),
      height: meta.height,
      first_block: meta.first_block,
      token_name: tx.token_name ?? undefined,
      token_symbol: tx.token_symbol ?? undefined,
    };
  }

  async *selectUtxos(
    options: Omit<IUtxoFilterOptions, 'reward_lock'> = {}
  ): AsyncGenerator<IUtxo, void, void> {
    const filterSelected = (utxo: IUtxo): boolean => {
      const utxoId = `${utxo.txId}:${utxo.index}`;
      return !this.utxosSelectedAsInput.has(utxoId);
    };
    const newFilter = (utxo: IUtxo): boolean => {
      const optionsFilter = options.filter_method ? options.filter_method(utxo) : true;
      const selectedFilter = filterSelected(utxo);
      if (options.only_available_utxos) {
        // We need to check if the utxo is selected as an input since we only want available utxos.
        return selectedFilter && optionsFilter;
      }
      // Only check the filter method if we don't care about available utxos.
      return optionsFilter;
    };

    const newOptions: IUtxoFilterOptions = {
      ...options,
      filter_method: newFilter,
    };
    if (this.version?.reward_spend_min_blocks) {
      newOptions.reward_lock = this.version.reward_spend_min_blocks;
    }
    for await (const utxo of this.store.selectUtxos(newOptions)) {
      yield utxo;
    }
  }

  /**
   * Wallet-service compatible UTXO selection algorithm
   * This replaces bestUtxoSelection which requires storage.selectUtxos
   */
  public async walletServiceUtxoSelection(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _storage: unknown,
    token: string,
    amount: bigint
  ) {
    try {
      const { utxos } = await this.wallet.getUtxosForAmount(amount, {
        tokenId: token,
      });

      const convertedUtxos: IUtxo[] = utxos.map(utxo => ({
        txId: utxo.txId,
        index: utxo.index,
        token: utxo.tokenId,
        address: utxo.address,
        value: utxo.value,
        authorities: utxo.authorities,
        timelock: utxo.timelock,
        type: 1,
        height: null,
      }));

      const totalAmount = convertedUtxos.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);

      return {
        utxos: convertedUtxos,
        amount: totalAmount,
        available: totalAmount,
      };
    } catch (error) {
      // If getUtxosForAmount fails, try to get available UTXOs using the newer method
      const utxosResult = await this.wallet.getUtxos({
        token,
        only_available_utxos: true,
        max_amount: Number(amount), // Convert bigint to number for API
      });

      const convertedUtxos: IUtxo[] = utxosResult.utxos.map(utxo => ({
        txId: utxo.tx_id,
        index: utxo.index,
        token,
        address: utxo.address,
        value: utxo.amount,
        authorities: 0n, // Regular UTXOs don't have authorities
        timelock: null,
        type: 1,
        height: null,
      }));

      return {
        utxos: convertedUtxos,
        amount: utxosResult.total_amount_available,
        available: utxosResult.total_amount_available,
      };
    }
  }
}

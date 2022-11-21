/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Input from 'src/models/input';
import Transaction from 'src/models/transaction';
import {
  IStorage,
  IStorageAddress,
  IStorageToken,
  IStorageTokenMetadata,
  IStorageTx,
  IStorageUTXO,
  IStorageWalletData,
  IStore,
  IUtxoFilterOptions, 
} from '../types';

export class Store implements IStore {
  storage: IStorage;
  utxosSelectedAsInput: Map<string, IStorageUTXO>;

  constructor(storage: IStorage) {
    this.storage = storage;
    this.utxosSelectedAsInput = new Map<string, IStorageUTXO>();
  }

  async *getAllAddresses(): AsyncGenerator<IStorageAddress> {
    for await (const address of this.storage.addressIter()) {
      yield address;
    }
  }

  async getAddressInfo(base58: string): Promise<IStorageAddress|null> {
    return this.storage.getAddress(base58);
  }

  async getAddressAtIndex(index: number): Promise<IStorageAddress> {
    return this.storage.getAddressAtIndex(index);
  }

  async isAddressMine(base58: string): Promise<boolean> {
    return this.storage.addressExists(base58);
  }

  async saveAddress(info: IStorageAddress): Promise<void> {
    await this.storage.saveAddress(info);
  }

  async *txHistory(): AsyncGenerator<IStorageTx> {
    for await (const tx of this.storage.historyIter()) {
      yield tx;
    }
  }

  async *tokenHistory(tokenUid?: string): AsyncGenerator<IStorageTx> {
    for await (const tx of this.storage.historyIter(tokenUid || '00')) {
      yield tx;
    }
  }

  async getTx(txId: string): Promise<IStorageTx|null> {
    return this.storage.getTx(txId);
  }

  // XXX: also return referenced input?
  async *getSpentTxs(inputs: Input[]): AsyncGenerator<IStorageTx> {
    for await (const input of inputs) {
      const tx = this.getTx(input.hash);
      if (tx !== null) continue;
      yield tx;
    }
  }

  async addTx(tx: IStorageTx): Promise<void> {
    const storageTx = this.getTx(tx.tx_id);
    if (storageTx !== null) {
      // This is a new transaction
      this.storage.saveTx(tx);
      // TODO
      // save each new utxo
      // check inputs to delete utxos as they were spent
      // calculate balance change for each token and address
      // update address and token metadata
    } else {
      // this is an updated transaction
      this.storage.saveTx(tx);
      // TODO
      // check if any utxos are spent
      // check if the tx has been voided
      // update token balances and address metadata
    }
  }

  async addToken(data: IStorageToken): Promise<void> {
    await this.storage.saveToken(data); 
  }

  async editToken(tokenUid: string, meta: IStorageTokenMetadata): Promise<void> {
    this.storage.editToken(tokenUid, meta);
  }

  async *getAllTokens(): AsyncGenerator<IStorageToken & Partial<IStorageTokenMetadata>> {
    for await (const token of this.storage.tokenIter()) {
      yield token;
    }
  }

  async *getRegisteredTokens(): AsyncGenerator<IStorageToken & Partial<IStorageTokenMetadata>> {    
    for await (const token of this.storage.registeredTokenIter()) {
      yield token;
    }
  }

  async getToken(token?: string): Promise<(IStorageToken & Partial<IStorageTokenMetadata>)|null> {
    return this.storage.getToken(token || '00');
  }

  async registerToken(token: IStorageToken): Promise<void> {
    await this.storage.registerToken(token);
  }

  async unregisterToken(tokenUid: string): Promise<void> {
    await this.storage.unregisterToken(tokenUid);
  }

  async *getAllUtxos(): AsyncGenerator<IStorageUTXO, any, unknown> {
    for await (const utxo of this.storage.utxoIter()) {
      yield utxo;
    }
  }

  async *selectUtxos(options: IUtxoFilterOptions): AsyncGenerator<IStorageUTXO, any, unknown> {
    yield *this.storage.selectUtxos(options);    
  }

  async fillTx(tx: Transaction): Promise<void> {
    function getDefaultAuthorityBalance(): Record<'mint'|'melt', number> {
      return {'mint': 0, 'melt': 0};
    }
    const tokenAmountOutputs = new Map<string, number>();
    const tokenAuthorityOutputs = new Map<string, Record<'mint'|'melt', number>>();

    for (const output of tx.outputs) {
      const token = tx.tokens[output.getTokenIndex()];
      if (output.isAuthority()) {
        // Authority output, add to mint or melt balance
        const balance = tokenAuthorityOutputs.get(token) || getDefaultAuthorityBalance();
        if (output.isMint()) {
          balance.mint += 1;
        }
        if (output.isMelt()) {
          balance.melt += 1;
        }
        tokenAuthorityOutputs.set(token, balance);
      } else {
        // Fund output, add to the amount balance
        tokenAmountOutputs.set(token, (tokenAmountOutputs.get(token) || 0) + output.value);
      }
    }

    const tokenAmountInputs = new Map<string, number>();
    const tokenAuthorityInputs = new Map<string, Record<'mint'|'melt', number>>();

    // Check the inputs
    for (const input of tx.inputs) {
      // await this.getSpentTxs()
      // TODO
      // - if an input has a token that is not on the outputs, we should fail
      // - if the input balance is more than the output for a token or authority, we should fail
    }

    // TODO: use this.selectUtxos to find the utxos for the missing balance and authorities
  }

  utxoSelectAsInput(utxo: IStorageUTXO, markAs: boolean, ttl?: number): void {
    const utxoId = `${utxo.txId}:${utxo.index}`;
    if (markAs) {
      this.utxosSelectedAsInput[utxoId] = markAs;
      // if a ttl is given, we should reverse
      if (ttl) {
        setTimeout(() => {
          if (!markAs) {
            delete this.utxosSelectedAsInput[utxoId];
          }
        }, ttl);
      }
    } else {
      delete this.utxosSelectedAsInput[utxoId];
    }
  }

  async getAccessData(): Promise<IStorageWalletData|null> {
    return this.storage.getAccessData();
  }

  async saveAccessData(data: IStorageWalletData): Promise<void> {
    return this.storage.saveAccessData(data);
  }
}
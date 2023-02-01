/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import {
  IHathorWallet,
  OutputRequestObj,
  InputRequestObj,
  IStopWalletParams,
  DelegateAuthorityOptions,
  DestroyAuthorityOptions,
  WsTransaction,
  ConnectionState,
} from '../wallet/types';
import CreateTokenTransaction from '../models/create_token_transaction';
import SendTransactionWalletService from '../wallet/sendTransactionWalletService';
import Transaction from '../models/transaction';

class FakeHathorWallet extends EventEmitter implements IHathorWallet {
  async start(options: { pinCode: string, password: string }) {
    return Promise.resolve();
  }

  async* getAllAddresses() {
  }

  getBalance(token: string | null) {
    return Promise.resolve([]);
  }

  getTokens() {
    return Promise.resolve([]);
  }

  getTxHistory(options: { token_id?: string, count?: number, skip?: number }) {
    return Promise.resolve([]);
  }

  sendManyOutputsTransaction(
    outputs: OutputRequestObj[],
    options: {
      inputs?: InputRequestObj[],
      changeAddress?: string,
    }
  ) {
    return Promise.resolve(new Transaction([], []));
  }

  sendTransaction(
    address: string,
    value: number,
    options: {
      token?: string,
      changeAddress?: string,
    }
  ) {
    return Promise.resolve(new SendTransactionWalletService(this));
  }

  stop(params?: IStopWalletParams) {}

  getAddressAtIndex(index: number) {
    return '';
  }

  getCurrentAddress({ markAsUsed: boolean }) {
    return {
      address: '',
      index: 0,
      addressPath: '',
      info: '',
    };
  }

  getNextAddress() {
    return {
      address: '',
      index: 0,
      addressPath: '',
      info: '',
    };
  }

  prepareCreateNewToken(name: string, symbol: string, amount: number, options) {
    return Promise.resolve(new CreateTokenTransaction('00', 'HTR', [], []));
  }

  createNewToken(name: string, symbol: string, amount: number, options) {
    return Promise.resolve(new Transaction([], []));
  }

  createNFT(name: string, symbol: string, amount: number, data: string, options) {
    return Promise.resolve(new Transaction([], []));
  }

  prepareMintTokensData(token: string, amount: number, options) {
    return Promise.resolve(new Transaction([], []));
  }

  mintTokens(token: string, amount: number, options) {
    return Promise.resolve(new Transaction([], []));
  }

  prepareMeltTokensData(token: string, amount: number, options) {
    return Promise.resolve(new Transaction([], []));
  }

  meltTokens(token: string, amount: number, options) {
    return Promise.resolve(new Transaction([], []));
  }

  prepareDelegateAuthorityData(
    token: string,
    type: string,
    address: string,
    options: DelegateAuthorityOptions,
  ) {
    return Promise.resolve(new Transaction([], []));
  }

  delegateAuthority(
    token: string,
    type: string,
    address: string,
    options: DelegateAuthorityOptions,
  ) {
    return Promise.resolve(new Transaction([], []));
  }

  prepareDestroyAuthorityData(
    token: string,
    type: string,
    count: number,
    options: DestroyAuthorityOptions,
  ) {
    return Promise.resolve(new Transaction([], []));
  }

  destroyAuthority(
    token: string,
    type: string,
    count: number,
    options: DestroyAuthorityOptions,
  ) {
    return Promise.resolve(new Transaction([], []));
  }

  getFullHistory() {
    return [];
  }

  getTxBalance(tx: WsTransaction, optionsParams) {
    return Promise.resolve({});
  }

  onConnectionChangedState(newState: ConnectionState) {

  }

  getTokenDetails(tokenId: string) {
    return Promise.resolve({
      tokenInfo: {
        id: tokenId,
        name: '',
        symbol: '',
      },
      totalSupply: 0,
      totalTransactions: 0,
      authorities: {
        mint: false,
        melt: false,
      }
    });
  }

  getVersionData() {
    return Promise.resolve({
      timestamp: 0,
      version: '',
      network: 'mainnet',
      minWeight: 0,
      minTxWeight: 0,
      minTxWeightCoefficient: 0,
      minTxWeightK: 0,
      tokenDepositPercentage: 0,
      rewardSpendMinBlocks: 0,
      maxNumberInputs: 0,
      maxNumberOutputs: 0,
    });
  }

  checkAddressesMine(addresses: string[]) {
    return Promise.resolve({});
  }

  getFullTxById(
    txId: string,
  ) {
    return Promise.resolve({
      tx: {
        hash: '',
        nonce: '',
        timestamp: 0,
        version: 0,
        weight: 0,
        parents: [],
        inputs: [],
        outputs: [],
        tokens: [],
        raw: '',
      },
      meta: {
        hash: '',
        spent_outputs: [],
        received_by: [],
        children: [],
        conflict_with: [],
        voided_by: [],
        twins: [],
        accumulated_weight: 0,
        score: 0,
        height: 0,
      },
      success: true,
    });
  }

  getTxConfirmationData(
    txId: string,
  ) {
    return Promise.resolve({
      success: true,
      accumulated_weight: 0,
      accumulated_bigger: true,
      stop_value: 0,
      confirmation_level: 0,
    });
  }

  graphvizNeighborsQuery(
    txId: string,
    graphType: string,
    maxLevel: number,
  ) {
    return Promise.resolve('');
  }
}

export default FakeHathorWallet;

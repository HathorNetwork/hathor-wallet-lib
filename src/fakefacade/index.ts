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
  AddressInfoObject,
  GetBalanceObject,
  GetHistoryObject,
  ConnectionState,
} from '../wallet/types';
import CreateTokenTransaction from '../models/create_token_transaction';
import Transaction from '../models/transaction';

class FakeHathorWallet extends EventEmitter implements IHathorWallet {
  private state = 'Not started';

  private newAddresses: AddressInfoObject[] = [];

  private tokenBalances: {[tokenId: string]: GetBalanceObject} = {};

  private tokenHistory: {[tokenId: string]: GetHistoryObject[]} = {};

  private tokens: string[] = [];

  public conn: EventEmitter = new EventEmitter();

  isReady() {
    return this.state === 'Ready';
  }

  setAddresses(addresses: AddressInfoObject[]) {
    this.newAddresses = addresses;
  }

  setTokens(tokens: string[]) {
    this.tokens = tokens;
  }

  setTokenHistory(tokenId: string, history: GetHistoryObject[]) {
    this.tokenHistory[tokenId] = history;
  }

  setTokenBalance(tokenId: string, balance: GetBalanceObject) {
    this.tokenBalances[tokenId] = balance;
  }

  setState(state: string) {
    this.state = state;
    this.emit('state', state);
  }

  async start() {
    await new Promise(resolve => {
      setTimeout(resolve, 1500);
    });
    this.setState('Ready');

    this.conn.emit('state', ConnectionState.CONNECTED);
    return Promise.resolve();
  }

  async* getAllAddresses() {
    for (const address of this.newAddresses) {
      yield {
        address: address.address,
        index: address.index,
        transactions: 0,
      };
    }
  }

  getBalance(token: string | null) {
    return Promise.resolve([this.tokenBalances[token || '00']]);
  }

  getTokens() {
    return Promise.resolve(this.tokens);
  }

  getTxHistory(options: { token_id?: string, count?: number, skip?: number }) {
    const tokenId = options.token_id || '00';
    const skip = options.skip;
    const count = options.count;

    return Promise.resolve(this.tokenHistory[tokenId].slice(skip, count));
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
    return Promise.resolve(new Transaction([], []));
  }

  stop(params?: IStopWalletParams) {}

  getAddressAtIndex(index: number) {
    return '';
  }

  getCurrentAddress() {
    return {
      address: '',
      index: 0,
      addressPath: '',
      info: '',
    };
  }

  async getNextAddress() {
    return Promise.resolve(this.newAddresses[Math.floor(Math.random() * this.newAddresses.length)]);
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

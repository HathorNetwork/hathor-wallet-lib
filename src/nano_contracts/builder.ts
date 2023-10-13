/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Output from '../models/output';
import P2PKH from '../models/p2pkh';
import Input from '../models/input';
import Address from '../models/address';
import NanoContract from './nano_contract';
import { hexToBuffer } from '../utils/buffer';
import { HATHOR_TOKEN_CONFIG } from '../constants';
import Serializer from './serializer';
import { HDPrivateKey } from 'bitcore-lib';
import HathorWallet from '../new/wallet';
import { NanoContractTransactionError } from '../errors';
import { concat } from 'lodash'
import {
  NanoContractActionType,
  NanoContractAction,
  NanoContractActionDeposit,
  NanoContractActionWithdrawal,
  NanoContractDepositData,
  NanoContractWithdrawalData,
  NanoContractArg
} from './types';


class NanoContractTransactionBuilder {
  // blueprint ID for initialize, nano contract ID for the other methods
  id: string | null;
  method: string | null;
  actions: NanoContractAction[] | null;
  caller: HDPrivateKey | null;
  args: NanoContractArg[] | null;
  transaction: NanoContract | null;
  wallet: HathorWallet | null;

  constructor() {
    this.id = null;
    this.method = null;
    this.actions = null;
    this.caller = null;
    this.args = null;
    this.transaction = null;
    this.wallet = null;
  }

  setMethod(method: string) {
    this.method = method;
  }

  setActions(actions: NanoContractAction[]) {
    // Check if there's only one action for each token
    if (actions) {
      const tokens = actions.map(action => action.token);
      const tokensSet = new Set(tokens);
      if (tokens.length !== tokensSet.size) {
        throw new Error('More than one action per token is not allowed.');
      }
    }

    this.actions = actions;
  }

  setArgs(args: NanoContractArg[]) {
    this.args = args;
  }

  setCaller(caller: HDPrivateKey) {
    this.caller = caller;
  }

  setId(id: string) {
    this.id = id;
  }

  setWallet(wallet: HathorWallet) {
    this.wallet = wallet;
  }

  async executeDeposit(action: NanoContractActionDeposit, tokens: string[]): Promise<[Input[], Output[]]> {
    // Get the utxos with the amount of the bet and create the inputs
    const utxosData = await this.wallet.getUtxosForAmount(action.data.amount, { token: action.token });
    const inputs: Input[] = [];
    for (const utxo of utxosData.utxos) {
      inputs.push(new Input(utxo.txId, utxo.index));
    }

    const outputs: Output[] = [];
    const network = this.wallet.getNetworkObject();
    // If there's a change amount left in the utxos, create the change output
    if (utxosData.changeAmount) {
      const changeAddressParam = action.data.changeAddress;
      if (changeAddressParam && !this.wallet.isAddressMine(changeAddressParam)) {
        throw new NanoContractTransactionError('Change address must belong to the same wallet.');
      }

      const changeAddressStr = changeAddressParam || (await this.wallet.getCurrentAddress()).address;
      const changeAddress = new Address(changeAddressStr, { network });
      // This will throw AddressError in case the adress is invalid
      changeAddress.validateAddress();
      const p2pkh = new P2PKH(changeAddress);
      const p2pkhScript = p2pkh.createScript()
      const tokenIndex = action.token === HATHOR_TOKEN_CONFIG.uid ? 0 : tokens.findIndex((token) => token === action.token) + 1;
      const outputObj = new Output(
        utxosData.changeAmount,
        p2pkhScript,
        {
          tokenData: tokenIndex
        }
      );
      outputs.push(outputObj);
    }

    return [inputs, outputs];
  }

  executeWithdrawal(action: NanoContractActionWithdrawal, tokens: string[]): Output {
    // Create the output with the withdrawal address and amount
    const addressObj = new Address(action.data.address, { network: this.wallet.getNetworkObject() });
    const p2pkh = new P2PKH(addressObj);
    const p2pkhScript = p2pkh.createScript()
    const tokenIndex = action.token === HATHOR_TOKEN_CONFIG.uid ? 0 : tokens.findIndex((token) => token === action.token) + 1;
    const output = new Output(
      action.data.amount,
      p2pkhScript,
      {
        tokenData: tokenIndex
      }
    );

    return output;
  }

  async build(): Promise<NanoContract> {
    if (this.id === null || this.method === null || this.caller === null) {
      throw new Error('Must have id, method and caller.');
    }

    let inputs: Input[] = [];
    let outputs: Output[] = [];
    let tokens: string[] = [];
    if (this.actions) {
      const tokenSet = new Set<string>();
      for (const action of this.actions) {
        // Get token list
        if (action.token !== HATHOR_TOKEN_CONFIG.uid) {
          tokenSet.add(action.token);
        }
      }
      tokens = Array.from(tokenSet);
      for (const action of this.actions) {
        // Call action
        if (action.type === NanoContractActionType.DEPOSIT) {
          const ret = await this.executeDeposit(action, tokens);
          inputs = concat(inputs, ret[0]);
          outputs = concat(outputs, ret[1]);
        } else if (action.type === NanoContractActionType.WITHDRAWAL) {
          const output = this.executeWithdrawal(action, tokens);
          outputs = concat(outputs, output);
        } else {
          throw new Error('Invalid type for nano contract action.');
        }
      }
    }

    const serializedArgs: Buffer[] = [];
    if (this.args) {
      const serializer = new Serializer();
      for (const arg of this.args) {
        let serialized: Buffer;
        if (arg.type === 'SignedData') {
          const splittedValue = arg.value.split(',');
          if (splittedValue.length !== 3) {
            throw new Error('Signed data requires 3 parameters.');
          }
          // First value must be a Buffer but comes as hex
          splittedValue[0] = hexToBuffer(splittedValue[0]);
          const tupleValues: [Buffer, any, string] = splittedValue;
          serialized = serializer.fromSigned(...tupleValues);
        } else {
          serialized = serializer.serializeFromType(arg.value, arg.type);
        }
        serializedArgs.push(serialized);
      }
    }

    const nc = new NanoContract(inputs, outputs, tokens, this.id, this.method, serializedArgs, this.caller.publicKey.toBuffer(), null);
    return nc;
  }
}

export default NanoContractTransactionBuilder;
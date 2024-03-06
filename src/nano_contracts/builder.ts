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
import transactionUtils from '../utils/transaction';
import { IDataOutput } from '../types';
import { HATHOR_TOKEN_CONFIG } from '../constants';
import Serializer from './serializer';
import { HDPrivateKey } from 'bitcore-lib';
import HathorWallet from '../new/wallet';
import { NanoContractTransactionError } from '../errors';
import { concat, get } from 'lodash'
import {
  NanoContractActionType,
  NanoContractAction,
  MethodArgInfo,
} from './types';
import ncApi from '../api/nano';


class NanoContractTransactionBuilder {
  blueprintId: string | null;
  // nano contract ID, null if initialize
  ncId: string | null;
  method: string | null;
  actions: NanoContractAction[] | null;
  caller: HDPrivateKey | null;
  args: any[] | null;
  transaction: NanoContract | null;
  wallet: HathorWallet | null;

  constructor() {
    this.blueprintId = null;
    this.ncId = null;
    this.method = null;
    this.actions = null;
    this.caller = null;
    this.args = null;
    this.transaction = null;
    this.wallet = null;
  }

  /**
   * Set object method attribute
   *
   * @param {method} Method name
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setMethod(method: string) {
    this.method = method;
  }

  /**
   * Set object actions attribute
   *
   * @param {actions} List of actions
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
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

  /**
   * Set object args attribute
   *
   * @param {args} List of arguments
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setArgs(args: any[]) {
    this.args = args;
  }

  /**
   * Set object caller attribute
   *
   * @param {caller} Caller private key
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setCaller(caller: HDPrivateKey) {
    this.caller = caller;
  }

  /**
   * Set object blueprintId attribute
   *
   * @param {blueprintId} Blueprint id
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setBlueprintId(blueprintId: string) {
    this.blueprintId = blueprintId;
  }

  /**
   * Set object ncId attribute
   *
   * @param {ncId} Nano contract id
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setNcId(ncId: string) {
    this.ncId = ncId;
  }

  /**
   * Set object wallet attribute
   *
   * @param {wallet} Wallet object building this transaction
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setWallet(wallet: HathorWallet) {
    this.wallet = wallet;
  }

  /**
   * Execute a deposit action
   * Create inputs (and maybe change outputs) to complete the deposit
   *
   * @param {action} Action to be completed (must be a deposit type)
   * @param {tokens} Array of tokens to get the token data correctly
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  async executeDeposit(action: NanoContractAction, tokens: string[]): Promise<[Input[], Output[]]> {
    if (action.type !== NanoContractActionType.DEPOSIT) {
      throw new NanoContractTransactionError('Can\'t execute a deposit with an action which type is differente than deposit.');
    }

    if (!action.amount || !action.token) {
      throw new NanoContractTransactionError('Amount and token are required for deposit action.');
    }

    const changeAddressParam = action.changeAddress;
    if (changeAddressParam && !(await this.wallet.isAddressMine(changeAddressParam))) {
      throw new NanoContractTransactionError('Change address must belong to the same wallet.');
    }

    // Get the utxos with the amount of the deposit and create the inputs
    const utxoOptions: { token: string, filter_address?: string | null } = { token: action.token };
    if (action.address) {
      utxoOptions.filter_address = action.address;
    }
    const utxosData = await this.wallet.getUtxosForAmount(action.amount, utxoOptions);
    const inputs: Input[] = [];
    for (const utxo of utxosData.utxos) {
      inputs.push(new Input(utxo.txId, utxo.index));
    }

    const outputs: Output[] = [];
    const network = this.wallet.getNetworkObject();
    // If there's a change amount left in the utxos, create the change output
    if (utxosData.changeAmount) {
      const changeAddressStr = changeAddressParam || (await this.wallet.getCurrentAddress()).address;
      const outputData = {
        address: changeAddressStr
      } as IDataOutput
      // This will throw AddressError in case the adress is invalid
      // this handles p2pkh and p2sh scripts
      const outputScript = transactionUtils.createOutputScript(outputData, network);
      const tokenIndex = action.token === HATHOR_TOKEN_CONFIG.uid ? 0 : tokens.findIndex((token) => token === action.token) + 1;
      const outputObj = new Output(
        utxosData.changeAmount,
        outputScript,
        {
          tokenData: tokenIndex
        }
      );
      outputs.push(outputObj);
    }

    return [inputs, outputs];
  }

  /**
   * Execute a withdrawal action
   * Create outputs to complete the withdrawal
   *
   * @param {action} Action to be completed (must be a withdrawal type)
   * @param {tokens} Array of tokens to get the token data correctly
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  executeWithdrawal(action: NanoContractAction, tokens: string[]): Output {
    if (action.type !== NanoContractActionType.WITHDRAWAL) {
      throw new NanoContractTransactionError('Can\'t execute a withdrawal with an action which type is differente than withdrawal.');
    }

    if (!action.address || !action.amount || !action.token) {
      throw new NanoContractTransactionError('Address, amount and token are required for withdrawal action.');
    }

    // Create the output with the withdrawal address and amount
    const addressObj = new Address(action.address, { network: this.wallet.getNetworkObject() });
    const p2pkh = new P2PKH(addressObj);
    const p2pkhScript = p2pkh.createScript()
    const tokenIndex = action.token === HATHOR_TOKEN_CONFIG.uid ? 0 : tokens.findIndex((token) => token === action.token) + 1;
    const output = new Output(
      action.amount,
      p2pkhScript,
      {
        tokenData: tokenIndex
      }
    );

    return output;
  }

  /**
   * Build the nano contract transaction
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  async build(): Promise<NanoContract> {
    if (this.blueprintId === null || this.method === null || this.caller === null) {
      throw new Error('Must have blueprint id, method and caller.');
    }

    if (this.method !== 'initialize' && this.ncId === null) {
      throw new Error(`Nano contract ID cannot be null for method ${this.method}`);
    }

    // Transform actions into inputs and outputs
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

    // Serialize the method arguments
    const serializedArgs: Buffer[] = [];
    if (this.args) {
      const serializer = new Serializer();
      const blueprintInformation = await ncApi.getBlueprintInformation(this.blueprintId);
      const methodArgs = get(blueprintInformation, `public_methods.${this.method}.args`, []) as MethodArgInfo[];
      if (!methodArgs) {
        throw new NanoContractTransactionError(`Blueprint does not have method ${this.method}.`);
      }

      if (this.args.length !== methodArgs.length) {
        throw new NanoContractTransactionError(`Method needs ${methodArgs.length} parameters but data has ${this.args.length}.`);
      }

      for (const [index, arg] of methodArgs.entries()) {
        let serialized: Buffer;
        if (arg.type.startsWith('SignedData[')) {
          const splittedValue = this.args[index].split(',');
          if (splittedValue.length !== 3) {
            throw new Error('Signed data requires 3 parameters.');
          }
          // First value must be a Buffer but comes as hex
          splittedValue[0] = hexToBuffer(splittedValue[0]);
          const tupleValues: [Buffer, any, string] = splittedValue;
          if (tupleValues[2] === 'bytes') {
            // If the result is expected as bytes, it will come here in the args as hex value
            tupleValues[1] = hexToBuffer(tupleValues[1]);
          }
          serialized = serializer.fromSigned(...tupleValues);
        } else {
          serialized = serializer.serializeFromType(this.args[index], arg.type);
        }
        serializedArgs.push(serialized);
      }
    }

    const ncId = this.method === 'initialize' ? this.blueprintId : this.ncId;

    if (ncId === null) {
      // This was validated in the beginning of the method but the linter was complaining about it
      throw new Error('This should never happen.');
    }

    return new NanoContract(inputs, outputs, tokens, ncId, this.method, serializedArgs, this.caller.publicKey.toBuffer(), null);
  }
}

export default NanoContractTransactionBuilder;
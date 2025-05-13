/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { concat, get } from 'lodash';
import Output from '../models/output';
import Input from '../models/input';
import Transaction from '../models/transaction';
import { createOutputScriptFromAddress } from '../utils/address';
import tokensUtils from '../utils/tokens';
import { NATIVE_TOKEN_UID, NANO_CONTRACTS_INITIALIZE_METHOD } from '../constants';
import Serializer from './serializer';
import HathorWallet from '../new/wallet';
import { NanoContractTransactionError } from '../errors';
import {
  ActionTypeToActionHeaderType,
  NanoContractActionHeader,
  NanoContractActionType,
  NanoContractAction,
  MethodArgInfo,
  NanoContractArgumentApiInputType,
} from './types';
import { ITokenData } from '../types';
import ncApi from '../api/nano';
import { validateAndUpdateBlueprintMethodArgs } from './utils';
import NanoContractHeader from './header';
import leb128 from '../utils/leb128';
import { NanoContractMethodArgument } from './methodArg';

class NanoContractTransactionBuilder {
  blueprintId: string | null | undefined;

  // nano contract ID, null if initialize
  ncId: string | null | undefined;

  method: string | null;

  actions: NanoContractAction[] | null;

  caller: Buffer | null;

  args: NanoContractArgumentApiInputType[] | null;

  transaction: Transaction | null;

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
   * @param method Method name
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setMethod(method: string) {
    this.method = method;
    return this;
  }

  /**
   * Set object actions attribute
   *
   * @param actions List of actions
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
    return this;
  }

  /**
   * Set object args attribute
   *
   * @param args List of arguments
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setArgs(args: NanoContractArgumentApiInputType[]) {
    this.args = args;
    return this;
  }

  /**
   * Set object caller attribute
   *
   * @param caller caller public key
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setCaller(caller: Buffer) {
    this.caller = caller;
    return this;
  }

  /**
   * Set object blueprintId attribute
   *
   * @param blueprintId Blueprint id
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setBlueprintId(blueprintId: string) {
    this.blueprintId = blueprintId;
    return this;
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
    return this;
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
    return this;
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
      throw new NanoContractTransactionError(
        "Can't execute a deposit with an action which type is differente than deposit."
      );
    }

    if (!action.amount || !action.token) {
      throw new NanoContractTransactionError('Amount and token are required for deposit action.');
    }

    const changeAddressParam = action.changeAddress;
    if (changeAddressParam && !(await this.wallet.isAddressMine(changeAddressParam))) {
      throw new NanoContractTransactionError('Change address must belong to the same wallet.');
    }

    // Get the utxos with the amount of the deposit and create the inputs
    const utxoOptions: { token: string; filter_address?: string | null } = { token: action.token };
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
      const changeAddressStr =
        changeAddressParam || (await this.wallet.getCurrentAddress()).address;
      // This will throw AddressError in case the adress is invalid
      // this handles p2pkh and p2sh scripts
      const outputScript = createOutputScriptFromAddress(changeAddressStr, network);
      const tokenIndex =
        action.token === NATIVE_TOKEN_UID
          ? 0
          : tokens.findIndex(token => token === action.token) + 1;
      const outputObj = new Output(utxosData.changeAmount, outputScript, {
        tokenData: tokenIndex,
      });
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
      throw new NanoContractTransactionError(
        "Can't execute a withdrawal with an action which type is differente than withdrawal."
      );
    }

    if (!action.address || !action.amount || !action.token) {
      throw new NanoContractTransactionError(
        'Address, amount and token are required for withdrawal action.'
      );
    }
    // Create the output with the withdrawal address and amount

    // This will throw AddressError in case the adress is invalid
    // this handles p2pkh and p2sh scripts
    const outputScript = createOutputScriptFromAddress(
      action.address,
      this.wallet.getNetworkObject()
    );

    const tokenIndex =
      action.token === NATIVE_TOKEN_UID ? 0 : tokens.findIndex(token => token === action.token) + 1;
    const output = new Output(action.amount, outputScript, {
      tokenData: tokenIndex,
    });

    return output;
  }

  /**
   * Build the nano contract transaction
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  async build(): Promise<Transaction> {
    if (this.method === NANO_CONTRACTS_INITIALIZE_METHOD && !this.blueprintId) {
      // Initialize needs the blueprint ID
      throw new NanoContractTransactionError('Missing blueprint id. Parameter blueprintId in data');
    }

    if (this.method !== NANO_CONTRACTS_INITIALIZE_METHOD) {
      // Get the blueprint id from the nano transaction in the full node
      if (!this.ncId) {
        throw new NanoContractTransactionError(
          `Nano contract ID cannot be null for method ${this.method}`
        );
      }

      let response;
      try {
        response = await this.wallet.getFullTxById(this.ncId);
      } catch {
        // Error getting nano contract transaction data from the full node
        throw new NanoContractTransactionError(
          `Error getting nano contract transaction data with id ${this.ncId} from the full node`
        );
      }

      if (!response.tx.nc_id) {
        throw new NanoContractTransactionError(
          `Transaction with id ${this.ncId} is not a nano contract transaction.`
        );
      }

      this.blueprintId = response.tx.nc_blueprint_id;
    }

    if (!this.blueprintId || !this.method || !this.caller) {
      throw new NanoContractTransactionError('Must have blueprint id, method and caller.');
    }

    // Validate if the arguments match the expected method arguments
    await validateAndUpdateBlueprintMethodArgs(this.blueprintId, this.method, this.args);

    // Transform actions into inputs and outputs
    let inputs: Input[] = [];
    let outputs: Output[] = [];
    let tokens: string[] = [];
    if (this.actions) {
      const tokenSet = new Set<string>();
      for (const action of this.actions) {
        // Get token list
        if (action.token !== NATIVE_TOKEN_UID) {
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
    const serializedArgs: Buffer[] = [leb128.encodeUnsigned(this.args?.length ?? 0)];
    if (this.args) {
      const serializer = new Serializer(this.wallet.getNetworkObject());
      const blueprintInformation = await ncApi.getBlueprintInformation(this.blueprintId);
      const methodArgs = get(
        blueprintInformation,
        `public_methods.${this.method}.args`,
        []
      ) as MethodArgInfo[];
      if (!methodArgs) {
        throw new NanoContractTransactionError(`Blueprint does not have method ${this.method}.`);
      }

      if (this.args.length !== methodArgs.length) {
        throw new NanoContractTransactionError(
          `Method needs ${methodArgs.length} parameters but data has ${this.args.length}.`
        );
      }

      for (const [index, arg] of methodArgs.entries()) {
        const methodArg = NanoContractMethodArgument.fromApiInput(
          arg.name,
          arg.type,
          this.args[index]
        );
        const serialized = methodArg.serialize(serializer);
        serializedArgs.push(serialized);
      }
    }

    const ncId = this.method === NANO_CONTRACTS_INITIALIZE_METHOD ? this.blueprintId : this.ncId;

    if (ncId == null) {
      // This was validated in the beginning of the method but the linter was complaining about it
      throw new Error('This should never happen.');
    }

    const tx = new Transaction(inputs, outputs, { tokens });

    let nanoHeaderActions: NanoContractActionHeader[] = [];

    if (this.actions) {
      nanoHeaderActions = this.actions.map(action => {
        const headerActionType = ActionTypeToActionHeaderType[action.type];

        const mappedTokens: ITokenData[] = tokens.map(token => {
          return {
            uid: token,
            name: '',
            symbol: '',
          };
        });

        return {
          type: headerActionType,
          amount: action.amount,
          tokenIndex: tokensUtils.getTokenIndex(mappedTokens, action.token),
        };
      });
    }

    const nanoHeader = new NanoContractHeader(
      ncId,
      this.method,
      Buffer.concat(serializedArgs),
      nanoHeaderActions,
      this.caller,
      null
    );

    tx.headers.push(nanoHeader);

    return tx;
  }
}

export default NanoContractTransactionBuilder;

/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { concat, get, uniq } from 'lodash';
import Transaction from '../models/transaction';
import CreateTokenTransaction from '../models/create_token_transaction';
import { getAddressType } from '../utils/address';
import tokensUtils from '../utils/tokens';
import transactionUtils from '../utils/transaction';
import {
  DEFAULT_TX_VERSION,
  NATIVE_TOKEN_UID,
  NANO_CONTRACTS_INITIALIZE_METHOD,
} from '../constants';
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
  NanoContractArgumentType,
  NanoContractBuilderCreateTokenOptions,
  NanoContractVertexType,
} from './types';
import { IDataInput, IDataOutput, ITokenData } from '../types';
import ncApi from '../api/nano';
import { validateAndUpdateBlueprintMethodArgs } from './utils';
import NanoContractHeader from './header';

class NanoContractTransactionBuilder {
  blueprintId: string | null | undefined;

  // nano contract ID, null if initialize
  ncId: string | null | undefined;

  method: string | null;

  actions: NanoContractAction[] | null;

  caller: Buffer | null;

  args: NanoContractArgumentType[] | null;

  serializedArgs: Buffer[] | null;

  wallet: HathorWallet | null;

  // So far we support Transaction or CreateTokenTransaction
  vertexType: NanoContractVertexType | null;

  // In case of a CreateTokenTransaction, these are the options
  // for the tx creation used by the tokens utils method
  createTokenOptions: NanoContractBuilderCreateTokenOptions | null;

  constructor() {
    this.blueprintId = null;
    this.ncId = null;
    this.method = null;
    this.actions = null;
    this.caller = null;
    this.args = null;
    this.serializedArgs = null;
    this.wallet = null;
    this.vertexType = null;
    this.createTokenOptions = null;
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
   * Set vertex type
   *
   * @param {vertexType} The vertex type
   * @param {createTokenOptions} Options for the token creation tx
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setVertexType(
    vertexType: NanoContractVertexType,
    createTokenOptions: NanoContractBuilderCreateTokenOptions | null = null
  ) {
    this.vertexType = vertexType;
    this.createTokenOptions = createTokenOptions;
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
  async executeDeposit(
    action: NanoContractAction,
    tokens: string[]
  ): Promise<[IDataInput[], IDataOutput[]]> {
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
    // XXX What if I don't have enough funds? Validate it!
    const inputs: IDataInput[] = [];
    for (const utxo of utxosData.utxos) {
      inputs.push({
        txId: utxo.txId,
        index: utxo.index,
        value: utxo.value,
        authorities: utxo.authorities,
        token: utxo.tokenId,
        address: utxo.address,
      });
    }

    const outputs: IDataOutput[] = [];
    // If there's a change amount left in the utxos, create the change output
    if (utxosData.changeAmount) {
      const changeAddressStr =
        changeAddressParam || (await this.wallet.getCurrentAddress()).address;
      outputs.push({
        type: getAddressType(changeAddressStr, this.wallet.getNetworkObject()),
        address: changeAddressStr,
        value: utxosData.changeAmount,
        timelock: null,
        token: action.token,
        authorities: 0n,
        isChange: true,
      });
    }

    return [inputs, outputs];
  }

  /**
   * Execute a withdrawal action
   * Create outputs to complete the withdrawal
   * If the transaction is a token creation and
   * the contract will pay for the deposit fee,
   * then creates the output only of the difference
   *
   * @param {action} Action to be completed (must be a withdrawal type)
   * @param {tokens} Array of tokens to get the token data correctly
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  executeWithdrawal(action: NanoContractAction, tokens: string[]): IDataOutput | null {
    if (action.type !== NanoContractActionType.WITHDRAWAL) {
      throw new NanoContractTransactionError(
        "Can't execute a withdrawal with an action which type is differente than withdrawal."
      );
    }

    if (!action.amount || !action.token) {
      throw new NanoContractTransactionError(
        'Address, amount and token are required for withdrawal action.'
      );
    }

    // If it's a token creation creation tx and the contract is paying the deposit fee, then
    // we must reduce the amount created for the output from the total action amount
    let withdrawalAmount = action.amount;
    if (this.vertexType === NanoContractVertexType.CREATE_TOKEN_TRANSACTION) {
      if (this.createTokenOptions === null) {
        throw new NanoContractTransactionError(
          'For a token creation transaction we must have the options defined.'
        );
      }

      // We pay the deposit in native token uid
      if (this.createTokenOptions.contractPaysTokenDeposit && action.token === NATIVE_TOKEN_UID) {
        const depositPercent = this.wallet.storage.getTokenDepositPercentage();
        const depositAmount = tokensUtils.getDepositAmount(
          this.createTokenOptions.amount,
          depositPercent
        );
        withdrawalAmount -= depositAmount;
      }
    }

    if (withdrawalAmount === 0n) {
      // The whole withdrawal amount was used to pay deposit token fee
      return null;
    }

    if (!action.address) {
      throw new NanoContractTransactionError(
        'Address is required for withdrawal action that creates outputs.'
      );
    }

    // Create the output with the withdrawal address and amount
    return {
      type: getAddressType(action.address, this.wallet.getNetworkObject()),
      address: action.address,
      value: withdrawalAmount,
      timelock: null,
      token: action.token,
      authorities: 0n,
    };
  }

  /**
   * Verify if the builder attributes are valid for the nano build
   *
   * @throws {NanoContractTransactionError} In case the attributes are not valid
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  async verify() {
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
  }

  /**
   * Serialize nano arguments in an array of Buffer
   * and store the serialized data in this.serializedArgs
   *
   * @throws {NanoContractTransactionError} In case the arguments are not valid
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  async serializeArgs() {
    this.serializedArgs = [];
    if (this.args) {
      const serializer = new Serializer();
      const blueprintInformation = await ncApi.getBlueprintInformation(this.blueprintId!);
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
        const serialized = serializer.serializeFromType(this.args[index], arg.type);
        this.serializedArgs.push(serialized);
      }
    }
  }

  /**
   * Build inputs and outputs from nano actions
   *
   * @throws {Error} If a nano action type is invalid
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  async buildInputsOutputs(): Promise<[IDataInput[], IDataOutput[], string[]]> {
    let inputs: IDataInput[] = [];
    let outputs: IDataOutput[] = [];
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
          if (output) {
            outputs = concat(outputs, output);
          }
        } else {
          throw new Error('Invalid type for nano contract action.');
        }
      }
    }

    return [inputs, outputs, tokens];
  }

  /**
   * Build a transaction object from the built inputs/outputs/tokens
   *
   * It will create a Transaction or CreateTokenTransaction, depending on the vertex type
   *
   * @throws {NanoContractTransactionError} In case the create token options is null
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  async buildTransaction(
    inputs: IDataInput[],
    outputs: IDataOutput[],
    tokens: string[]
  ): Promise<Transaction | CreateTokenTransaction> {
    if (this.vertexType === NanoContractVertexType.TRANSACTION) {
      return transactionUtils.createTransactionFromData(
        {
          version: DEFAULT_TX_VERSION,
          inputs,
          outputs,
          tokens,
        },
        this.wallet.getNetworkObject()
      );
    }

    if (this.vertexType === NanoContractVertexType.CREATE_TOKEN_TRANSACTION) {
      if (this.createTokenOptions === null) {
        throw new NanoContractTransactionError(
          'Create token options cannot be null when creating a create token transaction.'
        );
      }

      // It's a token creation transaction
      // then we get the token creation data from the utils method
      // and concatenate the nano actions inputs/outputs/tokens
      const data = await tokensUtils.prepareCreateTokenData(
        this.createTokenOptions.mintAddress,
        this.createTokenOptions.name,
        this.createTokenOptions.symbol,
        this.createTokenOptions.amount,
        this.wallet.storage,
        {
          changeAddress: this.createTokenOptions.changeAddress,
          createMint: this.createTokenOptions.createMint,
          mintAuthorityAddress: this.createTokenOptions.mintAuthorityAddress,
          createMelt: this.createTokenOptions.createMelt,
          meltAuthorityAddress: this.createTokenOptions.meltAuthorityAddress,
          data: this.createTokenOptions.data,
          isCreateNFT: this.createTokenOptions.isCreateNFT,
          skipDepositFee: this.createTokenOptions.contractPaysTokenDeposit,
        }
      );

      data.inputs = concat(data.inputs, inputs);
      data.outputs = concat(data.outputs, outputs);
      data.tokens = uniq(concat(data.tokens, tokens));

      return transactionUtils.createTransactionFromData(data, this.wallet.getNetworkObject());
    }

    throw new NanoContractTransactionError('Invalid vertex type.');
  }

  /**
   * Build a full transaction with nano headers from nano contract data
   *
   * @throws {NanoContractTransactionError} In case the arguments to build the tx are invalid
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  async build(): Promise<Transaction> {
    await this.verify();

    // Transform actions into inputs and outputs
    const [inputs, outputs, tokens] = await this.buildInputsOutputs();

    // Serialize the method arguments
    await this.serializeArgs();

    const ncId = this.method === NANO_CONTRACTS_INITIALIZE_METHOD ? this.blueprintId : this.ncId;

    if (ncId == null) {
      // This was validated in the beginning of the method but the linter was complaining about it
      throw new Error('This should never happen.');
    }

    const tx = await this.buildTransaction(inputs, outputs, tokens);

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
      this.method!,
      this.serializedArgs!,
      nanoHeaderActions,
      this.caller!,
      null
    );

    tx.headers.push(nanoHeader);

    return tx;
  }
}

export default NanoContractTransactionBuilder;

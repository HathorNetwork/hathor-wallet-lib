/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { concat, uniq } from 'lodash';
import Transaction from '../models/transaction';
import CreateTokenTransaction from '../models/create_token_transaction';
import { getAddressType } from '../utils/address';
import tokensUtils from '../utils/tokens';
import transactionUtils from '../utils/transaction';
import {
  DEFAULT_TX_VERSION,
  NATIVE_TOKEN_UID,
  NANO_CONTRACTS_INITIALIZE_METHOD,
  TOKEN_MINT_MASK,
  TOKEN_MELT_MASK,
} from '../constants';
import Serializer from './serializer';
import HathorWallet from '../new/wallet';
import { NanoContractTransactionError, UtxoError } from '../errors';
import {
  NanoContractActionHeader,
  NanoContractActionType,
  NanoContractAction,
  NanoContractArgumentApiInputType,
  NanoContractBuilderCreateTokenOptions,
  NanoContractVertexType,
} from './types';
import { mapActionToActionHeader, validateAndParseBlueprintMethodArgs } from './utils';
import { IDataInput, IDataOutput } from '../types';
import NanoContractHeader from './header';
import Address from '../models/address';
import leb128 from '../utils/leb128';
import { NanoContractMethodArgument } from './methodArg';

class NanoContractTransactionBuilder {
  blueprintId: string | null | undefined;

  // nano contract ID, null if initialize
  ncId: string | null | undefined;

  method: string | null;

  actions: NanoContractAction[] | null;

  caller: Address | null;

  args: NanoContractArgumentApiInputType[] | null;

  parsedArgs: NanoContractMethodArgument[] | null;

  serializedArgs: Buffer | null;

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
    this.parsedArgs = null;
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
  setArgs(args: NanoContractArgumentApiInputType[] | undefined | null) {
    this.args = args ?? [];
    return this;
  }

  /**
   * Set object caller attribute
   *
   * @param caller Caller address
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setCaller(caller: Address) {
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
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  async executeDeposit(
    action: NanoContractAction
  ): Promise<{ inputs: IDataInput[]; outputs: IDataOutput[] }> {
    if (action.type !== NanoContractActionType.DEPOSIT) {
      throw new NanoContractTransactionError(
        "Can't execute a deposit with an action which type is different than deposit."
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

    let utxosData;
    try {
      utxosData = await this.wallet.getUtxosForAmount(action.amount, utxoOptions);
    } catch (e) {
      if (e instanceof UtxoError) {
        throw new NanoContractTransactionError('Not enough utxos to execute the deposit.');
      }

      throw e;
    }
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

    return { inputs, outputs };
  }

  /**
   * Execute a withdrawal action
   * Create outputs to complete the withdrawal
   * If the transaction is a token creation and
   * the contract will pay for the deposit fee,
   * then creates the output only of the difference
   *
   * @param {action} Action to be completed (must be a withdrawal type)
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  executeWithdrawal(action: NanoContractAction): IDataOutput | null {
    if (action.type !== NanoContractActionType.WITHDRAWAL) {
      throw new NanoContractTransactionError(
        "Can't execute a withdrawal with an action which type is different than withdrawal."
      );
    }

    if (!action.amount || !action.token) {
      throw new NanoContractTransactionError(
        'Amount and token are required for withdrawal action.'
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
   * Execute a grant authority action
   * Create inputs (and maybe change output) to complete the action
   *
   * @param {action} Action to be completed (must be a grant authority type)
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  async executeGrantAuthority(
    action: NanoContractAction
  ): Promise<{ inputs: IDataInput[]; outputs: IDataOutput[] }> {
    if (action.type !== NanoContractActionType.GRANT_AUTHORITY) {
      throw new NanoContractTransactionError(
        "Can't execute a grant authority with an action which type is different than grant authority."
      );
    }

    if (!action.authority || !action.token) {
      throw new NanoContractTransactionError(
        'Authority and token are required for grant authority action.'
      );
    }

    const authorityAddressParam = action.authorityAddress;
    if (authorityAddressParam && !(await this.wallet.isAddressMine(authorityAddressParam))) {
      throw new NanoContractTransactionError('Authority address must belong to the same wallet.');
    }

    // Get the utxos with the authority of the action and create the input
    const utxos = await this.wallet.getAuthorityUtxo(action.token, action.authority, {
      many: false,
      only_available_utxos: true,
      filter_address: action.address,
    });

    if (!utxos || utxos.length === 0) {
      throw new NanoContractTransactionError(
        'Not enough authority utxos to execute the grant authority.'
      );
    }

    const inputs: IDataInput[] = [];
    // The method gets only one utxo
    const utxo = utxos[0];
    inputs.push({
      txId: utxo.txId,
      index: utxo.index,
      value: utxo.value,
      authorities: utxo.authorities,
      token: utxo.token,
      address: utxo.address,
    });

    const outputs: IDataOutput[] = [];
    // If there's the authorityAddress param, then we must create another authority output for this address
    if (action.authorityAddress) {
      outputs.push({
        type: getAddressType(action.authorityAddress, this.wallet.getNetworkObject()),
        address: action.authorityAddress,
        value: action.authority === 'mint' ? TOKEN_MINT_MASK : TOKEN_MELT_MASK,
        timelock: null,
        token: action.token,
        authorities: action.authority === 'mint' ? TOKEN_MINT_MASK : TOKEN_MELT_MASK,
      });
    }

    return { inputs, outputs };
  }

  /**
   * Execute an invoke authority action
   *
   * @param {action} Action to be completed (must be an invoke authority type)
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  executeInvokeAuthority(action: NanoContractAction): IDataOutput | null {
    if (action.type !== NanoContractActionType.INVOKE_AUTHORITY) {
      throw new NanoContractTransactionError(
        "Can't execute an invoke authority with an action which type is different than invoke authority."
      );
    }

    if (!action.address || !action.authority || !action.token) {
      throw new NanoContractTransactionError(
        'Address, authority, and token are required for invoke authority action.'
      );
    }

    // Create the output with the authority of the action
    return {
      type: getAddressType(action.address, this.wallet.getNetworkObject()),
      address: action.address,
      value: action.authority === 'mint' ? TOKEN_MINT_MASK : TOKEN_MELT_MASK,
      timelock: null,
      token: action.token,
      authorities: action.authority === 'mint' ? TOKEN_MINT_MASK : TOKEN_MELT_MASK,
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

    try {
      this.caller.validateAddress();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not validate caller address';
      throw new NanoContractTransactionError(message);
    }

    // Validate if the arguments match the expected method arguments
    this.parsedArgs = await validateAndParseBlueprintMethodArgs(
      this.blueprintId,
      this.method,
      this.args
    );
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
    if (!this.parsedArgs) {
      throw new NanoContractTransactionError(
        'Arguments should be parsed and validated before serialization.'
      );
    }
    const serializedArray: Buffer[] = [leb128.encodeUnsigned(this.parsedArgs?.length ?? 0)];
    if (this.args) {
      const serializer = new Serializer(this.wallet.getNetworkObject());

      for (const arg of this.parsedArgs) {
        serializedArray.push(arg.serialize(serializer));
      }
    }
    this.serializedArgs = Buffer.concat(serializedArray);
  }

  /**
   * Build inputs and outputs from nano actions
   *
   * @throws {Error} If a nano action type is invalid
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  async buildInputsOutputs(): Promise<{
    inputs: IDataInput[];
    outputs: IDataOutput[];
    tokens: string[];
  }> {
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
        switch (action.type) {
          case NanoContractActionType.DEPOSIT: {
            const { inputs: depositInputs, outputs: depositOutputs } =
              await this.executeDeposit(action);
            inputs = concat(inputs, depositInputs);
            outputs = concat(outputs, depositOutputs);
            break;
          }
          case NanoContractActionType.WITHDRAWAL: {
            const outputWithdrawal = this.executeWithdrawal(action);
            if (outputWithdrawal) {
              outputs = concat(outputs, outputWithdrawal);
            }
            break;
          }
          case NanoContractActionType.GRANT_AUTHORITY: {
            const { inputs: grantInputs, outputs: grantOutputs } =
              await this.executeGrantAuthority(action);
            inputs = concat(inputs, grantInputs);
            outputs = concat(outputs, grantOutputs);
            break;
          }
          case NanoContractActionType.INVOKE_AUTHORITY: {
            const outputInvoke = this.executeInvokeAuthority(action);
            if (outputInvoke) {
              outputs = concat(outputs, outputInvoke);
            }
            break;
          }
          default:
            throw new Error('Invalid type for nano contract action.');
        }
      }
    }

    return { inputs, outputs, tokens };
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
    const { inputs, outputs, tokens } = await this.buildInputsOutputs();

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
        return mapActionToActionHeader(action, tokens);
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

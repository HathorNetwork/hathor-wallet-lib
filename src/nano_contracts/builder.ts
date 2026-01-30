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
  FEE_PER_OUTPUT,
  NATIVE_TOKEN_UID,
  NANO_CONTRACTS_INITIALIZE_METHOD,
  TOKEN_MINT_MASK,
  TOKEN_MELT_MASK,
} from '../constants';
import HathorWallet from '../new/wallet';
import { NanoContractTransactionError, UtxoError } from '../errors';
import {
  NanoContractActionHeader,
  NanoContractActionType,
  NanoContractAction,
  NanoContractBuilderCreateTokenOptions,
  NanoContractVertexType,
  INanoContractActionSchema,
  IArgumentField,
} from './types';
import {
  getBlueprintId,
  mapActionToActionHeader,
  validateAndParseBlueprintMethodArgs,
} from './utils';
import {
  AuthorityType,
  IDataInput,
  IDataOutput,
  IDataOutputWithToken,
  ITokenData,
  TokenVersion,
} from '../types';
import NanoContractHeader from './header';
import Address from '../models/address';
import leb128 from '../utils/leb128';
import FeeHeader from '../headers/fee';
import { Fee } from '../utils/fee';
import { Utxo } from '../wallet/types';

class NanoContractTransactionBuilder {
  blueprintId: string | null | undefined;

  // nano contract ID, null if initialize
  ncId: string | null | undefined;

  method: string | null;

  actions: NanoContractAction[] | null;

  caller: Address | null;

  args: unknown[] | null;

  parsedArgs: IArgumentField[] | null;

  serializedArgs: Buffer | null;

  wallet: HathorWallet | null;

  // So far we support Transaction or CreateTokenTransaction
  vertexType: NanoContractVertexType | null;

  // In case of a CreateTokenTransaction, these are the options
  // for the tx creation used by the tokens utils method
  createTokenOptions: NanoContractBuilderCreateTokenOptions | null;

  // This parameter is used for token creation transactions
  // and indicates if the token deposit utxo was already added
  // in the action deposit phase
  tokenFeeAddedInDeposit: boolean;

  // Optional maximum fee in HTR
  maxFee: bigint | null;

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
    this.tokenFeeAddedInDeposit = false;
    this.maxFee = null;
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
  setActions(actions: NanoContractAction[] | null | undefined) {
    if (!actions) {
      return this;
    }

    const parseResult = INanoContractActionSchema.array().safeParse(actions);
    if (!parseResult.success) {
      throw new NanoContractTransactionError(
        `Invalid actions. Error: ${parseResult.error.message}.`
      );
    }
    this.actions = parseResult.data;
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
  setArgs(args: unknown[] | null) {
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
   * Set optional maximum fee limit. If calculated fee exceeds this, build() throws.
   * If not set, fee is auto-calculated without limit.
   *
   * @param amount Maximum fee amount in HTR
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  setMaxFee(amount: bigint) {
    this.maxFee = amount;
    return this;
  }

  /**
   * Guard that asserts `this.wallet` is not null and narrows its type for the caller.
   * Throws a TypeError if wallet is not set.
   */
  private assertWallet(): asserts this is { wallet: HathorWallet } {
    if (!this.wallet) {
      throw new TypeError('Wallet is required to build nano contract transactions.');
    }
  }

  /**
   * Calculate fee for fee-based token operations.
   *
   * Fee is calculated from:
   * 1. Transaction outputs of fee-based tokens (via Fee.calculate)
   * 2. Deposit actions of fee-based tokens (tokens going into contracts)
   *
   * @param inputs Transaction inputs
   * @param outputs Transaction outputs
   * @param tokens Token UIDs involved in the transaction
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  async calculateFee(
    inputs: IDataInput[],
    outputs: IDataOutput[],
    tokens: string[]
  ): Promise<bigint> {
    this.assertWallet();

    const tokensMap = new Map<string, ITokenData>();
    for (const uid of tokens) {
      let tokenData = await this.wallet.storage.getToken(uid);
      if (!tokenData || tokenData.version === undefined) {
        const { tokenInfo } = await this.wallet.getTokenDetails(uid);
        tokenData = {
          uid,
          name: tokenInfo.name,
          symbol: tokenInfo.symbol,
          version: tokenInfo.version,
        };
      }
      tokensMap.set(uid, tokenData);
    }

    // Calculate fee from transaction outputs
    let fee = await Fee.calculate(inputs, outputs as IDataOutputWithToken[], tokensMap);

    // Add fee for deposit actions (tokens going into contracts count as outputs)
    this.actions?.forEach(action => {
      if (action.type === NanoContractActionType.DEPOSIT && action.token) {
        const tokenData = tokensMap.get(action.token);
        if (tokenData && tokenData.version === TokenVersion.FEE) {
          fee += FEE_PER_OUTPUT;
        }
      }
    });

    // Add fee for token creation outputs when creating a fee-based token
    // The mint output counts as 1 fee (authority outputs are excluded)
    if (
      this.vertexType === NanoContractVertexType.CREATE_TOKEN_TRANSACTION &&
      this.createTokenOptions?.tokenVersion === TokenVersion.FEE
    ) {
      fee += FEE_PER_OUTPUT;
    }

    return fee;
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
    this.assertWallet();
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

    let { amount } = action;
    if (
      action.token === NATIVE_TOKEN_UID &&
      this.vertexType === NanoContractVertexType.CREATE_TOKEN_TRANSACTION &&
      !this.createTokenOptions!.contractPaysTokenDeposit
    ) {
      // We will query for HTR utxos to fill the deposit action
      // and this is a transaction that creates a token and the contract
      // won't pay for the deposit fee, so we also add in this utxo query
      // the token deposit fee and data output fee
      const dataArray = this.createTokenOptions!.data ?? [];
      let htrToCreateToken: bigint;

      if (this.createTokenOptions!.tokenVersion === TokenVersion.FEE) {
        // For fee tokens: 1 HTR per non-authority output (mint output) + data fee
        htrToCreateToken = FEE_PER_OUTPUT + tokensUtils.getDataFee(dataArray.length);
      } else {
        // For deposit tokens: deposit percentage + data fee
        htrToCreateToken = tokensUtils.getTransactionHTRDeposit(
          this.createTokenOptions!.amount,
          dataArray.length,
          this.wallet.storage
        );
      }
      amount += htrToCreateToken;
      this.tokenFeeAddedInDeposit = true;
    }

    // Get the utxos with the amount of the deposit and create the inputs
    const utxoOptions: { token: string; filter_address?: string } = { token: action.token };
    if (action.address) {
      utxoOptions.filter_address = action.address;
    }

    let utxosData;
    try {
      utxosData = await this.wallet.getUtxosForAmount(amount, utxoOptions);
    } catch (e) {
      if (e instanceof UtxoError) {
        throw new NanoContractTransactionError('Not enough utxos to execute the deposit.');
      }

      throw e;
    }
    const inputs: IDataInput[] = [];
    for (const utxo of utxosData.utxos) {
      await this.wallet.markUtxoSelected(utxo.txId, utxo.index, true);
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
    this.assertWallet();
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

      // We pay the deposit/fee in native token uid
      if (this.createTokenOptions.contractPaysTokenDeposit && action.token === NATIVE_TOKEN_UID) {
        const dataArray = this.createTokenOptions!.data ?? [];
        let htrToCreateToken: bigint;

        if (this.createTokenOptions.tokenVersion === TokenVersion.FEE) {
          // For fee tokens: 1 HTR per non-authority output (mint output) + data fee
          htrToCreateToken = FEE_PER_OUTPUT + tokensUtils.getDataFee(dataArray.length);
        } else {
          // For deposit tokens: deposit percentage + data fee
          htrToCreateToken = tokensUtils.getTransactionHTRDeposit(
            this.createTokenOptions!.amount,
            dataArray.length,
            this.wallet.storage
          );
        }
        withdrawalAmount -= htrToCreateToken;
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
    this.assertWallet();
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
    const utxos = await this.wallet.getAuthorityUtxo(
      action.token,
      action.authority as AuthorityType,
      {
        many: false,
        only_available_utxos: true,
        filter_address: action.address,
      }
    );

    if (!utxos || utxos.length === 0) {
      throw new NanoContractTransactionError(
        'Not enough authority utxos to execute the grant authority.'
      );
    }

    const inputs: IDataInput[] = [];
    // The method gets only one utxo
    const utxo = utxos[0];
    await this.wallet.markUtxoSelected(utxo.txId, utxo.index, true);
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
   * Execute an acquire authority action
   *
   * @param {action} Action to be completed (must be an acquire authority type)
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  executeAcquireAuthority(action: NanoContractAction): IDataOutput | null {
    this.assertWallet();
    if (action.type !== NanoContractActionType.ACQUIRE_AUTHORITY) {
      throw new NanoContractTransactionError(
        "Can't execute an acquire authority with an action which type is different than acquire authority."
      );
    }

    if (!action.address || !action.authority || !action.token) {
      throw new NanoContractTransactionError(
        'Address, authority, and token are required for acquire authority action.'
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
    this.assertWallet();
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

      this.blueprintId = await getBlueprintId(this.ncId, this.wallet);
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
      this.args,
      this.wallet.getNetworkObject()
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
      for (const arg of this.parsedArgs) {
        serializedArray.push(arg.field.toBuffer());
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
          case NanoContractActionType.ACQUIRE_AUTHORITY: {
            const outputAcquire = this.executeAcquireAuthority(action);
            if (outputAcquire) {
              outputs = concat(outputs, outputAcquire);
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
   * Select HTR inputs to pay the fee amount
   * Creates change output if necessary
   *
   * @param {bigint} feeAmount Amount of HTR needed to pay fees
   *
   * @memberof NanoContractTransactionBuilder
   * @inner
   */
  async selectFeeInputs(feeAmount: bigint): Promise<{
    inputs: IDataInput[];
    outputs: IDataOutput[];
  }> {
    this.assertWallet();

    let utxosData: { utxos: Utxo[]; changeAmount: bigint };

    try {
      utxosData = await this.wallet.getUtxosForAmount(feeAmount, {
        token: NATIVE_TOKEN_UID,
      });
    } catch (e) {
      if (e instanceof UtxoError) {
        throw new NanoContractTransactionError('Not enough HTR utxos to pay the fee.');
      }
      throw e;
    }

    const inputs: IDataInput[] = [];
    for (const utxo of utxosData.utxos) {
      await this.wallet.markUtxoSelected(utxo.txId, utxo.index, true);
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
    // Create change output if there's change amount
    if (utxosData.changeAmount && utxosData.changeAmount > 0n) {
      const changeAddress = await this.wallet.getCurrentAddress();
      outputs.push({
        type: getAddressType(changeAddress.address, this.wallet.getNetworkObject()),
        address: changeAddress.address,
        value: utxosData.changeAmount,
        timelock: null,
        token: NATIVE_TOKEN_UID,
        authorities: 0n,
        isChange: true,
      });
    }

    return { inputs, outputs };
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
    this.assertWallet();
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
          skipDepositFee:
            this.createTokenOptions.contractPaysTokenDeposit || this.tokenFeeAddedInDeposit,
          tokenVersion: this.createTokenOptions.tokenVersion,
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
    this.assertWallet();
    let inputs: IDataInput[] = [];
    let outputs: IDataOutput[] = [];
    let tokens: string[] = [];
    try {
      await this.verify();

      // Transform actions into inputs and outputs
      ({ inputs, outputs, tokens } = await this.buildInputsOutputs());

      // Calculate fee from resulting outputs (before adding fee inputs)
      const fee = await this.calculateFee(inputs, outputs, tokens);

      // Validate against maxFee if set
      if (this.maxFee !== null && fee > this.maxFee) {
        throw new NanoContractTransactionError(
          `Calculated fee (${fee}) exceeds maximum fee (${this.maxFee}).`
        );
      }

      // Select native token inputs to pay calculated fee (if any)
      if (fee > 0n) {
        const { inputs: feeInputs, outputs: feeOutputs } = await this.selectFeeInputs(fee);
        inputs = concat(inputs, feeInputs);
        outputs = concat(outputs, feeOutputs);
      }

      // Serialize the method arguments
      await this.serializeArgs();

      const ncId = this.method === NANO_CONTRACTS_INITIALIZE_METHOD ? this.blueprintId : this.ncId;

      if (ncId == null) {
        // This was validated in the beginning of the method but the linter was complaining about it
        throw new Error('This should never happen.');
      }

      const tx = await this.buildTransaction(inputs, outputs, tokens);
      const seqnum = await this.wallet.getNanoHeaderSeqnum(this.caller!.base58);

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
        seqnum,
        this.caller!,
        null
      );

      tx.headers.push(nanoHeader);

      // Add FeeHeader with fee
      if (fee > 0n) {
        const feeHeader = new FeeHeader([{ tokenIndex: 0, amount: fee }]);
        feeHeader.validate();
        tx.headers.push(feeHeader);
      }

      return tx;
    } catch (e) {
      if (!inputs) {
        throw e;
      }

      for (const input of inputs) {
        await this.wallet.markUtxoSelected(input.txId, input.index, false);
      }

      throw e;
    }
  }
}

export default NanoContractTransactionBuilder;

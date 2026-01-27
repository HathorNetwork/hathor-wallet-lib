/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { EventEmitter } from 'events';
import { shuffle } from 'lodash';
import tokensUtils from '../utils/tokens';
import walletApi from './api/walletApi';
import MineTransaction from './mineTransaction';
import HathorWalletServiceWallet from './wallet';
import helpers from '../utils/helpers';
import P2PKH from '../models/p2pkh';
import P2SH from '../models/p2sh';
import Transaction from '../models/transaction';
import Output from '../models/output';
import Input from '../models/input';
import Address from '../models/address';
import { DEFAULT_NATIVE_TOKEN_CONFIG, FEE_PER_OUTPUT, NATIVE_TOKEN_UID } from '../constants';
import { SendTxError, UtxoError, WalletError, WalletRequestError } from '../errors';
import {
  OutputSendTransaction,
  InputRequestObj,
  TokenMap,
  ISendTransaction,
  MineTxSuccessData,
  OutputType,
  Utxo,
  FeeHeaderSendTransaction,
} from './types';
import { IDataInput, IDataOutputWithToken, IDataTx, IFeeEntry, TokenVersion } from '../types';
import { FeeHeader, Header } from '../headers';

type optionsType = {
  outputs?: OutputSendTransaction[];
  inputs?: InputRequestObj[];
  feeHeader?: FeeHeaderSendTransaction;
  changeAddress?: string | null;
  transaction?: Transaction | null;
  pin?: string | null;
};

class SendTransactionWalletService extends EventEmitter implements ISendTransaction {
  // Wallet that is sending the transaction
  private wallet: HathorWalletServiceWallet;

  /**
   * Get token details from the wallet and throw an error if the token is not found.
   * For the native token (HTR), returns static token info without making an API call.
   *
   * @param token - The token UID to get details for
   * @returns The token info object
   * @throws {SendTxError} If the token is not found
   */
  private async getTokenDetails(token: string) {
    if (token === NATIVE_TOKEN_UID) {
      return {
        id: NATIVE_TOKEN_UID,
        ...DEFAULT_NATIVE_TOKEN_CONFIG,
      };
    }
    const { tokenInfo } = await this.wallet.getTokenDetails(token);
    if (!tokenInfo) {
      throw new SendTxError(`Token ${token} not found.`);
    }
    return tokenInfo;
  }

  // Outputs to prepare the transaction
  private outputs: OutputSendTransaction[];

  // Optional inputs to prepare the transaction
  private inputs: InputRequestObj[];

  // Optional fee header to prepare the transaction
  private feeHeader: FeeHeaderSendTransaction;

  // Optional change address to prepare the transaction
  private changeAddress: string | null;

  // Transaction object to be used after it's already prepared
  public transaction: Transaction | null;

  // MineTransaction object
  private mineTransaction: MineTransaction | null;

  // PIN to load the seed from memory
  private pin: string | null;

  // Data for the transaction after it's prepared
  public fullTxData: IDataTx | null;

  // Address paths for the inputs, to be used when signing
  private _utxosAddressPath: string[];

  // Fee amount to prepare the transaction
  private _feeAmount: bigint;

  constructor(wallet: HathorWalletServiceWallet, options: optionsType = {}) {
    super();

    const newOptions: optionsType = {
      outputs: [],
      inputs: [],
      feeHeader: { entries: [] },
      changeAddress: null,
      transaction: null,
      ...options,
    };

    this.wallet = wallet;
    this.outputs = newOptions.outputs!;
    this.inputs = newOptions.inputs!;
    this.feeHeader = newOptions.feeHeader!;
    this.changeAddress = newOptions.changeAddress!;
    this.transaction = newOptions.transaction!;
    this.mineTransaction = null;
    this.pin = newOptions.pin!;
    this.fullTxData = null;
    this._utxosAddressPath = [];
    this._feeAmount = 0n;
  }

  /**
   * Prepare transaction data from inputs and outputs.
   *
   * This method provides more flexibility than `prepareTx` by allowing for mixed-input scenarios,
   * where some inputs are provided by the user and others are automatically selected from the wallet.
   * It processes both user-defined and automatically selected inputs, creates change outputs when
   * necessary, and constructs the final transaction object.
   *
   * The process is as follows:
   * 1. Calculate the total amount for each token from the outputs, including the cost of data outputs.
   * 2. Validate any user-provided inputs to ensure they are available and sufficient.
   * 3. For tokens where no inputs were provided, automatically select UTXOs from the wallet to cover the required amounts.
   * 4. Create change outputs for any tokens where the input value exceeds the output value.
   * 5. Construct the final transaction object with all inputs, outputs, and tokens.
   *
   * @returns {Promise<IDataTx>} A promise that resolves with the prepared transaction data.
   */
  async prepareTxData(): Promise<IDataTx> {
    // 1. Calculate total output amount for each token
    const tokenAmountMap: TokenMap = {};
    for (const output of this.outputs) {
      const token = output.type === OutputType.DATA ? NATIVE_TOKEN_UID : output.token;
      const value =
        output.type === OutputType.DATA ? tokensUtils.getDataScriptOutputFee() : output.value;
      if (token in tokenAmountMap) {
        tokenAmountMap[token].amount += value;
      } else {
        const tokenInfo = await this.getTokenDetails(token);
        tokenAmountMap[token] = {
          version: tokenInfo.version,
          amount: value,
        };
      }
      if (tokenAmountMap[token].version === TokenVersion.FEE) {
        this._feeAmount += FEE_PER_OUTPUT;
      }
    }
    // deal with the fee header entries same as the outputs
    for (const entry of this.feeHeader.entries) {
      if (entry.token in tokenAmountMap) {
        tokenAmountMap[entry.token].amount += entry.amount;
      } else {
        const tokenInfo = await this.getTokenDetails(entry.token);
        tokenAmountMap[entry.token] = {
          version: tokenInfo.version,
          amount: entry.amount,
        };
      }
    }

    const utxosAddressPath: string[] = [];
    const finalInputs: InputRequestObj[] = [...this.inputs];
    const finalOutputs: OutputSendTransaction[] = [...this.outputs];

    // Map of token uid to a flag indicating if we need to select inputs for it
    const tokenNeedsInputs = new Map<string, boolean>();
    for (const token of Object.keys(tokenAmountMap)) {
      tokenNeedsInputs.set(token, true);
    }

    // Cache UTXO data to avoid fetching the same data multiple times
    const utxoDataMap = new Map<string, Utxo>();

    // 2. Process pre-selected inputs
    const userInputAmountMap: TokenMap = {};
    if (this.inputs.length > 0) {
      for (const input of this.inputs) {
        const utxo = await this.wallet.getUtxoFromId(input.txId, input.index);
        if (utxo === null) {
          throw new UtxoError(
            `Invalid input selection. Input ${input.txId} at index ${input.index}.`
          );
        }

        if (!(utxo.tokenId in tokenAmountMap)) {
          throw new SendTxError(
            `Invalid input selection. Input ${input.txId} at index ${input.index} has token ${utxo.tokenId} that is not on the outputs.`
          );
        }

        utxosAddressPath.push(utxo.addressPath);

        // Cache UTXO data for later use
        const utxoKey = `${input.txId}:${input.index}`;
        utxoDataMap.set(utxoKey, utxo);

        if (utxo.tokenId in userInputAmountMap) {
          userInputAmountMap[utxo.tokenId].amount += utxo.value;
        } else {
          userInputAmountMap[utxo.tokenId] = {
            version: tokenAmountMap[utxo.tokenId].version,
            amount: utxo.value,
          };
        }
      }
    }

    // 2.5. Mark tokens with pre-selected inputs as not needing automatic UTXO selection
    for (const token of Object.keys(userInputAmountMap)) {
      tokenNeedsInputs.set(token, false);
    }

    // 3. Select UTXOs for non-HTR tokens first
    // This must happen BEFORE selecting HTR UTXOs because:
    // - Selecting UTXOs may create change outputs for fee-based tokens
    // - Each fee-based token change output increments _feeAmount
    // - We need the final _feeAmount to know how much HTR is needed
    const nonHtrTokens = Array.from(tokenNeedsInputs.keys()).filter(
      token => token !== NATIVE_TOKEN_UID
    );
    await this.selectUtxosForTokens(
      nonHtrTokens,
      tokenAmountMap,
      tokenNeedsInputs,
      finalInputs,
      utxosAddressPath,
      utxoDataMap,
      finalOutputs
    );

    // 3.5. If user didn't provide a fee header, add the calculated fee to HTR requirements
    if (this.feeHeader.entries.length === 0 && this._feeAmount > 0n) {
      if (NATIVE_TOKEN_UID in tokenAmountMap) {
        tokenAmountMap[NATIVE_TOKEN_UID].amount += this._feeAmount;
      } else {
        tokenAmountMap[NATIVE_TOKEN_UID] = {
          version: TokenVersion.NATIVE,
          amount: this._feeAmount,
        };
        tokenNeedsInputs.set(NATIVE_TOKEN_UID, true);
      }
    }

    // 3.6. Now select UTXOs for HTR (if needed)
    // At this point we know the final fee amount
    await this.selectUtxosForTokens(
      [NATIVE_TOKEN_UID],
      tokenAmountMap,
      tokenNeedsInputs,
      finalInputs,
      utxosAddressPath,
      utxoDataMap,
      finalOutputs
    );

    // 4. Validate pre-selected inputs and create change outputs
    // Now that we know the final fee amount, we can properly validate if user inputs are sufficient
    for (const [token, userInputData] of Object.entries(userInputAmountMap)) {
      if (!(token in tokenAmountMap)) {
        // This case should not happen if we processed inputs correctly, but for safety:
        throw new SendTxError(
          `Invalid input selection. Token ${token} is in the inputs but there are no outputs for it.`
        );
      }

      if (userInputData.amount < tokenAmountMap[token].amount) {
        throw new SendTxError(
          `Invalid input selection. Sum of inputs for token ${token} is smaller than the sum of outputs.`
        );
      }

      if (userInputData.amount > tokenAmountMap[token].amount) {
        const changeAmount = userInputData.amount - tokenAmountMap[token].amount;
        const changeAddress =
          this.changeAddress || this.wallet.getCurrentAddress({ markAsUsed: true }).address;
        finalOutputs.push({
          address: changeAddress,
          value: changeAmount,
          token,
          type: helpers.getOutputTypeFromAddress(changeAddress, this.wallet.network),
        });
      }
    }

    // 4. Update instance properties and shuffle outputs if change was added.
    this.inputs = finalInputs;
    // Check if outputs changed to decide on shuffling.
    if (finalOutputs.length > this.outputs.length) {
      this.outputs = shuffle(finalOutputs);
    } else {
      this.outputs = finalOutputs;
    }

    // 5. Create transaction data object
    const dataInputs: IDataInput[] = [];
    for (const input of this.inputs) {
      const utxoKey = `${input.txId}:${input.index}`;
      const utxo = utxoDataMap.get(utxoKey);
      if (!utxo) {
        // Should not happen as we cached them before
        throw new UtxoError(
          `Could not retrieve utxo details for input ${input.txId}:${input.index}`
        );
      }
      dataInputs.push({
        txId: input.txId,
        index: input.index,
        value: utxo.value,
        token: utxo.tokenId,
        address: utxo.address,
        authorities: utxo.authorities,
      });
    }

    const dataOutputs: IDataOutputWithToken[] = [];
    for (const output of this.outputs) {
      if (output.type === OutputType.DATA) {
        dataOutputs.push({
          type: OutputType.DATA,
          data: Buffer.from(output.data!).toString('hex'),
          value: tokensUtils.getDataScriptOutputFee(),
          authorities: 0n,
          token: NATIVE_TOKEN_UID,
        });
      } else {
        if (!output.address || !output.token) {
          // This should not happen for a regular output
          throw new WalletError('Output is missing address or token.');
        }
        const outputType = helpers.getOutputTypeFromAddress(output.address, this.wallet.network) as
          | 'p2pkh'
          | 'p2sh';
        dataOutputs.push({
          type: outputType,
          value: output.value,
          token: output.token,
          address: output.address,
          timelock: output.timelock || null,
          authorities: 0n,
        });
      }
    }

    const tokens = Object.keys(tokenAmountMap);
    // Remove HTR from tokens array since it doesn't need to be included in transaction tokens
    const htrIndex = tokens.indexOf(NATIVE_TOKEN_UID);
    if (htrIndex > -1) {
      tokens.splice(htrIndex, 1);
    }

    // Add fee header if there's a fee to pay
    const headers: Header[] = [];
    if (this._feeAmount > 0n) {
      headers.push(new FeeHeader([{ tokenIndex: 0, amount: this._feeAmount }]));
    }

    const txData: IDataTx = {
      inputs: dataInputs,
      outputs: dataOutputs,
      tokens,
      headers,
    };

    this._utxosAddressPath = utxosAddressPath;
    this.fullTxData = txData;

    return txData;
  }

  /**
   * Prepare transaction data to send
   * Get utxos from wallet service, creates change outpus and returns a Transaction object
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async prepareTx(): Promise<{ transaction: Transaction; utxosAddressPath: string[] }> {
    this.emit('prepare-tx-start');
    // We get the full outputs amount for each token
    // This is useful for (i) getting the utxos for each one
    // in case it's not sent and (ii) create the token array of the tx
    const tokenAmountMap: TokenMap = {};

    for (const output of this.outputs) {
      if (output.token in tokenAmountMap) {
        tokenAmountMap[output.token].amount += output.value;
      } else {
        const tokenInfo = await this.getTokenDetails(output.token);
        tokenAmountMap[output.token] = {
          version: tokenInfo.version,
          amount: output.value,
        };
      }
      if (tokenAmountMap[output.token].version === TokenVersion.FEE) {
        this._feeAmount += FEE_PER_OUTPUT;
      }
    }
    // deal with the fee header entries same as the outputs
    for (const entry of this.feeHeader.entries) {
      if (entry.token in tokenAmountMap) {
        tokenAmountMap[entry.token].amount += entry.amount;
      } else {
        const tokenInfo = await this.getTokenDetails(entry.token);
        if (tokenInfo.version === TokenVersion.FEE) {
          throw new SendTxError(
            `Token ${entry.token} is a fee token, and is not allowed to be used in the fee header.`
          );
        }
        tokenAmountMap[entry.token] = {
          version: tokenInfo.version,
          amount: entry.amount,
        };
      }
    }

    // We need this array to get the addressPath for each input used and be able to sign the input data
    let utxosAddressPath: string[];
    if (this.inputs.length === 0) {
      // Need to get utxos
      // We already know the full amount for each token, except for HTR
      // to know the HTR amount we need to calculate the fee and then select the UTXOS for HTR
      // Now we can get the utxos and (if needed) change amount for each token
      const tokensWithoutHtr = { ...tokenAmountMap };
      delete tokensWithoutHtr[NATIVE_TOKEN_UID];
      utxosAddressPath = await this.selectUtxosToUse(tokensWithoutHtr);

      const htrTokenAmount = {
        [NATIVE_TOKEN_UID]: {
          version: TokenVersion.NATIVE,
          amount: (tokenAmountMap[NATIVE_TOKEN_UID]?.amount ?? 0n) + this._feeAmount,
        },
      };
      const htrAddressPath = await this.selectUtxosToUse(htrTokenAmount);
      utxosAddressPath.push(...htrAddressPath);
    } else {
      // If the user selected the inputs, we must validate that
      // all utxos are valid and the sum is enought to fill the outputs
      utxosAddressPath = await this.validateUtxos(tokenAmountMap);
    }
    const tokens = Object.keys(tokenAmountMap);
    const htrIndex = tokens.indexOf(NATIVE_TOKEN_UID);
    if (htrIndex > -1) {
      tokens.splice(htrIndex, 1);
    }

    // Transform input data in Input model object
    const inputsObj: Input[] = [];
    for (const i of this.inputs) {
      inputsObj.push(this.inputDataToModel(i));
    }

    // Transform output data in Output model object
    const outputsObj: Output[] = [];
    for (const o of this.outputs) {
      outputsObj.push(this.outputDataToModel(o, tokens));
    }

    // Create the transaction object, add weight and timestamp
    this.transaction = new Transaction(inputsObj, outputsObj);
    this.transaction.tokens = tokens;

    // Add fee header if needed
    // it means the user provided a fee header, so we will use it instead of the calculated fee
    if (this.feeHeader?.entries && this.feeHeader.entries.length > 0) {
      this.transaction.headers.push(
        SendTransactionWalletService.feeHeaderToModel(this.feeHeader, tokens)
      );
      // it means the user didn't provide a fee header, so we will use the calculated fee if needed
    } else if (this._feeAmount > 0n) {
      this.transaction.headers.push(new FeeHeader([{ tokenIndex: 0, amount: this._feeAmount }]));
    }

    this.emit('prepare-tx-end', this.transaction);
    return { transaction: this.transaction, utxosAddressPath };
  }

  /**
   * Map input data to an input object
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  // eslint-disable-next-line class-methods-use-this -- XXX: This method should be made static
  inputDataToModel(input: InputRequestObj): Input {
    return new Input(input.txId, input.index);
  }

  /**
   * Map fee header data to a fee header object
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  static feeHeaderToModel(feeHeader: FeeHeaderSendTransaction, tokens: string[]): FeeHeader {
    const entries: IFeeEntry[] = [];
    for (const entry of feeHeader.entries) {
      if (entry.token === NATIVE_TOKEN_UID) {
        entries.push({
          tokenIndex: 0,
          amount: entry.amount,
        });
      } else if (tokens.indexOf(entry.token) > -1) {
        entries.push({
          tokenIndex: tokens.indexOf(entry.token) + 1,
          amount: entry.amount,
        });
      } else {
        throw new SendTxError(`Token ${entry.token} not found in the tokens array.`);
      }
    }
    return new FeeHeader(entries);
  }

  /**
   * Map output data to an output object
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  outputDataToModel(output: OutputSendTransaction, tokens: string[]): Output {
    if (output.type === OutputType.DATA) {
      return helpers.createDataScriptOutput(output.data!);
    }

    const address = new Address(output.address!, { network: this.wallet.network });
    if (!address.isValid()) {
      throw new SendTxError(`Address ${output.address!} is not valid.`);
    }
    const tokenData = tokens.indexOf(output.token) > -1 ? tokens.indexOf(output.token) + 1 : 0;
    const outputOptions = { tokenData };

    // Create the appropriate script based on address type (P2PKH or P2SH)
    const addressType = address.getType();
    let script: Buffer;
    if (addressType === 'p2pkh') {
      const p2pkh = new P2PKH(address, { timelock: output.timelock || null });
      script = p2pkh.createScript();
    } else {
      const p2sh = new P2SH(address, { timelock: output.timelock || null });
      script = p2sh.createScript();
    }

    return new Output(output.value, script, outputOptions);
  }

  /**
   * Check if the utxos selected are valid and the sum is enough to
   * fill the outputs. If needed, create change output
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async validateUtxos(tokenAmountMap: TokenMap): Promise<string[]> {
    const amountInputMap = {};
    const utxosAddressPath: string[] = [];
    for (const input of this.inputs) {
      const utxo = await this.wallet.getUtxoFromId(input.txId, input.index);
      if (utxo === null) {
        throw new UtxoError(
          `Invalid input selection. Input ${input.txId} at index ${input.index}.`
        );
      }

      if (!(utxo.tokenId in tokenAmountMap)) {
        throw new SendTxError(
          `Invalid input selection. Input ${input.txId} at index ${input.index} has token ${utxo.tokenId} that is not on the outputs.`
        );
      }

      utxosAddressPath.push(utxo.addressPath);

      if (utxo.tokenId in amountInputMap) {
        amountInputMap[utxo.tokenId] += utxo.value;
      } else {
        amountInputMap[utxo.tokenId] = utxo.value;
      }
    }

    for (const t in tokenAmountMap) {
      if (!(t in amountInputMap)) {
        throw new SendTxError(
          `Invalid input selection. Token ${t} is in the outputs but there are no inputs for it.`
        );
      }

      if (amountInputMap[t] < tokenAmountMap[t].amount) {
        throw new SendTxError(
          `Invalid input selection. Sum of inputs for token ${t} is smaller than the sum of outputs.`
        );
      }

      // this condition also cover the case where the user provided the fee header entries
      if (amountInputMap[t] > tokenAmountMap[t].amount) {
        const changeAmount = amountInputMap[t] - tokenAmountMap[t].amount;
        const changeAddress =
          this.changeAddress || this.wallet.getCurrentAddress({ markAsUsed: true }).address;
        this.outputs.push({
          address: changeAddress,
          value: changeAmount,
          token: t,
          type: helpers.getOutputTypeFromAddress(changeAddress, this.wallet.network),
        });
        // If we add a change output, then we must shuffle it
        this.outputs = shuffle(this.outputs);
      }
    }

    return utxosAddressPath;
  }

  /**
   * Select UTXOs for specific tokens that need automatic input selection.
   * This method processes only the specified tokens, selecting UTXOs and creating
   * change outputs as needed. It also tracks fee increases from fee-based token changes.
   *
   * @param tokensToProcess - Array of token UIDs to process
   * @param tokenAmountMap - Map of token amounts needed
   * @param tokenNeedsInputs - Map tracking which tokens need input selection
   * @param finalInputs - Array to push selected inputs into
   * @param utxosAddressPath - Array to push UTXO address paths into
   * @param utxoDataMap - Map to cache UTXO data
   * @param finalOutputs - Array to push change outputs into
   */
  private async selectUtxosForTokens(
    tokensToProcess: string[],
    tokenAmountMap: TokenMap,
    tokenNeedsInputs: Map<string, boolean>,
    finalInputs: InputRequestObj[],
    utxosAddressPath: string[],
    utxoDataMap: Map<string, Utxo>,
    finalOutputs: OutputSendTransaction[]
  ): Promise<void> {
    for (const token of tokensToProcess) {
      const needsInputs = tokenNeedsInputs.get(token);
      if (!needsInputs) {
        continue;
      }

      const { utxos, changeAmount } = await this.wallet.getUtxosForAmount(
        tokenAmountMap[token].amount,
        { token }
      );

      if (utxos.length === 0) {
        throw new UtxoError(
          `No utxos available to fill the request. Token: ${token} - Amount: ${tokenAmountMap[token].amount}.`
        );
      }

      for (const utxo of utxos) {
        finalInputs.push({ txId: utxo.txId, index: utxo.index });
        utxosAddressPath.push(utxo.addressPath);

        const utxoKey = `${utxo.txId}:${utxo.index}`;
        utxoDataMap.set(utxoKey, utxo);
      }

      if (changeAmount) {
        const changeAddress =
          this.changeAddress || this.wallet.getCurrentAddress({ markAsUsed: true }).address;
        finalOutputs.push({
          address: changeAddress,
          value: changeAmount,
          token,
          type: helpers.getOutputTypeFromAddress(changeAddress, this.wallet.network),
        });

        // If this is a fee-based token, the change output also incurs a fee
        if (tokenAmountMap[token].version === TokenVersion.FEE) {
          this._feeAmount += FEE_PER_OUTPUT;
        }
      }

      tokenNeedsInputs.set(token, false);
    }
  }

  /**
   * Select utxos to be used in the transaction
   * Get utxos from wallet service and creates change output if needed
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async selectUtxosToUse(tokenAmountMap: TokenMap): Promise<string[]> {
    const utxosAddressPath: string[] = [];

    for (const token in tokenAmountMap) {
      const { utxos, changeAmount } = await this.wallet.getUtxosForAmount(
        tokenAmountMap[token].amount,
        {
          token,
        }
      );
      if (utxos.length === 0) {
        throw new UtxoError(
          `No utxos available to fill the request. Token: ${token} - Amount: ${tokenAmountMap[token].amount}.`
        );
      }

      for (const utxo of utxos) {
        this.inputs.push({ txId: utxo.txId, index: utxo.index });
        utxosAddressPath.push(utxo.addressPath);
      }

      if (changeAmount) {
        const changeAddress =
          this.changeAddress || this.wallet.getCurrentAddress({ markAsUsed: true }).address;
        this.outputs.push({
          address: changeAddress,
          value: changeAmount,
          token,
          type: helpers.getOutputTypeFromAddress(changeAddress, this.wallet.network),
        });

        if (tokenAmountMap[token].version === TokenVersion.FEE) {
          this._feeAmount += FEE_PER_OUTPUT;
        }
        // If we add a change output, then we must shuffle it
        this.outputs = shuffle(this.outputs);
      }
    }

    return utxosAddressPath;
  }

  /**
   * Signs the inputs of a transaction
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async signTx(utxosAddressPath: string[], pin: string | null = null) {
    if (this.transaction === null) {
      throw new WalletError("Can't sign transaction if it's null.");
    }
    this.emit('sign-tx-start');
    const dataToSignHash = this.transaction.getDataToSignHash();
    const pinToUse = pin ?? this.pin ?? '';
    const xprivkey = await this.wallet.storage.getMainXPrivKey(pinToUse);

    for (const [idx, inputObj] of this.transaction.inputs.entries()) {
      const inputData = this.wallet.getInputData(
        xprivkey,
        dataToSignHash,
        // the wallet service returns the full BIP44 path, but we only need the address path:
        HathorWalletServiceWallet.getAddressIndexFromFullPath(utxosAddressPath[idx])
      );
      inputObj.setData(inputData);
    }

    // Now that the tx is completed with the data of the input
    // we can add the timestamp and calculate the weight
    this.transaction.prepareToSend();

    this.emit('sign-tx-end', this.transaction);
  }

  /**
   * Mine the transaction
   * Expects this.transaction to be prepared and signed
   * Emits MineTransaction events while the process is ongoing
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  mineTx(options = {}): Promise<MineTxSuccessData> {
    if (this.transaction === null) {
      throw new WalletError("Can't mine transaction if it's null.");
    }
    type mineOptionsType = {
      startMiningTx: boolean;
      maxTxMiningRetries: number;
    };
    const newOptions: mineOptionsType = {
      startMiningTx: true,
      maxTxMiningRetries: 3,
      ...options,
    };

    this.mineTransaction = new MineTransaction(this.transaction, {
      maxTxMiningRetries: newOptions.maxTxMiningRetries,
    });

    this.mineTransaction.on('mining-started', () => {
      this.emit('mine-tx-started');
    });

    this.mineTransaction.on('estimation-updated', data => {
      this.emit('estimation-updated', data);
    });

    this.mineTransaction.on('job-submitted', data => {
      this.emit('job-submitted', data);
    });

    this.mineTransaction.on('job-done', data => {
      this.emit('job-done', data);
    });

    this.mineTransaction.on('error', message => {
      this.emit('send-error', message);
    });

    this.mineTransaction.on('unexpected-error', message => {
      this.emit('send-error', message);
    });

    this.mineTransaction.on('success', data => {
      this.emit('mine-tx-ended', data);
    });

    if (newOptions.startMiningTx) {
      this.mineTransaction.start();
    }

    return this.mineTransaction.promise;
  }

  /**
   * Create and send a tx proposal to wallet service
   * Expects this.transaction to be prepared, signed and mined
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async handleSendTxProposal() {
    if (this.transaction === null) {
      throw new WalletError("Can't push transaction if it's null.");
    }
    this.emit('send-tx-start', this.transaction);
    const txHex = this.transaction.toHex();

    try {
      const responseData = await walletApi.createTxProposal(this.wallet, txHex);
      const { txProposalId } = responseData;
      await walletApi.updateTxProposal(this.wallet, txProposalId, txHex);
      this.transaction.updateHash();
      this.emit('send-tx-success', this.transaction);
      return this.transaction;
    } catch (err) {
      if (err instanceof WalletRequestError) {
        const errMessage = 'Error sending tx proposal.';
        this.emit('send-error', errMessage);
        throw new SendTxError(errMessage);
      } else {
        throw err;
      }
    }
  }

  /**
   * Run sendTransaction from mining, i.e. expects this.transaction to be prepared and signed
   * then it will mine and handle tx proposal
   *
   * 'until' parameter can be 'mine-tx', in order to only mine the transaction without propagating
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async runFromMining(until: string | null = null): Promise<Transaction> {
    try {
      // This will await until mine tx is fully completed
      // mineTx method returns a promise that resolves when
      // mining succeeds or rejects when there is an error
      const mineData = await this.mineTx();
      this.transaction!.parents = mineData.parents;
      this.transaction!.timestamp = mineData.timestamp;
      this.transaction!.nonce = mineData.nonce;
      this.transaction!.weight = mineData.weight;

      if (until === 'mine-tx') {
        return this.transaction!;
      }

      const tx = await this.handleSendTxProposal();
      return tx;
    } catch (err) {
      if (err instanceof WalletError) {
        this.emit('send-error', err.message);
      }
      throw err;
    }
  }

  /**
   * Run sendTransaction from preparing, i.e. prepare, sign, mine and send the tx
   *
   * 'until' parameter can be 'prepare-tx' (it will stop before signing the tx), 'sign-tx' (it will stop before mining the tx),
   * or 'mine-tx' (it will stop before send tx proposal, i.e. propagating the tx)
   *
   * @memberof SendTransactionWalletService
   * @inner
   */
  async run(until: string | null = null, pin: string | null = null): Promise<Transaction> {
    try {
      const preparedData = await this.prepareTx();
      if (until === 'prepare-tx') {
        return this.transaction!;
      }

      await this.signTx(preparedData.utxosAddressPath, pin);
      if (until === 'sign-tx') {
        return this.transaction!;
      }

      const tx = await this.runFromMining(until);
      return tx;
    } catch (err) {
      if (err instanceof WalletError) {
        this.emit('send-error', err.message);
      }
      throw err;
    }
  }
}

export default SendTransactionWalletService;

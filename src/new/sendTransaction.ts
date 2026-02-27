/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import EventEmitter from 'events';
import { shuffle } from 'lodash';
import txApi from '../api/txApi';
import { NATIVE_TOKEN_UID, SELECT_OUTPUTS_TIMEOUT } from '../constants';
import { ErrorMessages } from '../errorMessages';
import { SendTxError, WalletError } from '../errors';
import Address from '../models/address';
import CreateTokenTransaction from '../models/create_token_transaction';
import { Fee } from '../utils/fee';
import Transaction from '../models/transaction';
import {
  IDataInput,
  IDataOutput,
  IDataOutputWithToken,
  IDataTx,
  isDataOutputCreateToken,
  IStorage,
  IUtxoSelectionOptions,
  OutputValueType,
  WalletType,
} from '../types';
import helpers from '../utils/helpers';
import { addCreatedTokenFromTx } from '../utils/storage';
import tokens from '../utils/tokens';
import transactionUtils from '../utils/transaction';
import { bestUtxoSelection } from '../utils/utxo';
import MineTransaction from '../wallet/mineTransaction';
import { ISendTransaction as ISendTransactionInterface, OutputType } from '../wallet/types';
import HathorWallet from './wallet';
import Header from '../headers/base';
import FeeHeader from '../headers/fee';

export interface ISendInput {
  txId: string;
  index: number;
}

export interface ISendDataOutput {
  type: OutputType.DATA;
  data: Buffer;
  value?: number;
  token?: string;
}

export function isDataOutput(output: ISendOutput): output is ISendDataOutput {
  return output.type === OutputType.DATA;
}

export interface ISendTokenOutput {
  type: OutputType.P2PKH | OutputType.P2SH;
  address: string;
  value: OutputValueType;
  token: string;
  timelock?: number | null;
}

export type ISendOutput = ISendDataOutput | ISendTokenOutput;

/**
 * This is transaction mining class responsible for:
 *
 * - Submit a job to be mined;
 * - Update mining time estimation from time to time;
 * - Get back mining response;
 * - Push tx to the network;
 *
 * It emits the following events:
 * 'job-submitted': after job was submitted;
 * 'estimation-updated': after getting the job status;
 * 'job-done': after job is finished;
 * 'send-success': after push tx succeeds;
 * 'send-error': if an error happens;
 * 'unexpected-error': if an unexpected error happens;
 * */
export default class SendTransaction extends EventEmitter implements ISendTransactionInterface {
  wallet: HathorWallet | null;

  storage: IStorage | null;

  transaction: Transaction | null;

  outputs: ISendOutput[];

  inputs: ISendInput[];

  changeAddress: string | null;

  pin: string | null;

  fullTxData: IDataTx | null;

  mineTransaction: MineTransaction | null = null;

  private _currentStep: 'idle' | 'prepared' | 'signed' = 'idle';

  /**
   *
   * @param {HathorWallet} wallet Wallet instance
   * @param {IStorage} storage Storage object, superseded by `wallet.storage` if wallet is present
   * @param {Object} [options={}] Options to initialize the facade
   * @param {Transaction|null} [options.transaction=null] Full tx data
   * @param {ISendInput[]} [options.inputs=[]] tx inputs
   * @param {ISendOutput[]} [options.outputs=[]] tx outputs
   * @param {string|null} [options.changeAddress=null] Address to use if we need to create a change output
   * @param {string|null} [options.pin=null] Wallet pin
   * @param {IStorage|null} [options.network=null] Network object
   */
  constructor({
    wallet = null,
    storage = null,
    transaction = null,
    outputs = [],
    inputs = [],
    changeAddress = null,
    pin = null,
  }: {
    wallet?: HathorWallet | null;
    storage?: IStorage | null;
    transaction?: Transaction | null;
    inputs?: ISendInput[];
    outputs?: ISendOutput[];
    changeAddress?: string | null;
    pin?: string | null;
  } = {}) {
    super();

    this.wallet = wallet;
    if (wallet) {
      this.storage = wallet.storage;
    } else {
      this.storage = storage;
    }
    this.transaction = transaction;
    this.outputs = outputs;
    this.inputs = inputs;
    this.changeAddress = changeAddress;
    this.pin = pin;
    this.fullTxData = null;
  }

  /**
   * Prepare transaction data from inputs and outputs
   * Fill the inputs if needed, create output change if needed
   *
   * @throws SendTxError
   *
   * @return {Object} fullTxData with tokens array, inputs and outputs
   *
   * @memberof SendTransaction
   * @inner
   */
  async prepareTxData(): Promise<IDataTx> {
    if (!this.storage) {
      throw new SendTxError('Storage is not set.');
    }
    const HTR_UID = NATIVE_TOKEN_UID;
    const network = this.storage.config.getNetwork();
    const txData: IDataTx = {
      inputs: [],
      outputs: [],
      tokens: [],
    };
    // Map of token uid to the chooseInputs value of this token
    const tokenMap = new Map<string, boolean>();

    for (const output of this.outputs) {
      if (isDataOutput(output)) {
        tokenMap.set(HTR_UID, true);
        output.token = HTR_UID;

        // Data output will always have value 1 (0.01) HTR
        txData.outputs.push({
          type: OutputType.DATA,
          data: output.data.toString('hex'),
          value: 1n,
          authorities: 0n,
          token: output.token,
        });
      } else {
        const addressObj = new Address(output.address, { network });
        // We set chooseInputs true as default and may be overwritten by the inputs.
        // chooseInputs should be true if no inputs are given
        tokenMap.set(output.token, true);

        txData.outputs.push({
          address: output.address,
          value: output.value,
          timelock: output.timelock ? output.timelock : null,
          authorities: 0n,
          token: output.token,
          type: addressObj.getType(),
        });
      }
    }

    const requiresFees: { txId: string; index: number }[] = [];

    for (const input of this.inputs) {
      const inputTx = await this.storage.getTx(input.txId);
      if (inputTx === null || !inputTx.outputs[input.index]) {
        const err = new SendTxError(ErrorMessages.INVALID_INPUT);
        err.errorData = { txId: input.txId, index: input.index };
        throw err;
      }
      const spentOut = inputTx.outputs[input.index];
      if (!tokenMap.has(spentOut.token)) {
        // the inputs should be used to pay fees, otherwise it's an invalid input and it will raise an error after the fee is calculated
        if (HTR_UID === spentOut.token) {
          requiresFees.push({ txId: input.txId, index: input.index });
        } else {
          // The input select is from a token that is not in the outputs
          const err = new SendTxError(ErrorMessages.INVALID_INPUT);
          err.errorData = { txId: input.txId, index: input.index };
          throw err;
        }
      }
      tokenMap.set(spentOut.token, false);
      txData.inputs.push({
        txId: input.txId,
        index: input.index,
        value: spentOut.value,
        token: spentOut.token,
        address: spentOut.decoded.address!,
        authorities: transactionUtils.authoritiesFromOutput(spentOut),
      });
    }

    // If the user provided HTR inputs, tokenMap.get(HTR_UID) will be false
    // In that case, we should NOT choose inputs automatically (accept what user provided)
    // Otherwise (true or undefined), we should choose HTR inputs if needed for fee
    const tokenMapHasHTR = tokenMap.has(HTR_UID);
    let shouldChooseHTRInputs = tokenMap.get(HTR_UID) || false;

    // we remove HTR from the tokenMap since we will calculate the fee based on the inputs and outputs
    // and we don't want to select inputs for HTR before that
    tokenMap.delete(HTR_UID);

    const partialTxData = await prepareSendManyTokensData(
      this.storage,
      txData,
      tokenMap,
      this.changeAddress
    );

    const partialInputs = [...txData.inputs, ...partialTxData.inputs];
    const partialOutputs = [...txData.outputs, ...partialTxData.outputs] as IDataOutputWithToken[];

    // calculate the fee based in the inputs and outputs, including the change output
    // fee is always in HTR
    const fee = await Fee.calculate(
      partialInputs,
      partialOutputs,
      await tokens.getTokensByManyIds(this.storage, new Set(tokenMap.keys()))
    );

    if (requiresFees.length > 0 && fee === 0n) {
      const err = new SendTxError(ErrorMessages.INVALID_INPUT);
      err.errorData = requiresFees;
      throw err;
    }

    const headers: Header[] = [];
    if (fee > 0) {
      headers.push(new FeeHeader([{ tokenIndex: 0, amount: fee }]));
      // if the token map doesn't have HTR, it means that the user didn't provide any HTR input or output, so we need to choose inputs for HTR to pay fees
      if (!tokenMapHasHTR) {
        shouldChooseHTRInputs = true;
      }
    }

    const options: IUtxoSelectionOptions = {
      token: HTR_UID,
      chooseInputs: shouldChooseHTRInputs,
    };

    if (this.changeAddress) {
      options.changeAddress = this.changeAddress;
    }

    const partialHtrTxData = await prepareSendTokensData(
      this.storage,
      {
        inputs: partialInputs,
        outputs: partialOutputs,
      },
      options,
      fee
    );

    const shouldShuffleOutputs =
      partialTxData.outputs.length > 0 || partialHtrTxData.outputs.length > 0;
    // we initialize the outputs with the provided outputs to keep the order
    let outputs = [...txData.outputs];
    if (shouldShuffleOutputs) {
      // Shuffle outputs, so we don't have change output always in the same index
      outputs = shuffle([...partialOutputs, ...partialHtrTxData.outputs]);
    }

    // This new IDataTx should be complete with the requested funds
    this.fullTxData = {
      outputs,
      inputs: [...partialInputs, ...partialHtrTxData.inputs],
      // We already removed HTR from the tokenMap
      tokens: Array.from(tokenMap.keys()),
      headers,
    };

    return this.fullTxData;
  }

  /**
   * Prepare transaction without signing it.
   * Fill the inputs if needed, create output change if needed.
   *
   * @param {string | null} pin Pin to use (accepted for interface compatibility, not used during preparation)
   *
   * @throws SendTxError
   *
   * @return {Transaction} Transaction object prepared to be signed
   *
   * @memberof SendTransaction
   * @inner
   */
  async prepareTx(pin: string | null = null): Promise<Transaction> {
    if (!this.storage) {
      throw new SendTxError('Storage is not set.');
    }

    const pinToUse = pin ?? this.pin ?? '';
    const txData = this.fullTxData || (await this.prepareTxData());
    try {
      if (!pinToUse) {
        throw new Error('Pin is not set.');
      }
      this.transaction = await transactionUtils.prepareTransaction(txData, pinToUse, this.storage, {
        signTx: false,
      });
      // This will validate if the transaction has more than the max number of inputs and outputs.
      this.transaction.validate();
      return this.transaction;
    } catch (e) {
      const message = helpers.handlePrepareDataError(e);
      throw new SendTxError(message);
    }
  }

  /**
   * Sign the transaction and prepare the tx to be mined
   *
   * @param {string | null} pin Pin to use in this method (overwrites this.pin)
   *
   * @throws SendTxError
   *
   * @return {Transaction} Transaction object prepared to be mined
   *
   * @memberof SendTransaction
   * @inner
   */
  async signTx(pin: string | null = null): Promise<Transaction> {
    if (!this.storage) {
      throw new SendTxError('Storage is not set.');
    }

    if (!this.transaction) {
      throw new SendTxError('Transaction is not set.');
    }

    const pinToUse = pin ?? this.pin ?? '';
    try {
      if (!pinToUse) {
        throw new SendTxError('Pin is not set.');
      }

      await transactionUtils.signTransaction(this.transaction, this.storage, pinToUse);
      this.transaction.prepareToSend();
      return this.transaction;
    } catch (e) {
      const message = helpers.handlePrepareDataError(e);
      throw new SendTxError(message);
    }
  }

  /**
   * Prepare transaction to be mined from signatures
   *
   * The full tx data should already be prepared
   * since the signatures have already been made
   *
   * @params {Array<Buffer>} Array of Buffer, each being a signature of the tx data
   * The order of the signatures must match the inputs (private key used to sign should solve the input)
   *
   * @throws SendTxError
   *
   * @return {Transaction} Transaction object prepared to be mined
   *
   * @memberof SendTransaction
   * @inner
   */
  async prepareTxFrom(signatures: Buffer[]): Promise<Transaction> {
    if (!this.storage) {
      throw new SendTxError('Storage is not set.');
    }
    if (this.fullTxData === null) {
      // This method can only be called with a prepared tx data
      // because prepareTxData may modify the inputs and outputs
      throw new SendTxError(ErrorMessages.TRANSACTION_IS_NULL);
    }

    // add each input data from signature
    for (const [index, input] of this.fullTxData.inputs.entries()) {
      const signature = signatures[index];
      const addressInfo = await this.storage.getAddressInfo(input.address);
      if (addressInfo === null) {
        throw new SendTxError(ErrorMessages.INVALID_INPUT);
      }
      // Creates input data for P2PKH
      if (!addressInfo.publicKey) {
        throw new SendTxError('Missing public key for address');
      }
      input.data = transactionUtils
        .createInputData(signature, Buffer.from(addressInfo.publicKey, 'hex'))
        .toString('hex');
    }

    // prepare and create transaction
    try {
      this.transaction = transactionUtils.createTransactionFromData(
        this.fullTxData,
        this.storage.config.getNetwork()
      );
      this.transaction.prepareToSend();
      return this.transaction;
    } catch (e) {
      const message = helpers.handlePrepareDataError(e);
      throw new SendTxError(message);
    }
  }

  /**
   * Mine the transaction
   * Expects this.transaction to be prepared and signed
   * Emits MineTransaction events while the process is ongoing
   *
   * @params {Object} options Optional object with {'startMiningTx', 'maxTxMiningRetries'}
   *
   * @throws WalletError
   *
   * @memberof SendTransaction
   * @inner
   */
  async mineTx(options = {}) {
    if (this.transaction === null) {
      throw new WalletError(ErrorMessages.TRANSACTION_IS_NULL);
    }

    await this.updateOutputSelected(true);

    const newOptions = {
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
      this.updateOutputSelected(false);
      this.emit('send-error', message);
    });

    this.mineTransaction.on('unexpected-error', message => {
      this.updateOutputSelected(false);
      this.emit('unexpected-error', message);
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
   * Push tx to the network
   * If success, emits 'send-tx-success' event, otherwise emits 'send-error' event.
   *
   * @memberof SendTransaction
   * @inner
   */
  handlePushTx(): Promise<Transaction> {
    if (this.transaction === null) {
      throw new WalletError(ErrorMessages.TRANSACTION_IS_NULL);
    }

    const promise = new Promise<Transaction>((resolve, reject) => {
      if (this.transaction === null) {
        throw new WalletError(ErrorMessages.TRANSACTION_IS_NULL);
      }
      this.emit('send-tx-start', this.transaction);
      const txHex = this.transaction.toHex();
      txApi
        .pushTx(txHex, false, response => {
          if (response.success) {
            if (this.transaction === null) {
              throw new WalletError(ErrorMessages.TRANSACTION_IS_NULL);
            }
            this.transaction.updateHash();
            if (this.wallet && this.storage) {
              // Add transaction to storage and process storage
              (async (wallet: HathorWallet, storage: IStorage, transaction: Transaction) => {
                // Get the transaction as a history object
                const historyTx = await transactionUtils.convertTransactionToHistoryTx(
                  transaction,
                  storage
                );
                // Add token from a create token transaction to the storage
                // This just returns if the transaction is not a CREATE_TOKEN_TX
                await addCreatedTokenFromTx(transaction as CreateTokenTransaction, storage);
                // Add new transaction to the wallet's storage.
                wallet.enqueueOnNewTx({ history: historyTx });
              })(this.wallet, this.storage, this.transaction);
            }
            this.emit('send-tx-success', this.transaction);
            resolve(this.transaction);
          } else {
            this.updateOutputSelected(false);
            const err = new SendTxError(response.message);
            reject(err);
          }
        })
        .catch(e => {
          this.updateOutputSelected(false);
          this.emit('send-error', e.message);
          reject(e);
        });
    });

    return promise;
  }

  /**
   * Run sendTransaction from mining, i.e. expects this.transaction to be prepared and signed
   * then it will mine and push tx
   *
   * 'until' parameter can be 'mine-tx', in order to only mine the transaction without propagating
   *
   * @memberof SendTransaction
   * @inner
   */
  async runFromMining(until: string | null = null): Promise<Transaction> {
    try {
      if (this.transaction === null) {
        throw new WalletError(ErrorMessages.TRANSACTION_IS_NULL);
      }
      // This will await until mine tx is fully completed
      // mineTx method returns a promise that resolves when
      // mining succeeds or rejects when there is an error
      const mineData = await this.mineTx();
      this.transaction.parents = mineData.parents;
      this.transaction.timestamp = mineData.timestamp;
      this.transaction.nonce = mineData.nonce;
      this.transaction.weight = mineData.weight;

      if (until === 'mine-tx') {
        return this.transaction;
      }

      const tx = await this.handlePushTx();
      return tx;
    } catch (err) {
      if (err instanceof WalletError) {
        this.emit('send-error', err.message);
      }
      throw err;
    }
  }

  /**
   * Method created for compatibility reasons
   * some people might be using the old facade and this start method just calls runFromMining
   *
   * @deprecated
   *
   * @memberof SendTransaction
   * @inner
   */
  start() {
    this.runFromMining();
  }

  /**
   * Run sendTransaction from preparing, i.e. prepare, sign, mine and push the tx
   *
   * 'until' parameter can be 'prepare-tx' (it will stop before signing the tx),
   * 'sign-tx' (it will stop before mining the tx),
   * or 'mine-tx' (it will stop before send tx proposal, i.e. propagating the tx)
   *
   * Can be called incrementally: run('prepare-tx') then run(null) to continue.
   *
   * @memberof SendTransaction
   * @inner
   */
  async run(until: string | null = null, pin: string | null = null): Promise<Transaction> {
    try {
      if (this._currentStep === 'idle') {
        await this.prepareTx(pin);
        this._currentStep = 'prepared';
        if (until === 'prepare-tx') {
          return this.transaction!;
        }
      }

      if (this._currentStep === 'prepared') {
        await this.signTx(pin);
        this._currentStep = 'signed';
        if (until === 'sign-tx') {
          return this.transaction!;
        }
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

  /**
   * Update the outputs of the tx data in localStorage to set 'selected_as_input'
   * This will prevent the input selection algorithm to select the same input before the
   * tx arrives from the websocket and set the 'spent_by' key
   *
   * @param {boolean} selected If should set the selected parameter as true or false
   *
   * */
  async updateOutputSelected(selected: boolean) {
    if (this.transaction === null) {
      throw new WalletError(ErrorMessages.TRANSACTION_IS_NULL);
    }

    if (!this.storage) {
      // No storage available, so we can't update the selected utxos
      return;
    }

    // Mark all inputs as selected
    for (const input of this.transaction.inputs) {
      await this.storage.utxoSelectAsInput(
        { txId: input.hash, index: input.index },
        selected,
        SELECT_OUTPUTS_TIMEOUT
      );
    }
  }
}

/**
 * Check the tx data and propose inputs and outputs to complete the transaction.
 * We will only check a single token
 *
 * @param {IStorage} storage
 * @param {Pick<IDataTx, 'inputs' | 'outputs'>} dataTx inputs and outputs from dataTx
 * @param {IUtxoSelectionOptions} options
 */
export async function prepareSendTokensData(
  storage: IStorage,
  dataTx: Pick<IDataTx, 'inputs' | 'outputs'>,
  options: IUtxoSelectionOptions = {},
  fee: bigint = 0n
): Promise<Pick<IDataTx, 'inputs' | 'outputs'>> {
  try {
    return await _prepareSendTokensData(storage, dataTx, options, fee);
  } catch (e) {
    if (e instanceof Error) {
      throw new SendTxError(e.message);
    }
    throw e;
  }
}

async function getOutputTypeFromWallet(storage: IStorage): Promise<'p2pkh' | 'p2sh'> {
  const walletType = await storage.getWalletType();
  if (walletType === WalletType.P2PKH) {
    return 'p2pkh';
  }
  if (walletType === WalletType.MULTISIG) {
    return 'p2sh';
  }
  throw new Error('Unsupported wallet type.');
}

async function _prepareSendTokensData(
  storage: IStorage,
  dataTx: Pick<IDataTx, 'inputs' | 'outputs'>,
  options: IUtxoSelectionOptions = {},
  fee: bigint = 0n
): Promise<Pick<IDataTx, 'inputs' | 'outputs'>> {
  const token = options.token || NATIVE_TOKEN_UID;
  const utxoSelection = options.utxoSelectionMethod || bestUtxoSelection;
  const newtxData: Pick<IDataTx, 'inputs' | 'outputs'> = { inputs: [], outputs: [] };
  let outputAmount = fee;

  // Calculate balance for the token on the transaction
  for (const output of dataTx.outputs) {
    if (isDataOutputCreateToken(output)) {
      // This is a mint output
      // Since the current transaction is creating the token we can safely ignore it
      continue;
    }
    const outputToken = output.token || NATIVE_TOKEN_UID;
    if (outputToken !== token) {
      // This output is not for the token we are looking for
      continue;
    }
    outputAmount += output.value;
  }

  if (options.chooseInputs) {
    if (outputAmount === 0n) {
      // We cannot process a target amount of 0 tokens.
      throw new Error('Invalid amount of tokens to send.');
    }

    // We will choose the inputs to fill outputAmount.funds
    const newUtxos = await utxoSelection(storage, token, outputAmount);
    if (newUtxos.amount < outputAmount) {
      throw new Error(`Token: ${token}. Insufficient amount of tokens to fill the amount.`);
    }
    newtxData.inputs = newUtxos.utxos.map(helpers.getDataInputFromUtxo);

    if (newUtxos.amount > outputAmount) {
      // We need to create a change output
      const changeAddress = await storage.getChangeAddress({
        changeAddress: options.changeAddress,
      });
      const changeOutput: IDataOutput = {
        type: await getOutputTypeFromWallet(storage),
        token,
        value: newUtxos.amount - outputAmount,
        address: changeAddress,
        authorities: 0n,
        timelock: null,
        isChange: true,
      };
      newtxData.outputs.push(changeOutput);
    }
  } else {
    let inputAmount = 0n;
    for (const input of dataTx.inputs) {
      if (input.token !== token) {
        // The input is not for the token we are checking
        continue;
      }

      // We will check the validity and availability of the provided inputs
      // and the amount (suggesting a change if needed)
      // The inputs do not need to be added on newtxData.inputs since they are provided by the caller.
      const checkSpent = await checkUnspentInput(storage, input, token);
      if (!checkSpent.success) {
        throw new Error(`Token: ${token}. ${checkSpent.message}`);
      }

      if (!(await transactionUtils.canUseUtxo(input, storage))) {
        throw new Error(
          `Token: ${token}. Output [${input.txId}, ${input.index}] is locked or being used`
        );
      }

      inputAmount += input.value;
    }
    if (inputAmount < outputAmount) {
      throw new Error(`Token: ${token}. Sum of outputs is greater than sum of inputs`);
    }
    if (inputAmount > outputAmount) {
      // Need to create a change output
      const changeAddress = await storage.getChangeAddress({
        changeAddress: options.changeAddress,
      });
      newtxData.outputs.push({
        type: await getOutputTypeFromWallet(storage),
        token,
        value: inputAmount - outputAmount,
        address: changeAddress,
        authorities: 0n,
        timelock: null,
        isChange: true,
      });
    }
  }
  return newtxData;
}

/**
 * Check the tx data and propose inputs and outputs to complete the transaction.
 * We will check all the tokens and choose the inputs for each token based on the tokenMap value
 * @param {IStorage} storage
 * @param {IDataTx} dataTx
 * @param {IUtxoSelectionOptions} options
 */
export async function prepareSendManyTokensData(
  storage: IStorage,
  txData: IDataTx,
  tokenMap: Map<string, boolean>,
  changeAddress: string | null
): Promise<Pick<IDataTx, 'outputs' | 'inputs'>> {
  const partialTxData: Pick<IDataTx, 'outputs' | 'inputs'> = { inputs: [], outputs: [] };
  for (const [token, chooseInputs] of tokenMap) {
    const options: IUtxoSelectionOptions = {
      token,
      chooseInputs,
    };
    if (changeAddress) {
      options.changeAddress = changeAddress;
    }
    const proposedData = await prepareSendTokensData(storage, txData, options);
    partialTxData.inputs.push(...proposedData.inputs);
    partialTxData.outputs.push(...proposedData.outputs);
  }
  return partialTxData;
}

/**
 * Check that the input is unspent, valid and available.
 * Will return a user-friendly message if it is not.
 *
 * @param {IStorage} storage The storage instance
 * @param {IDataInput} input The input we are checking
 * @param {string} selectedToken The token uid we are checking
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function checkUnspentInput(
  storage: IStorage,
  input: IDataInput,
  selectedToken: string
): Promise<{ success: boolean; message: string }> {
  const tx = await storage.getTx(input.txId);
  if (tx === null) {
    return { success: false, message: `Transaction [${input.txId}] does not exist in the wallet` };
  }
  if (tx.is_voided) {
    return { success: false, message: `Transaction [${input.txId}] is voided` };
  }
  if (tx.outputs.length - 1 < input.index) {
    return {
      success: false,
      message: `Transaction [${input.txId}] does not have this output [index=${input.index}]`,
    };
  }

  const txout = tx.outputs[input.index];
  if (transactionUtils.isAuthorityOutput(txout)) {
    /**
     * XXX: We are NOT enabling authority outputs for now.
     */
    return {
      success: false,
      message: `Output [${input.index}] of transaction [${input.txId}] is an authority output`,
    };
  }

  if (txout.decoded.address) {
    if (txout.decoded.address !== input.address) {
      return {
        success: false,
        message: `Output [${input.index}] of transaction [${input.txId}] does not have the same address as the provided input`,
      };
    }
    if (!(await storage.isAddressMine(txout.decoded.address))) {
      return {
        success: false,
        message: `Output [${input.index}] of transaction [${input.txId}] is not from the wallet`,
      };
    }
  } else {
    // This output does not have an address, so it cannot be spent by us
    return {
      success: false,
      message: `Output [${input.index}] of transaction [${input.txId}] cannot be spent since it does not belong to an address`,
    };
  }

  if (txout.token !== input.token || input.token !== selectedToken) {
    return {
      success: false,
      message: `Output [${input.index}] of transaction [${input.txId}] is not from selected token [${selectedToken}]`,
    };
  }

  if (txout.spent_by) {
    return {
      success: false,
      message: `Output [${input.index}] of transaction [${input.txId}] is already spent`,
    };
  }

  return { success: true, message: '' };
}

/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { crypto as cryptoBL, PrivateKey, HDPrivateKey } from 'bitcore-lib';
import { cloneDeep } from 'lodash';
import { Utxo } from '../wallet/types';
import { UtxoError, ParseError } from '../errors';
import { HistoryTransactionOutput } from '../models/types';
import {
  TOKEN_AUTHORITY_MASK,
  TOKEN_MINT_MASK,
  TOKEN_MELT_MASK,
  NATIVE_TOKEN_UID,
  CREATE_TOKEN_TX_VERSION,
  DEFAULT_TX_VERSION,
  DEFAULT_SIGNAL_BITS,
  BLOCK_VERSION,
  MERGED_MINED_BLOCK_VERSION,
  POA_BLOCK_VERSION,
  ON_CHAIN_BLUEPRINTS_VERSION,
} from '../constants';
import Transaction from '../models/transaction';
import CreateTokenTransaction from '../models/create_token_transaction';
import Input from '../models/input';
import Output from '../models/output';
import Network from '../models/network';
import {
  IBalance,
  IStorage,
  IHistoryTx,
  IDataOutput,
  IDataTx,
  isDataOutputCreateToken,
  IHistoryOutput,
  IUtxoId,
  IInputSignature,
  ITxSignatureData,
  OutputValueType,
  IHistoryInput,
} from '../types';
import Address from '../models/address';
import P2PKH from '../models/p2pkh';
import P2SH from '../models/p2sh';
import ScriptData from '../models/script_data';
import helpers from './helpers';
import { getAddressType, getAddressFromPubkey } from './address';
import txApi from '../api/txApi';
import { FullNodeTxApiResponse, transactionApiSchema } from '../api/schemas/txApi';
import tokenUtils from './tokens';
import OnChainBlueprint from '../nano_contracts/on_chain_blueprint';

const transaction = {
  /**
   * Return if a tx is a block or not.
   *
   * @param {Pick<IHistoryTx, 'version'>} tx - Transaction to check
   * @returns {boolean}
   */
  isBlock(tx: Pick<IHistoryTx, 'version'>): boolean {
    return (
      tx.version === BLOCK_VERSION ||
      tx.version === MERGED_MINED_BLOCK_VERSION ||
      tx.version === POA_BLOCK_VERSION
    );
  },

  /**
   * Check if the output is an authority output
   *
   * @param {Pick<HistoryTransactionOutput, 'token_data'>} output An output with the token_data field
   * @returns {boolean} If the output is an authority output
   */
  isAuthorityOutput(output: Pick<HistoryTransactionOutput, 'token_data'>): boolean {
    return (output.token_data & TOKEN_AUTHORITY_MASK) > 0;
  },

  /**
   * Check if the output is a mint authority output
   *
   * @param {Pick<HistoryTransactionOutput, 'token_data'|'value'>} output An output with the token_data and value fields
   * @returns {boolean} If the output is a mint authority output
   */
  isMint(output: Pick<HistoryTransactionOutput, 'token_data' | 'value'>): boolean {
    return this.isAuthorityOutput(output) && (output.value & TOKEN_MINT_MASK) > 0;
  },

  /**
   * Check if the output is a melt authority output
   *
   * @param {Pick<HistoryTransactionOutput, 'token_data'|'value'>} output An output with the token_data and value fields
   * @returns {boolean} If the output is a melt authority output
   */
  isMelt(output: Pick<HistoryTransactionOutput, 'token_data' | 'value'>): boolean {
    return this.isAuthorityOutput(output) && (output.value & TOKEN_MELT_MASK) > 0;
  },

  /**
   * Check if the utxo is locked
   *
   * @param {Pick<HistoryTransactionOutput, 'decoded'>} output The output to check
   * @param {{refTs: number|undefined}} options Use these values as reference to check if the output is locked
   * @returns {boolean} Wheather the output is locked or not
   */
  isOutputLocked(
    output: Pick<HistoryTransactionOutput, 'decoded'>,
    options: { refTs?: number } = {}
  ): boolean {
    // XXX: check reward lock: requires blockHeight, bestBlockHeight and reward_spend_min_blocks
    const refTs = options.refTs || Math.floor(Date.now() / 1000);
    return (
      output.decoded.timelock !== undefined &&
      output.decoded.timelock !== null &&
      refTs < output.decoded.timelock
    );
  },

  /**
   * Check if an output in the given conditions would be height locked (or under reward lock)
   *
   * @param {number|undefined|null} blockHeight The height of the block
   * @param {number|undefined|null} currentHeight The height of the network
   * @param {number|undefined|null} rewardLock The reward lock of the network
   *
   * @returns {boolean} If the output is heightlocked
   */
  isHeightLocked(
    blockHeight: number | undefined | null,
    currentHeight: number | undefined | null,
    rewardLock: number | undefined | null
  ): boolean {
    if (!(blockHeight && currentHeight && rewardLock)) {
      // We do not have the details needed to consider this as locked
      return false;
    }

    // Heighlocked when current height is lower than block height + reward_spend_min_blocks of the network
    return currentHeight < blockHeight + rewardLock;
  },

  /**
   * Get the signature from the dataToSignHash for a private key
   *
   * @param {Buffer} dataToSignHash hash of a transaction's dataToSign.
   * @param {PrivateKey} privateKey Signing key.
   *
   * @returns {Buffer}
   *
   * @memberof transaction
   * @inner
   */
  getSignature(dataToSignHash: Buffer, privateKey: PrivateKey): Buffer {
    const signature = cryptoBL.ECDSA.sign(dataToSignHash, privateKey).set({
      nhashtype: cryptoBL.Signature.SIGHASH_ALL,
    });
    return signature.toDER();
  },

  /**
   * Get the signatures for a transaction
   * @param tx Transaction to sign
   * @param storage Storage of the wallet
   * @param pinCode Pin to unlock the mainKey for signatures
   */
  async getSignatureForTx(
    tx: Transaction,
    storage: IStorage,
    pinCode: string
  ): Promise<ITxSignatureData> {
    const xprivstr = await storage.getMainXPrivKey(pinCode);
    const xprivkey = HDPrivateKey.fromString(xprivstr);
    const dataToSignHash = tx.getDataToSignHash();
    const signatures: IInputSignature[] = [];
    let ncCallerSignature: Buffer | null = null;

    for await (const { tx: spentTx, input, index: inputIndex } of storage.getSpentTxs(tx.inputs)) {
      if (input.data) {
        // This input is already signed
        continue;
      }

      const spentOut = spentTx.outputs[input.index];
      if (!spentOut.decoded.address) {
        // This is not a wallet output
        continue;
      }
      const addressInfo = await storage.getAddressInfo(spentOut.decoded.address);
      if (!addressInfo) {
        // Not a wallet address
        continue;
      }
      const xpriv = xprivkey.deriveNonCompliantChild(addressInfo.bip32AddressIndex);
      signatures.push({
        inputIndex,
        addressIndex: addressInfo.bip32AddressIndex,
        signature: this.getSignature(dataToSignHash, xpriv.privateKey),
        pubkey: xpriv.publicKey.toDER(),
      });
    }

    let address: Address | null = null;

    if (tx.isNanoContract()) {
      address = this.getNanoContractCaller(tx);
    }

    if (tx.version === ON_CHAIN_BLUEPRINTS_VERSION) {
      // Get pubkey from ocb tx
      const { pubkey } = tx as OnChainBlueprint;
      address = getAddressFromPubkey(pubkey.toString('hex'), storage.config.getNetwork());
    }

    if (address) {
      const addressInfo = await storage.getAddressInfo(address.base58);
      if (!addressInfo) {
        throw new Error('No address info found');
      }
      const xpriv = xprivkey.deriveNonCompliantChild(addressInfo.bip32AddressIndex);

      if (tx.isNanoContract()) {
        // Nano contract
        const signature = this.getSignature(dataToSignHash, xpriv.privateKey);
        ncCallerSignature = this.createInputData(signature, xpriv.publicKey.toDER());
      } else {
        // On-chain blueprint
        ncCallerSignature = this.getSignature(dataToSignHash, xpriv.privateKey);
      }
    }

    return {
      inputSignatures: signatures,
      ncCallerSignature,
    };
  },

  /**
   * Gets the pubkey of the nano header from a tx.
   *
   * Returns null if it's not a nano tx.
   *
   * @param tx - The transaction to try to get the nano pubkey from
   */
  getNanoContractCaller(tx: Transaction): Address | null {
    if (tx.isNanoContract()) {
      // Get pubkey from nano header
      const nanoHeader = tx.getNanoHeaders()[0];
      // XXX this code won't work if we have more than one
      // nano header for the same tx in the future
      return nanoHeader.address;
    }

    return null;
  },

  /**
   * Signs a transaction using the provided storage and pin code.
   *
   * Warning: This function will mutate the transaction parameter
   *
   * @param tx - The transaction to be signed.
   * @param storage - The storage of the target wallet.
   * @param pinCode - The pin code used for retrieving signatures.
   * @returns The transaction object updated with the signatures.
   */
  async signTransaction(tx: Transaction, storage: IStorage, pinCode: string): Promise<Transaction> {
    const signatures = await storage.getTxSignatures(tx, pinCode);
    for (const sigData of signatures.inputSignatures) {
      const input = tx.inputs[sigData.inputIndex];
      const inputData = this.createInputData(sigData.signature, sigData.pubkey);
      input.setData(inputData);
    }

    if (tx.isNanoContract()) {
      // Store signature in nano header
      const nanoHeaders = tx.getNanoHeaders();
      for (const nanoHeader of nanoHeaders) {
        nanoHeader.script = signatures.ncCallerSignature;
      }
    }

    if (tx.version === ON_CHAIN_BLUEPRINTS_VERSION) {
      // eslint-disable-next-line no-param-reassign
      (tx as OnChainBlueprint).signature = signatures.ncCallerSignature;
    }
    return tx;
  },

  /**
   * Select best utxos with the algorithm described below. This method expects the utxos to be sorted by greatest value
   *
   * 1. If we have a single utxo capable of handle the full amount requested,
   * we return the utxo with smaller amount among the ones that have an amount bigger than the requested
   * 2. Otherwise we reverse sort the utxos by amount and select the utxos in order until the full amount is fulfilled.
   *
   * @memberof transaction
   * @inner
   */
  selectUtxos(
    utxos: Utxo[],
    totalAmount: OutputValueType
  ): { utxos: Utxo[]; changeAmount: OutputValueType } {
    if (totalAmount <= 0) {
      throw new UtxoError('Total amount must be a positive integer.');
    }

    if (utxos.length === 0) {
      throw new UtxoError("Don't have enough utxos to fill total amount.");
    }

    let utxosToUse: Utxo[] = [];
    let filledAmount = 0n;
    for (const utxo of utxos) {
      if (utxo.value >= totalAmount) {
        utxosToUse = [utxo];
        filledAmount = utxo.value;
      } else {
        if (filledAmount >= totalAmount) {
          break;
        }
        filledAmount += utxo.value;
        utxosToUse.push(utxo);
      }
    }
    if (filledAmount < totalAmount) {
      throw new UtxoError("Don't have enough utxos to fill total amount.");
    }

    return {
      utxos: utxosToUse,
      changeAmount: filledAmount - totalAmount,
    };
  },

  /**
   * Convert an output from the history of transactions to an Utxo.
   *
   * @param {string} txId The transaction this output belongs to.
   * @param {number} index The output index on the original transaction.
   * @param {HistoryTransactionOutput} txout output from the transaction history.
   * @param {Object} [options]
   * @param {string} [options.addressPath=''] utxo address bip32 path
   *
   * @returns {Utxo}
   *
   * @memberof transaction
   */
  utxoFromHistoryOutput(
    txId: string,
    index: number,
    txout: HistoryTransactionOutput,
    { addressPath = '' }: { addressPath?: string }
  ): Utxo {
    const isAuthority = this.isAuthorityOutput(txout);

    return {
      txId,
      index,
      addressPath,
      address: (txout.decoded && txout.decoded.address) || '',
      timelock: (txout.decoded && txout.decoded.timelock) || null,
      tokenId: txout.token,
      value: txout.value,
      authorities: isAuthority ? txout.value : 0n,
      heightlock: null, // not enough info to determine this.
      locked: false,
    };
  },

  /**
   * Calculate the balance of a transaction
   *
   * @param tx Transaction to get balance from
   * @param storage Storage to get metadata from
   * @returns {Promise<Record<string, IBalance>>} Balance of the transaction
   */
  async getTxBalance(tx: IHistoryTx, storage: IStorage): Promise<Record<string, IBalance>> {
    const balance: Record<string, IBalance> = {};
    const getEmptyBalance = (): IBalance => ({
      tokens: { locked: 0n, unlocked: 0n },
      authorities: {
        mint: { locked: 0n, unlocked: 0n },
        melt: { locked: 0n, unlocked: 0n },
      },
    });

    const nowTs = Math.floor(Date.now() / 1000);
    const nowHeight = await storage.getCurrentHeight();
    const rewardLock = storage.version?.reward_spend_min_blocks;
    const isHeightLocked = this.isHeightLocked(tx.height, nowHeight, rewardLock);

    for (const output of tx.outputs) {
      const { address } = output.decoded;
      if (!(address && (await storage.isAddressMine(address)))) {
        continue;
      }
      if (!balance[output.token]) {
        balance[output.token] = getEmptyBalance();
      }
      const isLocked = this.isOutputLocked(output, { refTs: nowTs }) || isHeightLocked;

      if (this.isAuthorityOutput(output)) {
        if (this.isMint(output)) {
          if (isLocked) {
            balance[output.token].authorities.mint.locked += 1n;
          } else {
            balance[output.token].authorities.mint.unlocked += 1n;
          }
        }
        if (this.isMelt(output)) {
          if (isLocked) {
            balance[output.token].authorities.melt.locked += 1n;
          } else {
            balance[output.token].authorities.melt.unlocked += 1n;
          }
        }
      } else if (isLocked) {
        balance[output.token].tokens.locked += output.value;
      } else {
        balance[output.token].tokens.unlocked += output.value;
      }
    }

    for (const input of tx.inputs) {
      const { address } = input.decoded;
      if (!(address && (await storage.isAddressMine(address)))) {
        continue;
      }
      if (!balance[input.token]) {
        balance[input.token] = getEmptyBalance();
      }

      if (this.isAuthorityOutput(input)) {
        if (this.isMint(input)) {
          balance[input.token].authorities.mint.unlocked -= 1n;
        }
        if (this.isMelt(input)) {
          balance[input.token].authorities.melt.unlocked -= 1n;
        }
      } else {
        balance[input.token].tokens.unlocked -= input.value;
      }
    }

    return balance;
  },

  /**
   * Calculate the token balance of a transaction, including authorities, for a single token.
   * The balance will contain funds, mint and melt properties.
   * The funds property will contain the amount of tokens.
   * The mint and melt properties will contain the amount of mint and melt authorities.
   *
   * We will consider the balance from the inputs as negative and the outputs as positive
   * So that if the balance if positive we have a surplus of the token in the outputs.
   * If the balance is negative we have a deficit of the token in the outputs.
   *
   * Normal txs can be "unbalanced" when minting or melting tokens, but since we are not required to add the minted tokens on the inputs
   * Or conversely add the melted tokens on the outputs, we will ignore minted/melted funds.
   *
   * @param {string} token The token we want to calculate the balance.
   * @param {IDataTx} tx The transaction we want to calculate the balance.
   * @returns {Promise<Record<'funds'|'mint'|'melt', number>>} The balance of the given token on the transaction.
   */
  async calculateTxBalanceToFillTx(
    token: string,
    tx: IDataTx
  ): Promise<Record<'funds' | 'mint' | 'melt', OutputValueType>> {
    const balance = { funds: 0n, mint: 0n, melt: 0n };
    for (const output of tx.outputs) {
      if (isDataOutputCreateToken(output)) {
        // This is a mint output
        // Since we are creating this token on the transaction we do not need to add inputs to match the balance
        // So we will skip this output.
        continue;
      }

      if (output.token !== token) continue;

      if (output.authorities > 0) {
        // Authority output, add to mint or melt balance
        // Check for MINT authority
        if ((output.authorities & 1n) > 0) {
          balance.mint += 1n;
        }
        // Check for MELT authority
        if ((output.authorities & 2n) > 0) {
          balance.melt += 1n;
        }
      } else {
        // Fund output, add to the amount balance
        balance.funds += output.value;
      }
    }

    for (const input of tx.inputs) {
      if (input.token !== token) continue;

      if (input.authorities > 0) {
        // Authority input, remove from mint or melt balance
        // Check for MINT authority
        if ((input.authorities & 1n) > 0) {
          balance.mint -= 1n;
        }
        // Check for MELT authority
        if ((input.authorities & 2n) > 0) {
          balance.melt -= 1n;
        }
      } else {
        // Fund input, remove from the amount balance
        balance.funds -= input.value;
      }
    }

    return balance;
  },

  /**
   * Get the token_data for a given output
   *
   * @param {IDataOutput} output output data
   * @param {string[]} tokens List of tokens in the transaction
   * @returns {number} Calculated TokenData for the output token
   */
  getTokenDataFromOutput(output: IDataOutput, tokens: string[]): number {
    if (isDataOutputCreateToken(output)) {
      // This output does not contain the token since it will be creating
      // But knowing this, we also know the token index of it.
      if (output.authorities === 0n) {
        return 1;
      }
      return 1 | TOKEN_AUTHORITY_MASK;
    }

    // Token index of HTR is 0 and if it is a custom token it is its index on tokensWithoutHathor + 1
    const tokensWithoutHathor = tokens.filter(token => token !== NATIVE_TOKEN_UID);
    const tokenIndex = tokensWithoutHathor.indexOf(output.token) + 1;
    if (output.authorities === 0n) {
      return tokenIndex;
    }
    return tokenIndex | TOKEN_AUTHORITY_MASK;
  },

  /**
   * Create output script
   *
   * @param {IDataOutput} output Output with data to create the script
   *
   * @throws {AddressError} If the address is invalid
   *
   * @return {Buffer} Output script
   */
  createOutputScript(output: IDataOutput, network: Network): Buffer {
    if (output.type === 'data') {
      // Data script for NFT
      const scriptData = new ScriptData(output.data);
      return scriptData.createScript();
    }
    if (getAddressType(output.address, network) === 'p2sh') {
      // P2SH
      const address = new Address(output.address, { network });
      // This will throw AddressError in case the address is invalid
      address.validateAddress();
      const p2sh = new P2SH(address, { timelock: output.timelock });
      return p2sh.createScript();
    }
    if (getAddressType(output.address, network) === 'p2pkh') {
      // P2PKH
      const address = new Address(output.address, { network });
      // This will throw AddressError in case the address is invalid
      address.validateAddress();
      const p2pkh = new P2PKH(address, { timelock: output.timelock });
      return p2pkh.createScript();
    }
    throw new Error('Invalid output for creating script.');
  },

  /**
   * Create a Transaction instance from tx data.
   *
   * @param {IDataTx} txData Tx data to create the transaction
   * @param {Network} network network to use
   * @returns {Transaction|CreateTokenTransaction}
   */
  createTransactionFromData(
    txData: IDataTx,
    network: Network
  ): Transaction | CreateTokenTransaction {
    const inputs: Input[] = txData.inputs.map(input => {
      const inputObj = new Input(input.txId, input.index);
      if (input.data) {
        inputObj.setData(Buffer.from(input.data, 'hex'));
      }
      return inputObj;
    });
    const outputs: Output[] = txData.outputs.map(output => {
      const script = this.createOutputScript(output, network);
      const tokenData = this.getTokenDataFromOutput(output, txData.tokens);
      return new Output(output.value, script, { tokenData });
    });
    const options = {
      signalBits: txData.signalBits === undefined ? DEFAULT_SIGNAL_BITS : txData.signalBits,
      version: txData.version === undefined ? DEFAULT_TX_VERSION : txData.version,
      weight: txData.weight || 0,
      nonce: txData.nonce || 0,
      timestamp: txData.timestamp || null,
      parents: txData.parents || [],
      tokens: txData.tokens || [],
    };
    if (options.version === CREATE_TOKEN_TX_VERSION) {
      return new CreateTokenTransaction(txData.name!, txData.symbol!, inputs, outputs, options);
    }
    if (options.version === DEFAULT_TX_VERSION) {
      return new Transaction(inputs, outputs, options);
    }
    throw new ParseError('Invalid transaction version.');
  },

  /**
   * Convert a Transaction instance to the history object.
   * May call the fullnode transaction api to get information on the tx spent
   * by the inputs.
   */
  async convertTransactionToHistoryTx(
    tx: Transaction | CreateTokenTransaction | OnChainBlueprint,
    storage: IStorage
  ): Promise<IHistoryTx> {
    if (!tx.hash) {
      throw new Error('To be a history tx a calculated hash is required');
    }

    const inputs: IHistoryInput[] = [];
    const outputs: IHistoryOutput[] = [];
    const txCache: Record<string, IHistoryTx> = {};

    for (const input of tx.inputs) {
      let spentTx = await storage.getTx(input.hash);
      if (!spentTx) {
        // Try cache first
        if (txCache[input.hash]) {
          spentTx = txCache[input.hash];
        } else {
          // Get from API
          spentTx = await new Promise((resolve, reject) => {
            txApi
              .getTransaction(input.hash, (response: FullNodeTxApiResponse) => {
                if (!response.success) {
                  return reject(new Error(response.message ?? ''));
                }

                if (input.index >= response.tx.outputs.length) {
                  return reject(new Error('Index outside of tx output array bounds'));
                }
                return resolve(this.convertFullNodeTxToHistoryTx(response));
              })
              .catch(err => reject(err));
          });

          if (!spentTx) {
            // This should not happen since any errors should be treated already.
            // This if statement is to ensure typing since spentTx starts as IHistoryTx | null.
            throw new Error('Could not find the spent transaction');
          }
          // Update cache
          txCache[input.hash] = cloneDeep(spentTx);
        }
      }

      if (input.index >= spentTx.outputs.length) {
        throw new Error(
          `Index (${input.index}) outside of transaction output array bounds (${spentTx.outputs.length})`
        );
      }

      const spentOut = spentTx.outputs[input.index];
      inputs.push({
        tx_id: input.hash,
        index: input.index,
        script: spentOut.script,
        decoded: spentOut.decoded,
        token_data: spentOut.token_data,
        token: spentOut.token,
        value: spentOut.value,
      });
    }

    const tokensArray =
      tx.version === CREATE_TOKEN_TX_VERSION
        ? [{ uid: tx.hash }]
        : tx.tokens.map(tk => ({ uid: tk }));
    for (const output of tx.outputs) {
      const script = output.parseScript(storage.config.getNetwork());
      const out = {
        value: output.value,
        token_data: output.tokenData,
        script: output.script.toString('hex'),
        decoded: script?.toData() ?? {},
        spent_by: null, // Cannot reconstruct this field
      };
      outputs.push(this.hydrateIOWithToken(out, tokensArray));
    }

    const histTx: IHistoryTx = {
      tx_id: tx.hash,
      signalBits: tx.signalBits,
      version: tx.version,
      weight: tx.weight,
      timestamp: tx.timestamp ?? 0,
      is_voided: false,
      nonce: tx.nonce,
      inputs,
      outputs,
      parents: tx.parents,
      tokens: tx.tokens,
      // The missing fields below are metadata that cannot be inferred from the
      // Transaction instance.
      // height, first_block
    };

    if (tx.version === CREATE_TOKEN_TX_VERSION) {
      histTx.token_name = (tx as CreateTokenTransaction).name;
      histTx.token_symbol = (tx as CreateTokenTransaction).symbol;
    }

    if (tx.version === ON_CHAIN_BLUEPRINTS_VERSION) {
      histTx.nc_pubkey = (tx as OnChainBlueprint).pubkey.toString('hex');
    }

    if (tx.isNanoContract()) {
      const nanoHeader = tx.getNanoHeaders()[0];
      // XXX this code won't work if we have more than one
      // nano header for the same tx in the future
      histTx.nc_id = nanoHeader.id;
      histTx.nc_method = nanoHeader.method;
      histTx.nc_args = nanoHeader.args.toString('hex');
      histTx.nc_address = nanoHeader.address!.base58;
      // XXX: should we build nc_context from nanoHeader information?
      // Cannot fetch histTx.nc_blueprint_id with the current data
    }

    return histTx;
  },

  /**
   * Prepare a Transaction instance from the transaction data and storage
   *
   * @param tx tx data to be prepared
   * @param pinCode pin to unlock the mainKey for signatures
   * @param storage Storage to get the mainKey
   * @param {Object} [options]
   * @param {boolean} [options.signTx=true] sign transaction instance
   * @returns {Promise<Transaction|CreateTokenTransaction>} Prepared transaction
   */
  async prepareTransaction(
    txData: IDataTx,
    pinCode: string,
    storage: IStorage,
    options?: { signTx?: boolean }
  ): Promise<Transaction | CreateTokenTransaction> {
    const newOptions = {
      signTx: true,
      ...options,
    };
    const network = storage.config.getNetwork();
    const tx = this.createTransactionFromData(txData, network);
    if (newOptions.signTx) {
      await this.signTransaction(tx, storage, pinCode);
    }
    tx.prepareToSend();

    return tx;
  },

  /**
   * Create P2PKH input data
   *
   * @param {Buffer} signature Input signature
   * @param {Buffer} publicKey Input public key
   * @returns {Buffer} Input data
   */
  createInputData(signature: Buffer, publicKey: Buffer): Buffer {
    const arr = [];
    helpers.pushDataToStack(arr, signature);
    helpers.pushDataToStack(arr, publicKey);
    return Buffer.concat(arr);
  },

  /**
   * Calculate the authorities data for an output
   *
   * @param output History output
   * @returns {OutputValueType} Authorities from output
   */
  authoritiesFromOutput(output: Pick<IHistoryOutput, 'token_data' | 'value'>): OutputValueType {
    let authorities = 0n;
    if (this.isMint(output)) {
      authorities |= TOKEN_MINT_MASK;
    }
    if (this.isMelt(output)) {
      authorities |= TOKEN_MELT_MASK;
    }
    return authorities;
  },

  /**
   * Check if an utxo is available to be spent.
   *
   * @param {IUtxoId} utxo Utxo to check if we can use it
   * @param {IStorage} storage storage that may have the tx
   * @returns {Promise<boolean>}
   */
  async canUseUtxo(utxo: IUtxoId, storage: IStorage): Promise<boolean> {
    const currentHeight = await storage.getCurrentHeight();
    const rewardLock = storage.version?.reward_spend_min_blocks || 0;
    const nowTs = Math.floor(Date.now() / 1000);
    const tx = await storage.getTx(utxo.txId);
    if (tx === null || (tx.outputs && tx.outputs.length <= utxo.index)) {
      // This is not our utxo, so we cannot spend it.
      return false;
    }
    const output = tx.outputs[utxo.index];
    const isTimelocked = this.isOutputLocked(output, { refTs: nowTs });
    const isHeightLocked = this.isHeightLocked(tx.height, currentHeight, rewardLock);
    const isSelectedAsInput = await storage.isUtxoSelectedAsInput(utxo);

    // If utxo is selected as input on another tx we cannot use it
    // If utxo is timelocked we cannot use it
    // If utxo is height locked we cannot use it
    return !(isSelectedAsInput || isTimelocked || isHeightLocked);
  },

  /**
   * Get object type (Transaction or Block)
   *
   * @param {Pick<IHistoryTx, 'version'>} tx Object to get the type
   *
   * @return {string} Type of the object
   *
   * @memberof transaction
   * @inner
   */
  getTxType(tx: Pick<IHistoryTx, 'version'>): string {
    if (this.isBlock(tx)) {
      if (tx.version === BLOCK_VERSION) {
        return 'Block';
      }
      if (tx.version === MERGED_MINED_BLOCK_VERSION) {
        return 'Merged Mining Block';
      }
      if (tx.version === POA_BLOCK_VERSION) {
        return 'Proof-of-Authority Block';
      }
    } else {
      if (tx.version === DEFAULT_TX_VERSION) {
        return 'Transaction';
      }
      if (tx.version === CREATE_TOKEN_TX_VERSION) {
        return 'Create Token Transaction';
      }
      if (tx.version === ON_CHAIN_BLUEPRINTS_VERSION) {
        return 'On-Chain Blueprint';
      }
    }

    // If there is no match
    return 'Unknown';
  },

  /**
   * From a `token_data` and the tokens array we can add the token uid to the input/output.
   */
  hydrateIOWithToken<IO extends { token_data: number }, T extends { uid: string }>(
    io: IO,
    tokens: T[]
  ): IO & { token: string } {
    const { token_data } = io;
    if (token_data === 0) {
      return {
        ...io,
        token: NATIVE_TOKEN_UID,
      };
    }

    const tokenIdx = tokenUtils.getTokenIndexFromData(token_data);
    const tokenUid = tokens[tokenIdx - 1]?.uid;
    if (!tokenUid) {
      throw new Error(`Invalid token_data ${token_data}, token not found in tokens list`);
    }

    return { ...io, token: tokenUid };
  },

  /**
   * Convert the transaction type from the tx api to the IHistoryTx which is
   * the interface of transactions received via websocket.
   */
  convertFullNodeTxToHistoryTx(txResponse: z.infer<typeof transactionApiSchema>): IHistoryTx {
    if (txResponse.success === false) {
      throw new Error(`trying to convert a tx from a failed api request: ${txResponse.message}`);
    }
    const { tx, meta } = txResponse;
    const inputs: IHistoryInput[] = tx.inputs.map(i => {
      const hydratedInput = this.hydrateIOWithToken(i, tx.tokens);
      return hydratedInput as IHistoryInput;
    });
    const outputs: IHistoryOutput[] = tx.outputs.map(o => {
      const hydratedoutput = this.hydrateIOWithToken(o, tx.tokens);
      return hydratedoutput as IHistoryOutput;
    });
    const histTx: IHistoryTx = {
      tx_id: tx.hash,
      signalBits: tx.signal_bits,
      version: tx.version,
      weight: tx.weight,
      timestamp: tx.timestamp,
      is_voided: meta.voided_by.length > 0,
      nonce: Number.parseInt(tx.nonce ?? '0', 10),
      inputs,
      outputs,
      parents: tx.parents,
      token_name: tx.token_name ?? undefined,
      token_symbol: tx.token_symbol ?? undefined,
      tokens: tx.tokens.map(token => token.uid),
      height: meta.height,
      first_block: meta.first_block,
    };

    if (tx.nc_id) histTx.nc_id = tx.nc_id;
    if (tx.nc_blueprint_id) histTx.nc_blueprint_id = tx.nc_blueprint_id;
    if (tx.nc_method) histTx.nc_method = tx.nc_method;
    if (tx.nc_args) histTx.nc_args = tx.nc_args;
    if (tx.nc_address) histTx.nc_address = tx.nc_address;
    if (tx.nc_context) histTx.nc_context = tx.nc_context;
    if (tx.nc_pubkey) histTx.nc_pubkey = tx.nc_pubkey;

    return histTx;
  },
};

export default transaction;

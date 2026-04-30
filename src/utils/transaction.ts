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
  ZERO_TWEAK,
} from '../constants';
import Transaction from '../models/transaction';
import CreateTokenTransaction from '../models/create_token_transaction';
import Input from '../models/input';
import Output from '../models/output';
import ShieldedOutput from '../models/shielded_output';
import ShieldedOutputsHeader from '../headers/shielded_outputs';
import UnshieldBalanceHeader from '../headers/unshield_balance';
import FeeHeader from '../headers/fee';
import { MintHeader } from '../headers/mint_melt';
import { MeltHeader } from '../headers/melt_header';
import Network from '../models/network';
import {
  IBalance,
  IStorage,
  IHistoryTx,
  IDataOutput,
  IDataTx,
  isDataOutputCreateToken,
  IHistoryOutput,
  IShieldedOutputEntry,
  IUtxoId,
  IInputSignature,
  ITxSignatureData,
  OutputValueType,
  IHistoryInput,
  IHistoryShieldedOutput,
  AuthorityType,
} from '../types';
import { ShieldedOutputMode } from '../shielded/types';
import Address from '../models/address';
import P2PKH from '../models/p2pkh';
import P2SH from '../models/p2sh';
import ScriptData from '../models/script_data';
import { parseScript } from './scripts';
import helpers from './helpers';
import { getAddressFromPubkey } from './address';
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
   * Check if an output entry from IHistoryTx.outputs is a shielded output appended
   * by the fullnode's to_json_extended(). These entries have type='shielded' and lack
   * the 'value' and 'token' fields that transparent outputs have.
   * Shielded outputs are processed separately via processShieldedOutputs().
   */
  isShieldedOutputEntry(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    output: IHistoryOutput | Record<string, any>
  ): output is IShieldedOutputEntry {
    return output != null && (output as { type?: string }).type === 'shielded';
  },

  /**
   * Shielded inputs arrive from the fullnode inline in tx.inputs[] with
   * type='shielded' and only a commitment + range_proof — none of the
   * token_data/decoded/tx_id fields that transparent inputs carry. Call sites
   * that read those fields must filter these out first.
   */
  isShieldedInputEntry(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: Record<string, any>
  ): boolean {
    return input != null && (input as { type?: string }).type === 'shielded';
  },

  /**
   * Normalize a transaction's outputs by extracting shielded entries from outputs[]
   * into a separate shielded_outputs[] array AND ensuring base64-encoded fields are
   * converted to hex. Mutates the tx in place.
   *
   * This function is idempotent: running it multiple times on the same tx is a
   * no-op on the second pass because the base64→hex conversion of an already-hex
   * string is not valid base64 and would be detected. For that reason we only
   * convert fields that still look like base64 (contain characters outside the
   * hex alphabet).
   *
   * Two delivery shapes from the fullnode are handled:
   *   (a) shielded entries nested inside outputs[] with type='shielded' — the
   *       legacy wire form. Entries are extracted and base64 fields converted.
   *   (b) shielded entries in a separate shielded_outputs[] field — what most
   *       recent fullnodes send. No extraction needed, but base64 fields in
   *       range_proof / surjection_proof / script must still be converted to
   *       hex so downstream decryption (which uses Buffer.from(value, 'hex'))
   *       parses them correctly.
   *
   * Without this coverage of case (b), shielded outputs delivered by the
   * websocket real-time path were left with base64 range_proof strings, which
   * Buffer.from(..., 'hex') parses as garbage — causing the native rewind to
   * throw "asset commitment verification failed" and the per-tx balance to
   * read as -input with no credit for the decoded shielded outputs.
   */
  normalizeShieldedOutputs(tx: IHistoryTx): void {
    if (!tx.shielded_outputs) {
      // Case (a): nested in outputs[]. Extract and convert.
      const shieldedEntries: IHistoryShieldedOutput[] = [];
      const transparentOutputs: IHistoryOutput[] = [];
      for (const output of tx.outputs) {
        if (this.isShieldedOutputEntry(output)) {
          shieldedEntries.push({
            mode: output.asset_commitment
              ? ShieldedOutputMode.FULLY_SHIELDED
              : ShieldedOutputMode.AMOUNT_SHIELDED,
            commitment: this.ensureHex(output.commitment),
            range_proof: this.ensureHex(output.range_proof),
            script: this.ensureHex(output.script),
            token_data: output.token_data,
            ephemeral_pubkey: this.ensureHex(output.ephemeral_pubkey),
            decoded: output.decoded,
            asset_commitment: output.asset_commitment
              ? this.ensureHex(output.asset_commitment)
              : undefined,
            surjection_proof: output.surjection_proof
              ? this.ensureHex(output.surjection_proof)
              : undefined,
            // hathor-core's `_shielded_output_to_json` (base_transaction.py)
            // sets spent_by on shielded entries the same way it does for
            // transparent outputs. Preserve it through the normalize so the
            // wallet can use the canonical `output.spent_by !== null` check
            // for both kinds of outputs.
            spent_by: output.spent_by ?? null,
          });
        } else {
          transparentOutputs.push(output);
        }
      }
      if (shieldedEntries.length > 0) {
        // eslint-disable-next-line no-param-reassign
        tx.shielded_outputs = shieldedEntries;
        // eslint-disable-next-line no-param-reassign
        tx.outputs = transparentOutputs;
      }
      return;
    }

    // Case (b): shielded_outputs already populated. Convert any base64 fields
    // to hex in place.
    for (const so of tx.shielded_outputs) {
      // eslint-disable-next-line no-param-reassign
      so.commitment = this.ensureHex(so.commitment);
      // eslint-disable-next-line no-param-reassign
      so.range_proof = this.ensureHex(so.range_proof);
      // eslint-disable-next-line no-param-reassign
      so.script = this.ensureHex(so.script);
      // eslint-disable-next-line no-param-reassign
      so.ephemeral_pubkey = this.ensureHex(so.ephemeral_pubkey);
      if (so.asset_commitment) {
        // eslint-disable-next-line no-param-reassign
        so.asset_commitment = this.ensureHex(so.asset_commitment);
      }
      if (so.surjection_proof) {
        // eslint-disable-next-line no-param-reassign
        so.surjection_proof = this.ensureHex(so.surjection_proof);
      }
    }
  },

  /**
   * Return a hex-encoded copy of the input. If the input is already hex, it is
   * returned unchanged. If it looks like base64 (contains characters outside
   * 0-9a-fA-F or is padded with '='), it is decoded from base64 and re-encoded
   * as hex. Idempotent for valid hex strings.
   *
   * Detection is character-set based: hex uses only [0-9a-fA-F]. Base64 uses
   * [A-Za-z0-9+/=]. Any character outside the hex alphabet (e.g. '+', '/', '=',
   * or lowercase letters g-z, or uppercase G-Z) means the string is base64.
   */
  ensureHex(value: string): string {
    if (value.length === 0) return value;
    // Fast path: plain hex strings are the expected already-normalized case.
    if (/^[0-9a-fA-F]+$/.test(value)) return value;
    // Anything else is treated as base64.
    return Buffer.from(value, 'base64').toString('hex');
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

    // Lazily load the spend key chain for shielded-spend addresses
    let spendXprivkey: typeof xprivkey | null = null;

    const dataToSignHash = tx.getDataToSignHash();
    const signatures: IInputSignature[] = [];
    let ncCallerSignature: Buffer | null = null;

    for await (const { tx: spentTx, input, index: inputIndex } of storage.getSpentTxs(tx.inputs)) {
      if (input.data) {
        // This input is already signed
        continue;
      }

      // For shielded inputs, input.index points beyond spentTx.outputs (which
      // only holds transparent + decoded-shielded entries). Fall back to the
      // stored UTXO record, which carries `address` directly.
      let spentOut:
        | { decoded?: { address?: string }; script?: string; value?: bigint }
        | undefined = spentTx.outputs[input.index];
      if (!spentOut) {
        const utxo = await storage.getUtxo({ txId: input.hash, index: input.index });
        if (!utxo) {
          // Truly unknown — caller will surface this as an error elsewhere.
          continue;
        }
        spentOut = { decoded: { address: utxo.address }, value: utxo.value };
      }
      if (!spentOut.decoded?.address) {
        // This is not a wallet output
        continue;
      }
      const addressInfo = await storage.getAddressInfo(spentOut.decoded.address);
      if (!addressInfo) {
        // Not a wallet address
        continue;
      }

      let derivedKey;
      if (addressInfo.addressType === 'shielded-spend') {
        // Use spend key chain (m/44'/280'/2'/0) for shielded UTXO inputs
        if (!spendXprivkey) {
          const spendXprivStr = await storage.getSpendXPrivKey(pinCode);
          spendXprivkey = HDPrivateKey.fromString(spendXprivStr);
        }
        derivedKey = spendXprivkey.deriveNonCompliantChild(addressInfo.bip32AddressIndex);
      } else {
        // Use legacy key chain (m/44'/280'/0'/0) for regular addresses
        derivedKey = xprivkey.deriveNonCompliantChild(addressInfo.bip32AddressIndex);
      }

      signatures.push({
        inputIndex,
        addressIndex: addressInfo.bip32AddressIndex,
        signature: this.getSignature(dataToSignHash, derivedKey.privateKey),
        pubkey: derivedKey.publicKey.toDER(),
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
        // The nano contract address or OCB pubkey are not from our wallet.
        return { inputSignatures: signatures, ncCallerSignature };
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

    const changeAmount = filledAmount - totalAmount;

    return {
      utxos: utxosToUse,
      changeAmount,
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
      // Shielded inputs arrive without decoded/value/token (hidden in the
      // commitment on-chain). Recover those fields from the stored origTx's
      // decoded shielded output at input.index so wallet-owned shielded UTXOs
      // are debited correctly.
      let address = input.decoded?.address;
      let inputToken = input.token;
      let inputValue = input.value;
      let inputTokenData = input.token_data;

      if (!address || inputToken === undefined) {
        // Shielded inputs: decoded value/token/address live on the saved UTXO
        // (normalizeShieldedOutputs keeps shielded entries out of tx.outputs).
        const utxo = await storage.getUtxo({ txId: input.tx_id, index: input.index });
        if (!utxo || !utxo.shielded) continue;
        address = utxo.address;
        inputToken = utxo.token;
        inputValue = utxo.value;
        inputTokenData = 0;
      }

      if (!(address && (await storage.isAddressMine(address)))) {
        continue;
      }
      if (!balance[inputToken]) {
        balance[inputToken] = getEmptyBalance();
      }

      if (this.isAuthorityOutput({ token_data: inputTokenData! })) {
        if (this.isMint({ value: inputValue!, token_data: inputTokenData! })) {
          balance[inputToken].authorities.mint.unlocked -= 1n;
        }
        if (this.isMelt({ value: inputValue!, token_data: inputTokenData! })) {
          balance[inputToken].authorities.melt.unlocked -= 1n;
        }
      } else {
        balance[inputToken].tokens.unlocked -= inputValue!;
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
  ): Promise<Record<'funds' | AuthorityType, OutputValueType>> {
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
    const addressObj = new Address(output.address, { network });
    addressObj.validateAddress();
    const addrType = addressObj.getType();
    if (addrType === 'p2sh') {
      const p2sh = new P2SH(addressObj, { timelock: output.timelock });
      return p2sh.createScript();
    }
    if (addrType === 'p2pkh') {
      const p2pkh = new P2PKH(addressObj, { timelock: output.timelock });
      return p2pkh.createScript();
    }
    if (addrType === 'shielded') {
      // Shielded addresses are a recipient-facing encoding of scan + spend
      // public keys. On-chain, the transparent script is the P2PKH derived
      // from the spend pubkey — same convention as createOutputScriptFromAddress.
      const spendAddress = addressObj.getSpendAddress();
      const p2pkh = new P2PKH(spendAddress, { timelock: output.timelock });
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
      headers: txData.headers || [],
    };
    if (options.version === CREATE_TOKEN_TX_VERSION) {
      const createTokenOptions = {
        ...options,
        tokenVersion: txData.tokenVersion,
      };
      const ctTx = new CreateTokenTransaction(
        txData.name!,
        txData.symbol!,
        inputs,
        outputs,
        createTokenOptions
      );
      // Attach shielded-related headers identically to the regular tx
      // branch below so a TCT funded by shielded HTR carries the
      // UnshieldBalanceHeader + MintHeader the fullnode requires
      // (alpha-v3 lifted the TCT-can't-be-shielded restriction).
      this._attachShieldedHeaders(ctTx, txData);
      return ctTx;
    }
    if (options.version === DEFAULT_TX_VERSION) {
      const tx = new Transaction(inputs, outputs, options);
      this._attachShieldedHeaders(tx, txData);
      return tx;
    }
    throw new ParseError('Invalid transaction version.');
  },

  /**
   * Attach the shielded-related headers (ShieldedOutputsHeader,
   * UnshieldBalanceHeader, MintHeader) onto a freshly-built tx based on
   * what `txData` carries. Shared by both regular `Transaction` and
   * `CreateTokenTransaction` paths — alpha-v3 unblocked TCT for shielded
   * inputs so both flows now need the same headers.
   *
   * @param tx The Transaction (or CreateTokenTransaction) to attach to.
   * @param txData The data the tx was built from.
   */
  _attachShieldedHeaders(tx: Transaction | CreateTokenTransaction, txData: IDataTx): void {
    // Populate shielded outputs as a ShieldedOutputsHeader
    if (txData.shieldedOutputs && txData.shieldedOutputs.length > 0) {
      const shieldedModels = txData.shieldedOutputs.map(so => {
        if (!so.commitment || !so.rangeProof || !so.script || !so.ephemeralPubkey) {
          throw new Error(
            'Shielded output missing required crypto fields (commitment, rangeProof, script, ephemeralPubkey)'
          );
        }
        const tokenData = this.getTokenDataFromOutput(
          {
            type: 'p2pkh',
            token: so.token,
            value: so.value,
            authorities: 0n,
            address: so.address,
            timelock: null,
          },
          txData.tokens
        );

        return new ShieldedOutput(
          so.mode,
          so.commitment,
          so.rangeProof,
          tokenData,
          Buffer.from(so.script, 'hex'),
          so.ephemeralPubkey,
          so.assetCommitment,
          so.surjectionProof,
          so.value
        );
      });

      // eslint-disable-next-line no-param-reassign
      tx.shieldedOutputs = shieldedModels;
      tx.headers.push(new ShieldedOutputsHeader(shieldedModels));
    }

    // Attach UnshieldBalanceHeader for pure-unshield txs. The fullnode
    // requires it when a tx has shielded inputs and no shielded outputs
    // (full unshield): the excess scalar closes the Pedersen balance
    // equation. Mutually exclusive with shielded outputs — the caller must
    // not set both, and we assert that here to surface the bug early
    // instead of letting the fullnode reject the tx post-PoW.
    if (txData.excessBlindingFactor) {
      if (txData.shieldedOutputs && txData.shieldedOutputs.length > 0) {
        throw new Error(
          'A transaction cannot carry both shielded outputs and an excess ' +
            'blinding factor (UnshieldBalanceHeader is mutually exclusive with ' +
            'ShieldedOutputsHeader).'
        );
      }
      tx.headers.push(new UnshieldBalanceHeader(txData.excessBlindingFactor));
    }

    // Mint/Melt headers for shielded txs (alpha-v3 protocol, RFC §4.1).
    // The wallet MUST publicly declare any *real* supply change for a
    // non-HTR token in a shielded tx. "Real" here means an explicit
    // mint or melt authority is being exercised — a simple T→F or F→T
    // shielding move preserves supply (the transparent surplus/deficit
    // is balanced via Pedersen on the shielded side) and MUST NOT
    // declare anything; otherwise the verifier's authority check
    // (`_check_token_permissions`) demands the matching authority
    // input we don't have and rejects with ForbiddenMint/ForbiddenMelt.
    //
    // Detection rule, per non-HTR token in `tokensArray`:
    //   - createToken (CREATE_TOKEN_TX_VERSION): the tx itself
    //     authorizes mint for the new token; declare the positive
    //     transparent delta as MintHeader.
    //   - regular tx: declare MintHeader iff inputs carry a mint
    //     authority for the token AND transparent delta > 0;
    //     symmetric for MeltHeader (melt authority + delta < 0).
    //   - otherwise: no header.
    //
    // Pushed last so the canonical header-id-ascending order holds:
    // Fee(0x11) ≤ Shielded(0x12) ≤ Unshield(0x13) ≤ Mint(0x14) ≤ Melt(0x15).
    const isShieldedTx =
      (txData.shieldedOutputs && txData.shieldedOutputs.length > 0) ||
      !!txData.excessBlindingFactor;
    if (isShieldedTx && !tx.headers.some(h => h instanceof MintHeader || h instanceof MeltHeader)) {
      // For createToken the new token's outputs are
      // `IDataOutputCreateToken` (no `token` field), and tokensArray
      // on-chain is `[tx.hash]`. Use a sentinel locally and remap to
      // tokenIndex=1.
      const NEW_TOKEN_KEY = '__create_token__';
      const isCreateToken = txData.version === CREATE_TOKEN_TX_VERSION;
      const tokensArray: string[] = isCreateToken ? [NEW_TOKEN_KEY] : txData.tokens ?? [];
      // Outputs from `prepareMintTxData` use `IDataOutputCreateToken`
      // (no `token` field) for the minted token in BOTH createToken
      // and mintTokens flows. Resolve "the implicit token" to either
      // the sentinel new-token key (createToken) or the first entry
      // of tokensArray (mintTokens).
      const implicitTokenKey = isCreateToken ? NEW_TOKEN_KEY : tokensArray[0];

      const tokenDelta = new Map<string, bigint>();
      const mintAuthorityTokens = new Set<string>();
      const meltAuthorityTokens = new Set<string>();
      const bumpDelta = (token: string | undefined, delta: bigint) => {
        if (!token) return;
        if (token === NATIVE_TOKEN_UID) return;
        if (tokensArray.indexOf(token) < 0) return;
        tokenDelta.set(token, (tokenDelta.get(token) ?? 0n) + delta);
      };

      // Outputs add to amount; inputs subtract. Both transparent AND
      // shielded sides count: the verifier (`_fold_mint_melt_entry` +
      // `verify_balance` in hathor-core) injects synthetic unblinded
      // `(amount, token)` entries from MeltHeader on the OUTPUT side
      // and from MintHeader on the INPUT side, then sums *all*
      // commitments — including shielded inputs/outputs that contribute
      // `value · H_TOKEN + vbf · G`. So per-token net = total_in −
      // total_out across both sides; positive ⇒ melt, negative ⇒ mint.
      for (const out of txData.outputs) {
        if (out.value <= 0n) continue;
        if ((out.authorities ?? 0n) !== 0n) continue;
        const token = 'token' in out ? out.token : implicitTokenKey;
        bumpDelta(token, out.value);
      }
      for (const so of txData.shieldedOutputs ?? []) {
        if (so.value <= 0n) continue;
        bumpDelta(so.token, so.value);
      }
      for (const inp of txData.inputs) {
        const auth = inp.authorities ?? 0n;
        if (auth !== 0n) {
          if ((auth & TOKEN_MINT_MASK) !== 0n) mintAuthorityTokens.add(inp.token);
          if ((auth & TOKEN_MELT_MASK) !== 0n) meltAuthorityTokens.add(inp.token);
          continue;
        }
        if (inp.value > 0n) bumpDelta(inp.token, -inp.value);
      }

      const mintEntries: Array<{ tokenIndex: number; amount: bigint }> = [];
      const meltEntries: Array<{ tokenIndex: number; amount: bigint }> = [];
      for (const token of tokensArray) {
        const delta = tokenDelta.get(token) ?? 0n;
        // For createToken the new token has no authority input (it's
        // the genesis): the tx version itself authorizes mint, so we
        // declare unconditionally on positive delta.
        const canMint = isCreateToken || mintAuthorityTokens.has(token);
        const canMelt = meltAuthorityTokens.has(token);
        if (delta > 0n && canMint) {
          mintEntries.push({
            tokenIndex: tokensArray.indexOf(token) + 1,
            amount: delta,
          });
        } else if (delta < 0n && canMelt) {
          meltEntries.push({
            tokenIndex: tokensArray.indexOf(token) + 1,
            amount: -delta,
          });
        }
      }
      if (mintEntries.length > 0) {
        tx.headers.push(new MintHeader(mintEntries));
      }
      if (meltEntries.length > 0) {
        tx.headers.push(new MeltHeader(meltEntries));
      }
    }
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

      // Shielded inputs reference indices past the parent's transparent
      // outputs (the wallet's stored copy normalizes shielded entries OUT
      // of `outputs`). Recover the spent-output info from the wallet's
      // saved UTXO record instead of erroring.
      if (input.index >= spentTx.outputs.length) {
        const utxo = await storage.getUtxo({ txId: input.hash, index: input.index });
        if (!utxo) {
          throw new Error(
            `Index (${input.index}) outside of transaction output array bounds (${spentTx.outputs.length}) and no stored UTXO recovery for tx_id=${input.hash}`
          );
        }
        inputs.push({
          tx_id: input.hash,
          index: input.index,
          script: '',
          decoded: { address: utxo.address, timelock: utxo.timelock ?? null },
          token_data: 0,
          token: utxo.token,
          value: utxo.value,
        });
        continue;
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

    // Emit shielded_outputs so the locally-pushed tx carries the same shape
    // a websocket-delivered tx would. Without this, a shielded self-send
    // writes a bare history entry (no shielded_outputs), and processNewTx's
    // decryption gate is skipped entirely (shieldedCount=0) — the wallet
    // debits the input but never credits back the self-sent shielded outputs,
    // leaving the per-tx balance stuck at -input_value until a full
    // processHistory reload. See TODO_FIX_33.
    const shieldedOutputs: IHistoryShieldedOutput[] | undefined =
      tx.shieldedOutputs && tx.shieldedOutputs.length > 0
        ? tx.shieldedOutputs.map(so => {
            const parsed = parseScript(so.script, storage.config.getNetwork());
            return {
              mode: so.mode,
              commitment: so.commitment.toString('hex'),
              range_proof: so.rangeProof.toString('hex'),
              script: so.script.toString('hex'),
              token_data: so.tokenData,
              ephemeral_pubkey: so.ephemeralPubkey.toString('hex'),
              asset_commitment: so.assetCommitment?.toString('hex'),
              surjection_proof: so.surjectionProof?.toString('hex'),
              decoded: (parsed?.toData() ?? {}) as IHistoryShieldedOutput['decoded'],
            };
          })
        : undefined;

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
      ...(shieldedOutputs ? { shielded_outputs: shieldedOutputs } : {}),
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

    // Full-unshield detection for tx paths that don't go through
    // SendTransaction.prepareTxData (notably `createNewToken` /
    // `prepareCreateNewToken`, which build txData directly via tokens.ts).
    // If the inputs include shielded UTXOs and the tx has no shielded
    // outputs, we must attach an UnshieldBalanceHeader carrying the excess
    // blinding factor so the fullnode's Pedersen balance check holds — same
    // logic SendTransaction already runs for the send path. Skip if txData
    // already carries excess (set upstream) or if there are shielded outputs
    // (mutually exclusive with the header).
    if (
      !txData.excessBlindingFactor &&
      (!txData.shieldedOutputs || txData.shieldedOutputs.length === 0)
    ) {
      const shieldedInputs: Array<{ value: bigint; vbf: Buffer; gbf: Buffer }> = [];
      const transparentInputs: Array<{ value: bigint; vbf: Buffer; gbf: Buffer }> = [];
      // The excess scalar in UnshieldBalanceHeader represents
      // sum(r_in) - sum(r_out), independent of token (it lives on G).
      // Include shielded inputs of every token so the G-term sum is
      // correct; transparent inputs (vbf=0) contribute nothing to the
      // sum but their value matters for the per-token balance the
      // verifier checks separately.
      for (const inp of txData.inputs) {
        const utxo = await storage.getUtxo({ txId: inp.txId, index: inp.index });
        if (!utxo) continue;
        if (utxo.shielded) {
          if (!utxo.blindingFactor) continue;
          shieldedInputs.push({
            value: utxo.value,
            vbf: Buffer.from(utxo.blindingFactor, 'hex'),
            gbf: utxo.assetBlindingFactor
              ? Buffer.from(utxo.assetBlindingFactor, 'hex')
              : ZERO_TWEAK,
          });
        } else if ((utxo.authorities ?? 0n) === 0n && utxo.value > 0n) {
          transparentInputs.push({
            value: utxo.value,
            vbf: ZERO_TWEAK,
            gbf: ZERO_TWEAK,
          });
        }
      }

      if (shieldedInputs.length > 0) {
        const cryptoProvider = storage.shieldedCryptoProvider;
        if (!cryptoProvider) {
          throw new Error(
            'Shielded crypto provider is not set. Cannot compute excess blinding ' +
              'factor for a tx that spends shielded UTXOs without producing shielded outputs.'
          );
        }
        const transparentOutputEntries: Array<{ value: bigint; vbf: Buffer; gbf: Buffer }> = [];
        // All outputs contribute (value, vbf=0, gbf=0). Authority outputs
        // are skipped because their `value` field is the authority mask,
        // not a token amount the verifier sums.
        for (const out of txData.outputs) {
          if (out.value > 0n && (out.authorities ?? 0n) === 0n) {
            transparentOutputEntries.push({
              value: out.value,
              vbf: ZERO_TWEAK,
              gbf: ZERO_TWEAK,
            });
          }
        }
        // Fee-header amounts (HTR fees + per-token fees) on the output side.
        for (const header of txData.headers ?? []) {
          if (header instanceof FeeHeader) {
            for (const fee of header.entries) {
              transparentOutputEntries.push({
                value: fee.amount,
                vbf: ZERO_TWEAK,
                gbf: ZERO_TWEAK,
              });
            }
          }
        }
        const excess = await cryptoProvider.computeBalancingBlindingFactor(
          0n,
          ZERO_TWEAK,
          [...shieldedInputs, ...transparentInputs],
          transparentOutputEntries
        );
        // eslint-disable-next-line no-param-reassign
        txData.excessBlindingFactor = excess;
      }
    }

    const network = storage.config.getNetwork();
    const tx = this.createTransactionFromData(txData, network);
    if (newOptions.signTx) {
      await this.signTransaction(tx, storage, pinCode);
      tx.prepareToSend(this.getWeightConstantsFromStorage(storage));
    }

    return tx;
  },

  /**
   * Build a weight-constants object from the network's reported values
   * (`storage.version.min_tx_weight*`). Falls back to undefined when the
   * version data hasn't been fetched yet, in which case callers will use
   * the hardcoded {@link TX_WEIGHT_CONSTANTS}.
   */
  getWeightConstantsFromStorage(
    storage: IStorage
  ): { txMinWeight: number; txWeightCoefficient: number; txMinWeightK: number } | undefined {
    const { version } = storage;
    if (!version) return undefined;
    return {
      txMinWeight: version.min_tx_weight,
      txWeightCoefficient: version.min_tx_weight_coefficient,
      txMinWeightK: version.min_tx_weight_k,
    };
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
      if (this.isShieldedInputEntry(i)) {
        return i as unknown as IHistoryInput;
      }
      const hydratedInput = this.hydrateIOWithToken(i as { token_data: number }, tx.tokens);
      return hydratedInput as IHistoryInput;
    });
    const outputs: IHistoryOutput[] = tx.outputs.map(o => {
      // Shielded outputs already have token populated after decryption
      if (this.isShieldedOutputEntry(o)) return o;
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

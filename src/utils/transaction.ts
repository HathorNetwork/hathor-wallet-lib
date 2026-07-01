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
  TxWeightConstants,
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
import { MintHeader } from '../headers/mint_header';
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
  ITransparentOutput,
  IUtxoId,
  IInputSignature,
  ITxSignatureData,
  OutputValueType,
  IHistoryInput,
  IHistoryShieldedOutput,
  AuthorityType,
} from '../types';
import { ShieldedOutputMode } from '../shielded/types';
import { ensureHex } from './buffer';
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
   * Shielded inputs arrive from the fullnode inline in tx.inputs[] with
   * type='shielded' and only a commitment + range_proof — none of the
   * token_data/decoded/tx_id fields that transparent inputs carry. Call sites
   * that read those fields must filter these out first. The reload path
   * (processHistory) also feeds bare {tx_id, index, type:'shielded'} inputs
   * from address_history, which this detects so they can be debited.
   */
  isShieldedInputEntry(input: { type?: string } | null | undefined): boolean {
    return input != null && input.type === 'shielded';
  },

  /**
   * Resolve the on-chain output of the spent tx that an input with absolute
   * on-chain index `idx` spends, using the SEPARATED / arithmetic model that
   * mirrors hathor-core (`base_transaction.py:347-363`).
   *
   * The spent tx has `T = outputs.length` transparent outputs followed by
   * `S = shielded_outputs.length` shielded outputs. The on-chain absolute
   * index of `shielded_outputs[s]` is `T + s`. Resolution is pure arithmetic
   * — NO scan, NO commitment-match, NO `onChainIndex`:
   *   - `idx in [0, T)`     → `{ kind: 'transparent', output }`
   *   - `idx in [T, T + S)` → `{ kind: 'shielded', sIndex: idx - T, output }`
   *       for EVERY slot regardless of decoded state. A non-owned slot
   *       (`output.value === undefined`) still resolves to a valid `shielded`
   *       result; callers gate ownership off `value !== undefined`, not off
   *       resolver kind.
   *   - otherwise (`idx >= T + S` or `idx < 0`) → `undefined`
   *
   * The full `shielded_outputs[]` list MUST be present (owned + non-owned) for
   * the arithmetic to land on the right slot — a partial list would shift
   * `idx - T` onto the wrong entry.
   */
  resolveSpentOutput(
    spentTx: IHistoryTx,
    idx: number
  ):
    | { kind: 'transparent'; output: ITransparentOutput }
    | { kind: 'shielded'; sIndex: number; output: IHistoryShieldedOutput }
    | undefined {
    const outputs = spentTx.outputs ?? [];
    const shieldedOutputs = spentTx.shielded_outputs ?? [];
    const T = outputs.length;
    const S = shieldedOutputs.length;
    if (idx < 0) return undefined;
    if (idx < T) {
      return { kind: 'transparent', output: outputs[idx] };
    }
    if (idx < T + S) {
      const sIndex = idx - T;
      return { kind: 'shielded', sIndex, output: shieldedOutputs[sIndex] };
    }
    return undefined;
  },

  /**
   * True when `index` is the on-chain absolute index of a SHIELDED output of
   * `tx` — i.e. it falls in the shielded range `[outputs.length, outputs.length
   * + shieldedCount)`. In the SEPARATED model transparent outputs occupy
   * `outputs[0..N)` and shielded outputs occupy the slots immediately after.
   * Transparent-only flows (partial txs, tx templates) use this to reject a
   * shielded input index with a clear message instead of a misleading bounds
   * error or an undefined output read.
   */
  isShieldedOutputIndex(
    tx: { outputs: unknown[]; shielded_outputs?: unknown[] | null },
    index: number
  ): boolean {
    const shieldedCount = tx.shielded_outputs?.length ?? 0;
    return index >= tx.outputs.length && index < tx.outputs.length + shieldedCount;
  },

  /**
   * Hex-encode the confidential wire fields of a transaction's shielded outputs,
   * in place. The fullnode delivers shielded outputs SEPARATED in a
   * dedicated `shielded_outputs[]` array on BOTH the HTTP `/transaction`
   * (to_json) and the `address_history` + WS real-time (to_json_extended) paths,
   * so `outputs[]` is always transparent-only — no inline relocation needed —
   * and `mode` is always present on the wire.
   *
   * Converts every shielded output's base64 confidential fields (commitment /
   * range_proof / script / ephemeral_pubkey / asset_commitment /
   * surjection_proof) to hex; without this `Buffer.from(value, 'hex')`
   * downstream parses them as garbage — making the native rewind throw "asset
   * commitment verification failed" and the per-tx balance read as -input with
   * no credit for the decoded shielded outputs.
   *
   * Idempotent: ensureHex no-ops on already-hex fields. The owned-marker fields
   * (value / token / blindingFactor / assetBlindingFactor) are NOT on the wire —
   * they are populated post-decryption on the slots the wallet owns — so this
   * neither reads nor invents them.
   */
  normalizeShieldedOutputs(tx: IHistoryTx): void {
    if (!tx.shielded_outputs) {
      // Transparent-only tx (no shielded_outputs) — nothing to normalize.
      return;
    }

    // Hex-encode the confidential wire fields of every shielded output.
    for (const so of tx.shielded_outputs) {
      // eslint-disable-next-line no-param-reassign
      so.commitment = ensureHex(so.commitment);
      // eslint-disable-next-line no-param-reassign
      so.range_proof = ensureHex(so.range_proof);
      // eslint-disable-next-line no-param-reassign
      so.script = ensureHex(so.script);
      // eslint-disable-next-line no-param-reassign
      so.ephemeral_pubkey = ensureHex(so.ephemeral_pubkey);
      if (so.asset_commitment) {
        // eslint-disable-next-line no-param-reassign
        so.asset_commitment = ensureHex(so.asset_commitment);
      }
      if (so.surjection_proof) {
        // eslint-disable-next-line no-param-reassign
        so.surjection_proof = ensureHex(so.surjection_proof);
      }
    }
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

      // Resolve the spent output via the SEPARATED-model resolver. A
      // positional `spentTx.outputs[input.index]` would return the wrong
      // entry for a shielded input (whose on-chain index is ≥ outputs.length)
      // and the signature would be computed for the wrong pubkey, failing
      // OP_EQUALVERIFY at the fullnode with "Failed to verify if elements are
      // equal".
      const resolved = this.resolveSpentOutput(spentTx, input.index);
      const spentOut = resolved?.output;
      // A shielded output's spend-derived P2PKH (decoded.address) is on the wire
      // for every output (owned or not) and persisted on the stored entry, so
      // the resolver always supplies the address needed to select the signing
      // key — no UTXO lookup required.
      if (!spentOut?.decoded?.address) {
        // Not a wallet output (or an unresolvable index)
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
        derivedKey = spendXprivkey.deriveChild(addressInfo.bip32AddressIndex);
      } else {
        // Use legacy key chain (m/44'/280'/0'/0) for regular addresses
        derivedKey = xprivkey.deriveNonCompliantChild(addressInfo.bip32AddressIndex);
      }

      signatures.push({
        inputIndex,
        addressIndex: addressInfo.bip32AddressIndex,
        signature: this.getSignature(dataToSignHash, derivedKey.privateKey),
        pubkey: derivedKey.publicKey.toDER(),
        // Carry the address type so callers (getSignatures) can render the
        // matching derivation path: a 'shielded-spend' input was signed with the
        // spend chain (m/44'/280'/2'), not the legacy P2PKH chain.
        addressType: addressInfo.addressType,
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

    // Accrue one output/input into the running balance. `sign` is +1n to credit
    // (outputs) or -1n to debit (inputs): authority entries move by `sign`, token
    // amounts by `sign * value`. Shared by the transparent-output, shielded-output
    // and input loops below so the authority/lock/value handling lives in one place.
    const accrue = (
      token: string,
      value: bigint,
      tokenData: number,
      isLocked: boolean,
      sign: bigint
    ): void => {
      if (!balance[token]) {
        balance[token] = getEmptyBalance();
      }
      const entry = balance[token];
      if (this.isAuthorityOutput({ token_data: tokenData })) {
        if (this.isMint({ value, token_data: tokenData })) {
          if (isLocked) entry.authorities.mint.locked += sign;
          else entry.authorities.mint.unlocked += sign;
        }
        if (this.isMelt({ value, token_data: tokenData })) {
          if (isLocked) entry.authorities.melt.locked += sign;
          else entry.authorities.melt.unlocked += sign;
        }
      } else if (isLocked) {
        entry.tokens.locked += sign * value;
      } else {
        entry.tokens.unlocked += sign * value;
      }
    };

    for (const output of tx.outputs) {
      const { address } = output.decoded;
      if (!(address && (await storage.isAddressMine(address)))) {
        continue;
      }
      const isLocked = this.isOutputLocked(output, { refTs: nowTs }) || isHeightLocked;
      accrue(output.token, output.value, output.token_data, isLocked, 1n);
    }

    // CREDIT loop over shielded outputs (SEPARATED model). Owned shielded
    // outputs live in tx.shielded_outputs[] with their value/token decrypted
    // IN PLACE. `value !== undefined` is the authoritative ownership gate — it
    // is written only when the wallet decrypts a slot it owns (see the
    // owned-marker note on IHistoryShieldedOutput) — and we additionally require
    // isAddressMine(decoded.address), the same check the transparent loop uses;
    // authority/lock/value handling mirrors that loop too. Without this loop an
    // owned shielded RECEIVE would credit 0 in getTxHistory / getTxById.
    for (const so of tx.shielded_outputs ?? []) {
      if (so.value === undefined) {
        // Non-owned (or not-yet-decrypted) slot — excluded by the gate.
        continue;
      }
      const { address } = so.decoded;
      if (!(address && (await storage.isAddressMine(address)))) {
        continue;
      }
      const isLocked = this.isOutputLocked(so, { refTs: nowTs }) || isHeightLocked;
      // An owned (decrypted) shielded slot always carries its token: decryption
      // recovers value and tokenUid together (IDecryptedShieldedOutput), and the
      // `value !== undefined` gate above already proved ownership. So read the
      // token directly — no NATIVE_TOKEN_UID fallback, which would mislabel a
      // custom token as HTR (mirrors the input-debit path below). token_data may
      // still be undefined (FullShielded hides it); default to 0 so the
      // authority check reads as plain funds.
      accrue(so.token!, so.value, so.token_data ?? 0, isLocked, 1n);
    }

    for (const input of tx.inputs) {
      // Determine the spent value/token/address. Transparent (or already
      // enriched) inputs carry these inline. A shielded input is bare — its
      // amount is hidden in the on-chain commitment — so read them off the
      // parent tx's owned, decrypted shielded output, which the receive
      // pipeline persists at receive time, via the SEPARATED-model resolver.
      // Without this the per-tx delta would credit change but never debit the
      // spend (e.g. +8.5M on a tx that actually sent 500K).
      let address = input.decoded?.address;
      let inputToken = input.token;
      let inputValue = input.value;
      let inputTokenData = input.token_data;

      if (!address || inputToken === undefined || inputValue === undefined) {
        const spentTx = await storage.getTx(input.tx_id);
        const resolved = spentTx ? this.resolveSpentOutput(spentTx, input.index) : undefined;
        // We can only debit inputs the wallet OWNS. This block runs only for
        // "bare" inputs (no inline value/token), which the fullnode emits only
        // for shielded inputs. Anything that isn't an owned, decrypted shielded
        // slot — a non-shielded resolve, or a shielded slot we never decrypted
        // (value === undefined) — is not ours, so skip it.
        if (resolved?.kind !== 'shielded' || resolved.output.value === undefined) {
          continue;
        }
        const so = resolved.output;
        address = so.decoded?.address;
        // Token comes from the decrypted slot (an owned slot always carries it).
        // No NATIVE_TOKEN_UID fallback — that would mislabel a custom token as HTR.
        inputToken = so.token;
        inputValue = so.value;
        inputTokenData = so.token_data ?? 0;
      }

      if (!(address && (await storage.isAddressMine(address)))) {
        continue;
      }
      // Inputs debit (sign -1n); a spent output is never locked.
      accrue(inputToken!, inputValue!, inputTokenData!, false, -1n);
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
      // UnshieldBalanceHeader + MintHeader the fullnode requires.
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
   * Attach the shielded-related headers onto a freshly-built tx based on what
   * `txData` carries. Shared by both regular `Transaction` and
   * `CreateTokenTransaction` paths, which need the same headers.
   *
   * Delegates to one helper per header, invoked in canonical header-id order so
   * `tx.headers` stays sorted: Fee(0x11) ≤ Shielded(0x12) ≤ Unshield(0x13) ≤
   * Mint(0x14) ≤ Melt(0x15).
   *
   * @param tx The Transaction (or CreateTokenTransaction) to attach to.
   * @param txData The data the tx was built from.
   */
  _attachShieldedHeaders(tx: Transaction | CreateTokenTransaction, txData: IDataTx): void {
    this._attachShieldedOutputsHeader(tx, txData);
    this._attachUnshieldBalanceHeader(tx, txData);
    this._attachMintMeltHeaders(tx, txData);
  },

  /**
   * Build a `ShieldedOutput` model for each entry in `txData.shieldedOutputs`
   * and push a ShieldedOutputsHeader (0x12) carrying them (SEPARATED model —
   * shielded outputs live apart from `tx.outputs`, and the `tx.shieldedOutputs`
   * getter reads them back from the header). No-op when the tx carries no
   * shielded outputs.
   */
  _attachShieldedOutputsHeader(tx: Transaction | CreateTokenTransaction, txData: IDataTx): void {
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

        // assetCommitment / surjectionProof only exist on the FullShielded
        // variant of the discriminated union — narrow with `shieldedMode`
        // before reading them, otherwise tsc rejects the access.
        const options =
          so.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED
            ? { assetCommitment: so.assetCommitment, surjectionProof: so.surjectionProof }
            : {};

        return new ShieldedOutput(
          so.shieldedMode,
          so.commitment,
          so.rangeProof,
          tokenData,
          Buffer.from(so.script, 'hex'),
          so.ephemeralPubkey,
          so.value,
          options
        );
      });

      // The ShieldedOutputsHeader owns the array; tx.shieldedOutputs is a getter
      // that reads it back, so there is no separate field to assign.
      tx.headers.push(new ShieldedOutputsHeader(shieldedModels));
    }
  },

  /**
   * Push an UnshieldBalanceHeader (0x13) for a full-unshield tx (shielded
   * inputs, no shielded outputs): the excess scalar closes the Pedersen balance
   * `sum(C_in) = sum(C_out) + excess·G`. Mutually exclusive with shielded
   * outputs — asserts the caller never set both (surfaces the bug before PoW).
   * No-op when there's no excess blinding factor.
   */
  _attachUnshieldBalanceHeader(tx: Transaction | CreateTokenTransaction, txData: IDataTx): void {
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
  },

  /**
   * Declare real supply changes for non-HTR tokens in a shielded tx via
   * MintHeader (0x14) / MeltHeader (0x15). A pure shielding move (T↔F) preserves
   * supply and declares nothing; a header is emitted only when an explicit
   * mint/melt authority is exercised (see the detection rule in the body).
   */
  _attachMintMeltHeaders(tx: Transaction | CreateTokenTransaction, txData: IDataTx): void {
    // Mint/Melt headers for shielded txs.
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

                // SEPARATED model: the on-chain index space spans transparent
                // outputs followed by shielded outputs, so the bound is the
                // sum of both arrays. Using outputs.length alone rejects every
                // shielded spend whose parent isn't in storage.
                const shieldedCount =
                  (response.tx as { shielded_outputs?: unknown[] }).shielded_outputs?.length ?? 0;
                if (input.index >= response.tx.outputs.length + shieldedCount) {
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

      // Resolve the parent's spent output by its absolute on-chain index via
      // the SEPARATED-model resolver. A `kind === 'shielded'` result means the
      // input spends a shielded slot (on-chain index ≥ outputs.length); we
      // stamp `type: 'shielded'` so the rest of wallet-lib (e.g.
      // `getShieldedUnblindingForTx`, the WS-driven tx-history view, the
      // signing key chain selection) routes this input through the shielded
      // code paths.
      const resolvedSpent = this.resolveSpentOutput(spentTx, input.index);

      if (resolvedSpent?.kind === 'shielded' && resolvedSpent.output.value !== undefined) {
        // The wallet's stored parent tx carries a decoded shielded entry for
        // this slot. Read value/token/decoded/script straight off that entry
        // instead of touching the UTXO record — the entry survives the
        // WebSocket-driven `processNewTx` UTXO deletion that races with this
        // fire-and-forget local-insert call. Headless wallets pointed at a
        // local fullnode hit that race almost every time (WS re-delivery wins,
        // UTXO is gone before this function reaches its lookup).
        const shieldedEntry = resolvedSpent.output;
        inputs.push({
          type: 'shielded',
          tx_id: input.hash,
          index: input.index,
          script: shieldedEntry.script ?? '',
          decoded: shieldedEntry.decoded ?? {},
          token_data: shieldedEntry.token_data ?? 0,
          // Owned + decoded (gated by `value !== undefined` above): decryption
          // always recovers the token, so no NATIVE_TOKEN_UID fallback — which
          // would mislabel a custom token as HTR (matches the credit path).
          token: shieldedEntry.token!,
          value: shieldedEntry.value,
        });
        continue;
      }

      if (resolvedSpent === undefined || resolvedSpent.kind === 'shielded') {
        // Reachable only if we're "spending" a shielded slot the wallet never
        // decoded (value === undefined) or whose stored shielded list is too
        // short to resolve. That is impossible for a real spend: a shielded
        // input requires the spend key and unblinding factors the wallet only
        // holds for outputs it OWNS, and an owned output is decoded + persisted
        // on the parent at receive time — so reaching here means corrupted or
        // incomplete storage. Don't paper over it with the racy UTXO record;
        // surface it (the broadcast already happened — only the local insert
        // fails, and the WS re-delivery still processes the tx correctly).
        throw new Error(
          `Input ${input.hash}:${input.index} spends a shielded slot with no decoded ` +
            `entry on the spent tx (shielded_outputs length ` +
            `${spentTx.shielded_outputs?.length ?? 0}) — cannot reconstruct the local insert.`
        );
      }

      // Transparent slot: resolvedSpent is the transparent output.
      const spentOut = resolvedSpent!.output as ITransparentOutput;
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

    // Attach an UnshieldBalanceHeader for a "full unshield" — a tx that spends
    // shielded inputs but produces NO shielded outputs — on paths that bypass
    // SendTransaction.prepareTxData (notably `createNewToken` /
    // `prepareCreateNewToken`, which build txData directly via tokens.ts). The
    // header carries the excess blinding factor so the fullnode's Pedersen
    // balance check holds (same logic SendTransaction runs for the send path).
    //
    // The condition AND's two separate things: `!excessBlindingFactor` is a
    // skip-guard for paths that already computed it upstream, and "no shielded
    // outputs" is the actual full-unshield signal (mutually exclusive with the
    // header). The third requirement — that the tx really spends shielded inputs
    // — is verified below: the header is only attached when shieldedInputs > 0.
    if (
      !txData.excessBlindingFactor &&
      (!txData.shieldedOutputs || txData.shieldedOutputs.length === 0)
    ) {
      const shieldedInputs: Array<{
        value: bigint;
        valueBlindingFactor: Buffer;
        generatorBlindingFactor: Buffer;
      }> = [];
      const transparentInputs: Array<{
        value: bigint;
        valueBlindingFactor: Buffer;
        generatorBlindingFactor: Buffer;
      }> = [];
      // The excess scalar in UnshieldBalanceHeader represents
      // sum(r_in) - sum(r_out), independent of token (it lives on G).
      // Include shielded inputs of every token so the G-term sum is
      // correct; transparent inputs (valueBlindingFactor=0) contribute
      // nothing to the sum but their value matters for the per-token
      // balance the verifier checks separately.
      for (const inp of txData.inputs) {
        const utxo = await storage.getUtxo({ txId: inp.txId, index: inp.index });
        if (!utxo) continue;
        if (utxo.shielded) {
          if (!utxo.blindingFactor) continue;
          shieldedInputs.push({
            value: utxo.value,
            valueBlindingFactor: Buffer.from(utxo.blindingFactor, 'hex'),
            generatorBlindingFactor: utxo.assetBlindingFactor
              ? Buffer.from(utxo.assetBlindingFactor, 'hex')
              : ZERO_TWEAK,
          });
        } else if ((utxo.authorities ?? 0n) === 0n && utxo.value > 0n) {
          transparentInputs.push({
            value: utxo.value,
            valueBlindingFactor: ZERO_TWEAK,
            generatorBlindingFactor: ZERO_TWEAK,
          });
        }
      }

      if (shieldedInputs.length > 0) {
        // Spending shielded UTXOs without shielded outputs needs the provider to
        // compute the excess blinding factor; fail loudly if it is missing.
        const cryptoProvider = storage.getShieldedCryptoProvider();
        const transparentOutputEntries: Array<{
          value: bigint;
          valueBlindingFactor: Buffer;
          generatorBlindingFactor: Buffer;
        }> = [];
        // All outputs contribute (value, valueBlindingFactor=0,
        // generatorBlindingFactor=0). Authority outputs are skipped because
        // their `value` field is the authority mask, not a token amount the
        // verifier sums.
        for (const out of txData.outputs) {
          if (out.value > 0n && (out.authorities ?? 0n) === 0n) {
            transparentOutputEntries.push({
              value: out.value,
              valueBlindingFactor: ZERO_TWEAK,
              generatorBlindingFactor: ZERO_TWEAK,
            });
          }
        }
        // Fees (HTR + per-token) are value leaving the tx, so for the Pedersen
        // value-conservation check (inputs = outputs + fees) they count on the
        // OUTPUT side. Zero-blinded because fee amounts are public/explicit.
        for (const header of txData.headers ?? []) {
          if (header instanceof FeeHeader) {
            for (const fee of header.entries) {
              transparentOutputEntries.push({
                value: fee.amount,
                valueBlindingFactor: ZERO_TWEAK,
                generatorBlindingFactor: ZERO_TWEAK,
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
  getWeightConstantsFromStorage(storage: IStorage): TxWeightConstants | undefined {
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
    if (tx === null) {
      // This is not our utxo, so we cannot spend it.
      return false;
    }
    // SEPARATED-model lookup. A shielded UTXO has on-chain index
    // outputs.length + s, so a positional `tx.outputs[utxo.index]` would read
    // the wrong (or no) entry; resolve arithmetically and read the timelock
    // off the resolved output (transparent or shielded — both carry decoded).
    const resolved = this.resolveSpentOutput(tx, utxo.index);
    if (!resolved) {
      return false;
    }
    const isTimelocked = this.isOutputLocked(resolved.output, { refTs: nowTs });
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
    const inputs: IHistoryInput[] = tx.inputs.map(
      i => this.hydrateIOWithToken(i as { token_data: number }, tx.tokens) as IHistoryInput
    );

    // SEPARATED model: `outputs[]` is transparent-only — hydrate each with its
    // token. Shielded outputs arrive in a dedicated `shielded_outputs[]` field
    // (passthrough — not in the zod schema); they are shallow-copied here and
    // hex-normalized in one pass via normalizeShieldedOutputs(histTx) below.
    const outputs: IHistoryOutput[] = tx.outputs.map(
      o => this.hydrateIOWithToken(o, tx.tokens) as IHistoryOutput
    );

    const separateShielded = (tx as { shielded_outputs?: IHistoryShieldedOutput[] })
      .shielded_outputs;
    // Shallow-copy each slot so the hex normalization below mutates our copies,
    // not the caller's txResponse objects.
    const shieldedOutputs: IHistoryShieldedOutput[] = (separateShielded ?? []).map(so => ({
      ...so,
    }));

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
      ...(shieldedOutputs.length > 0 ? { shielded_outputs: shieldedOutputs } : {}),
    };

    if (tx.nc_id) histTx.nc_id = tx.nc_id;
    if (tx.nc_blueprint_id) histTx.nc_blueprint_id = tx.nc_blueprint_id;
    if (tx.nc_method) histTx.nc_method = tx.nc_method;
    if (tx.nc_args) histTx.nc_args = tx.nc_args;
    if (tx.nc_address) histTx.nc_address = tx.nc_address;
    if (tx.nc_context) histTx.nc_context = tx.nc_context;
    if (tx.nc_pubkey) histTx.nc_pubkey = tx.nc_pubkey;

    // Hex-encode the confidential wire fields (commitment/range_proof/script/…)
    // in one pass — the same normalization used by the realtime/ws path.
    this.normalizeShieldedOutputs(histTx);

    return histTx;
  },
};

export default transaction;

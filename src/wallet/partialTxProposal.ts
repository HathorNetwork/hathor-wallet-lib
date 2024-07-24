/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { PartialTx, PartialTxInputData } from '../models/partial_tx';
import Address from '../models/address';
import P2SH from '../models/p2sh';
import P2PKH from '../models/p2pkh';
import ScriptData from '../models/script_data';
import Transaction from '../models/transaction';
import { AddressError, InvalidPartialTxError } from '../errors';
import { NATIVE_TOKEN_UID, TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../constants';

import transactionUtils from '../utils/transaction';
import dateFormatter from '../utils/date';

import { OutputType, Utxo } from './types';
import { Balance } from '../models/types';
import { IStorage } from '../types';

class PartialTxProposal {
  public partialTx: PartialTx;

  public signatures: PartialTxInputData | null;

  public transaction: Transaction | null;

  public storage: IStorage;

  /**
   * @param {Network} network
   */
  constructor(storage: IStorage) {
    this.storage = storage;
    this.partialTx = new PartialTx(storage.config.getNetwork());
    this.signatures = null;
    this.transaction = null;
  }

  /**
   * Create a PartialTxProposal instance from the serialized string.
   *
   * @param {string} serialized Serialized PartialTx data
   * @param {Network} network network
   *
   * @throws {SyntaxError} serialized argument should be a valid PartialTx.
   * @throws {UnsupportedScriptError} All outputs should be P2SH or P2PKH
   *
   * @returns {PartialTxProposal}
   */
  static fromPartialTx(serialized: string, storage: IStorage): PartialTxProposal {
    const network = storage.config.getNetwork();
    const partialTx = PartialTx.deserialize(serialized, network);
    const proposal = new PartialTxProposal(storage);
    proposal.partialTx = partialTx;
    return proposal;
  }

  /**
   * Add inputs sending the amount of tokens specified, may add a change output.
   *
   * @param {string} token UID of token that is being sent
   * @param {number} value Quantity of tokens being sent
   * @param {Object} [options]
   * @param {Utxo[]|null} [options.utxos=[]] utxos to add to the partial transaction.
   * @param {string|null} [options.changeAddress=null] If we add change, use this address instead of getting a new one from the wallet.
   * @param {boolean} [options.markAsSelected=true] Mark the utxo with `selected_as_input`.
   */
  async addSend(
    token: string,
    value: bigint,
    {
      utxos = [],
      changeAddress = null,
      markAsSelected = true,
    }: { utxos?: Utxo[] | null; changeAddress?: string | null; markAsSelected?: boolean } = {}
  ) {
    this.resetSignatures();

    // Use the pool of utxos or all wallet utxos.
    let allUtxos: Utxo[];
    if (utxos && utxos.length > 0) {
      allUtxos = utxos;
    } else {
      allUtxos = [];
      for await (const utxo of this.storage.selectUtxos({ token, authorities: 0n })) {
        allUtxos.push({
          txId: utxo.txId,
          index: utxo.index,
          value: utxo.value,
          tokenId: utxo.token,
          address: utxo.address,
          authorities: 0n,
          timelock: utxo.timelock,
          heightlock: null,
          locked: false,
          addressPath: '',
        });
      }
    }

    // Filter pool of utxos for only utxos from the token and not already in the partial tx
    const currentUtxos = this.partialTx.inputs.map(input => `${input.hash}-${input.index}`);
    const utxosToUse = allUtxos.filter(
      utxo => utxo.tokenId === token && !currentUtxos.includes(`${utxo.txId}-${utxo.index}`)
    );

    const utxosDetails = transactionUtils.selectUtxos(utxosToUse, value);

    for (const utxo of utxosDetails.utxos) {
      this.addInput(utxo.txId, utxo.index, utxo.value, utxo.address, {
        token: utxo.tokenId,
        authorities: utxo.authorities,
        markAsSelected,
      });
    }

    // add change output if needed
    if (utxosDetails.changeAmount > 0) {
      const address: string = changeAddress || (await this.storage.getCurrentAddress());
      this.addOutput(token, utxosDetails.changeAmount, address, { isChange: true });
    }
  }

  /**
   * Add outputs receiving the amount of tokens specified.
   *
   * @param {string} token UID of token that is being sent
   * @param {number} value Quantity of tokens being sent
   * @param {Object} [options]
   * @param {number|null} [options.timelock=null] UNIX timestamp of the timelock.
   * @param {string|null} [options.address=null] Output address to receive the tokens.
   *
   */
  async addReceive(
    token: string,
    value: bigint,
    { timelock = null, address = null }: { timelock?: number | null; address?: string | null } = {}
  ) {
    this.resetSignatures();

    // get an address of our wallet and add the output
    const addr: string = address || (await this.storage.getCurrentAddress());
    this.addOutput(token, value, addr, { timelock });
  }

  /**
   * Add an UTXO as input on the partial data.
   *
   * @param {string} hash Transaction hash
   * @param {number} index UTXO index on the outputs of the transaction.
   * @param {number} value UTXO value.
   * @param {Object} [options]
   * @param {string} [options.token='00'] Token UID in hex format.
   * @param {number} [options.authorities=0] Authority information of the UTXO.
   * @param {string|null} [options.address=null] Address that owns the UTXO.
   * @param {boolean} [options.markAsSelected=true] Mark the utxo with `selected_as_input`.
   */
  addInput(
    hash: string,
    index: number,
    value: bigint,
    address: string,
    {
      token = NATIVE_TOKEN_UID,
      authorities = 0n,
      markAsSelected = true,
    }: {
      token?: string;
      authorities?: bigint;
      markAsSelected?: boolean;
    } = {}
  ) {
    this.resetSignatures();

    if (markAsSelected) {
      this.storage.utxoSelectAsInput({ txId: hash, index }, true);
    }

    this.partialTx.addInput(hash, index, value, address, { token, authorities });
  }

  /**
   * Add an output to the partial data.
   *
   * @param {string} token UID of token that is being sent.
   * @param {number} value Quantity of tokens being sent.
   * @param {string} address Create the output script for this address.
   * @param {Object} [options]
   * @param {number|null} [options.timelock=null] UNIX timestamp of the timelock.
   * @param {boolean} [options.isChange=false] If the output should be considered as change.
   * @param {number} [options.authorities=0] Authority information of the Output.
   *
   * @throws AddressError
   */
  addOutput(
    token: string,
    value: bigint,
    address: string,
    {
      timelock = null,
      isChange = false,
      authorities = 0n,
    }: { timelock?: number | null; isChange?: boolean; authorities?: bigint } = {}
  ) {
    this.resetSignatures();

    const addr = new Address(address, { network: this.storage.config.getNetwork() });
    let script: P2SH | P2PKH;
    switch (addr.getType()) {
      case OutputType.P2SH:
        script = new P2SH(addr, { timelock });
        break;
      case OutputType.P2PKH:
        script = new P2PKH(addr, { timelock });
        break;
      default:
        throw new AddressError('Unsupported address type');
    }
    this.partialTx.addOutput(value, script.createScript(), { token, authorities, isChange });
  }

  /**
   * Calculate the token balance of the partial tx for a specific wallet.
   *
   * @returns {Record<string, Balance>}
   */
  async calculateBalance(): Promise<Record<string, Balance>> {
    const currentTimestamp = dateFormatter.dateToTimestamp(new Date());
    const isTimelocked = timelock => currentTimestamp < timelock;

    const getEmptyBalance = () => ({
      balance: { unlocked: 0n, locked: 0n },
      authority: { unlocked: { mint: 0n, melt: 0n }, locked: { mint: 0n, melt: 0n } },
    });

    const tokenBalance: Record<string, Balance> = {};

    for (const input of this.partialTx.inputs) {
      if (!(await this.storage.isAddressMine(input.address))) continue;

      if (!tokenBalance[input.token]) {
        tokenBalance[input.token] = getEmptyBalance();
      }

      if (input.isAuthority()) {
        // calculate authority balance
        tokenBalance[input.token].authority.unlocked.mint -=
          (input.value & TOKEN_MINT_MASK) > 0n ? 1n : 0n;
        tokenBalance[input.token].authority.unlocked.melt -=
          (input.value & TOKEN_MELT_MASK) > 0n ? 1n : 0n;
      } else {
        // calculate token balance
        tokenBalance[input.token].balance.unlocked -= input.value;
      }
    }

    for (const output of this.partialTx.outputs) {
      const decodedScript =
        output.decodedScript || output.parseScript(this.storage.config.getNetwork());

      // Catch data output and non-standard scripts cases
      if (decodedScript instanceof ScriptData || !decodedScript) continue;

      if (!(await this.storage.isAddressMine(decodedScript.address.base58))) continue;

      if (!tokenBalance[output.token]) {
        tokenBalance[output.token] = getEmptyBalance();
      }

      if (output.isAuthority()) {
        /**
         * Calculate authorities
         */
        if (isTimelocked(decodedScript.timelock)) {
          // Locked output
          tokenBalance[output.token].authority.locked.mint +=
            (output.value & TOKEN_MINT_MASK) > 0n ? 1n : 0n;
          tokenBalance[output.token].authority.locked.melt +=
            (output.value & TOKEN_MELT_MASK) > 0n ? 1n : 0n;
        } else {
          // Unlocked output
          tokenBalance[output.token].authority.unlocked.mint +=
            (output.value & TOKEN_MINT_MASK) > 0n ? 1n : 0n;
          tokenBalance[output.token].authority.unlocked.melt +=
            (output.value & TOKEN_MELT_MASK) > 0n ? 1n : 0n;
        }
      } else if (isTimelocked(decodedScript.timelock)) {
        /**
         * Calculate token balances
         */
        // Locked output
        tokenBalance[output.token].balance.locked += output.value;
      } else {
        // Unlocked output
        tokenBalance[output.token].balance.unlocked += output.value;
      }
    }

    return tokenBalance;
  }

  /**
   * Reset any data calculated from the partial tx.
   */
  resetSignatures() {
    this.signatures = null;
    this.transaction = null;
  }

  /**
   * Unmark all inputs currently on the partial tx as not `selected_as_input`.
   *
   * @param {HathorWallet} wallet Wallet of the UTXOs.
   */
  unmarkAsSelected() {
    for (const input of this.partialTx.inputs) {
      this.storage.utxoSelectAsInput({ txId: input.hash, index: input.index }, false);
    }
  }

  /**
   * Returns true if the transaction funds are balanced and the signatures match all inputs.
   *
   * @returns {boolean}
   */
  isComplete(): boolean {
    return !!this.signatures && this.partialTx.isComplete() && this.signatures.isComplete();
  }

  /**
   * Create the data to sign from the current transaction signing the loaded wallet inputs.
   *
   * @param {string} pin The loaded wallet's pin to sign the transaction.
   * @param {boolean} validate If we should validate the data with the fullnode before signing.
   *
   * @throws {InvalidPartialTxError} Inputs and outputs balance should match before signing.
   * @throws {UnsupportedScriptError} When we have an unsupported output script.
   * @throws {IndexOOBError} input index should be inside the inputs array.
   */
  async signData(pin: string, validate: boolean = true) {
    if (!this.partialTx.isComplete()) {
      // partialTx is not complete, we cannot sign it.
      throw new InvalidPartialTxError('Cannot sign incomplete data');
    }

    const tx: Transaction = this.partialTx.getTx();

    this.signatures = new PartialTxInputData(tx.getDataToSign().toString('hex'), tx.inputs.length);

    if (validate) {
      // The validation method populates the addresses
      const valid = await this.partialTx.validate();
      if (!valid) {
        throw new InvalidPartialTxError('Transaction data inconsistent with fullnode');
      }
    }

    // sign inputs from the loaded wallet and save input data
    await transactionUtils.signTransaction(tx, this.storage, pin);
    for (const [index, input] of tx.inputs.entries()) {
      if (input.data) {
        // add all signatures we know of this tx
        this.signatures.addData(index, input.data);
      }
    }
  }

  /**
   * Overwrites the proposal's signatures with the serialized contents in the parameters
   * @param serializedSignatures
   *
   * @throws {InvalidPartialTxError} Inputs and outputs balance should match before the signatures can be added.
   */
  setSignatures(serializedSignatures: string): void {
    if (!this.partialTx.isComplete()) {
      // partialTx is not complete, we cannot sign it.
      throw new InvalidPartialTxError('Cannot sign incomplete data');
    }
    const tx: Transaction = this.partialTx.getTx();

    // Validating signatures hash before setting them
    const arr = serializedSignatures.split('|');
    if (arr[1] !== tx.hash) {
      throw new InvalidPartialTxError('Signatures do not match tx hash');
    }

    // Creating an empty signatures object
    this.signatures = new PartialTxInputData(tx.getDataToSign().toString('hex'), tx.inputs.length);

    // Setting the signatures data from the parameters
    this.signatures.addSignatures(serializedSignatures);
  }

  /**
   * Create and return the Transaction instance if we have all signatures.
   *
   * @throws InvalidPartialTxError
   *
   * @returns {Transaction}
   */
  prepareTx(): Transaction {
    if (!this.partialTx.isComplete()) {
      throw new InvalidPartialTxError('Incomplete data');
    }

    if (this.signatures === null || !this.signatures.isComplete()) {
      throw new InvalidPartialTxError('Incomplete signatures');
    }

    if (this.transaction !== null) {
      return this.transaction;
    }

    for (const [index, inputData] of Object.entries(this.signatures.data)) {
      this.partialTx.inputs[index].setData(inputData);
    }
    this.transaction = this.partialTx.getTx();
    this.transaction.prepareToSend();
    return this.transaction;
  }
}

export default PartialTxProposal;

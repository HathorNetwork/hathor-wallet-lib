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
import { AddressError, InvalidPartialTxError, InsufficientFundsError } from '../errors';
import Network from '../models/network';
import HathorWallet from '../new/wallet';
import {
  HATHOR_TOKEN_CONFIG,
  TOKEN_MELT_MASK,
  TOKEN_MINT_MASK,
} from '../constants';

import transaction from '../transaction';
import helpers from '../utils/helpers';
import transactionUtils from '../utils/transaction';
import dateFormatter from '../date';

import { OutputType, Utxo } from './types';
import { Balance } from '../models/types';

export interface UtxoExtended extends Utxo {
  tokenData?: number
}

class PartialTxProposal {

  network: Network;
  public partialTx: PartialTx;
  public signatures: PartialTxInputData|null;
  public transaction: Transaction|null;

  /**
   * @param {Network} network
   */
  constructor(network: Network) {
    this.network = network;
    this.partialTx = new PartialTx(this.network);
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
  static fromPartialTx(serialized: string, network: Network): PartialTxProposal {
    const partialTx = PartialTx.deserialize(serialized, network);
    const proposal = new PartialTxProposal(network);
    proposal.partialTx = partialTx;
    return proposal;
  }

  /**
   * Get all available utxos on the wallet history for a token
   * and enrich them with tokenData.
   *
   * @param {HathorWallet} wallet Wallet which will provide the tokens.
   * @param {string?} [token='00'] UID of token that is being sent
   *
   * @returns {UtxoExtended[]}
   */
  static getWalletUtxos(
    wallet: HathorWallet,
    token: string = HATHOR_TOKEN_CONFIG.uid,
  ): UtxoExtended[] {
    const historyTransactions = wallet.getFullHistory();
    const allUtxos = [...wallet.getAllUtxos({ token })].filter(utxo => utxo.authorities === 0);
    const allExtendedUtxos: UtxoExtended[] = [];
    for (const utxo of allUtxos) {
      // Since we chose the utxos from the historyTransactions, we can be sure this exists.
      const txout = historyTransactions[utxo.txId].outputs[utxo.index];
      allExtendedUtxos.push({
        ...utxo,
        tokenData: txout.token_data,
      });
    }

    return allExtendedUtxos;
  }

  /**
   * Add inputs sending the amount of tokens specified, may add a change output.
   *
   * @param {HathorWallet} wallet Wallet which will provide the tokens.
   * @param {string} token UID of token that is being sent
   * @param {number} value Quantity of tokens being sent
   * @param {Object} [options]
   * @param {UtxoExtended[]|null} [options.changeAddress=null] If we add change, use this address instead of getting a new one from the wallet.
   * @param {string|null} [options.changeAddress=null] If we add change, use this address instead of getting a new one from the wallet.
   * @param {boolean} [options.markAsSelected=true] Mark the utxo with `selected_as_input`.
   */
  addSend(
    wallet: HathorWallet,
    token: string,
    value: number,
    {
      utxos = null,
      changeAddress = null,
      markAsSelected = true,
    }: { utxos?: UtxoExtended[]|null, changeAddress?: string|null, markAsSelected?: boolean } = {},
  ) {
    this.resetSignatures();

    // Since the selectUtxos returns a list of Utxo
    // we need a way to access the original utxo for the tokenData.
    const utxosDict: Record<string, UtxoExtended> = {};
    // Use the pool of utxos or all wallet utxos.
    const allUtxos: UtxoExtended[] = (utxos && utxos.length > 0)
      ? utxos
      : PartialTxProposal.getWalletUtxos(wallet, token);

    // Filter pool of utxos for only utxos from the token and not already in the partial tx
    const currentUtxos = this.partialTx.inputs.map(input => `${input.hash}-${input.index}`);
    const utxosToUse = allUtxos.filter(utxo => utxo.tokenId === token && !currentUtxos.includes(`${utxo.txId}-${utxo.index}`));

    for (const utxo of utxosToUse) {
      utxosDict[`${utxo.txId}-${utxo.index}`] = utxo;
    }
    const utxosDetails = transactionUtils.selectUtxos(utxosToUse, value);

    for (const utxo of utxosDetails.utxos) {
      const { tokenData } = utxosDict[`${utxo.txId}-${utxo.index}`];
      this.addInput(
        wallet,
        utxo.txId,
        utxo.index,
        utxo.value,
        utxo.address,
        { token: utxo.tokenId, tokenData, markAsSelected },
      );
    }

    // add change output if needed
    if (utxosDetails.changeAmount > 0) {
      const address: string = changeAddress || wallet.getCurrentAddress().address;
      this.addOutput(
        token,
        utxosDetails.changeAmount,
        address,
        { isChange: true },
      );
    }
  }

  /**
   * Add outputs receiving the amount of tokens specified.
   *
   * @param {HathorWallet} wallet Wallet which will receive the tokens.
   * @param {string} token UID of token that is being sent
   * @param {number} value Quantity of tokens being sent
   * @param {Object} [options]
   * @param {number|null} [options.timelock=null] UNIX timestamp of the timelock.
   * @param {string|null} [options.address=null] Output address to receive the tokens.
   *
   */
  addReceive(
    wallet: HathorWallet,
    token: string,
    value: number,
    { timelock = null, address = null }: { timelock?: number|null, address?: string|null } = {}) {
    this.resetSignatures();

    // get an address of our wallet and add the output
    const addr: string = address || wallet.getCurrentAddress().address;
    this.addOutput(token, value, addr, { timelock });
  }

  /**
   * Add an UTXO as input on the partial data.
   *
   * @param {HathorWallet} wallet Wallet which will provide the tokens.
   * @param {string} hash Transaction hash
   * @param {number} index UTXO index on the outputs of the transaction.
   * @param {number} value UTXO value.
   * @param {Object} [options]
   * @param {string} [options.token='00'] Token UID in hex format.
   * @param {number} [options.tokenData=0] TokenData of the UTXO.
   * @param {string|null} [options.address=null] Address that owns the UTXO.
   * @param {boolean} [options.markAsSelected=true] Mark the utxo with `selected_as_input`.
   */
  addInput(
    wallet: HathorWallet,
    hash: string,
    index: number,
    value: number,
    address: string,
    {
      token = HATHOR_TOKEN_CONFIG.uid,
      tokenData = 0,
      markAsSelected = true,
    }: {
      token?: string,
      tokenData?: number,
      markAsSelected?: boolean,
    } = {},
  ) {
    this.resetSignatures();

    if (markAsSelected) {
      wallet.markUtxoSelected(hash, index);
    }

    this.partialTx.addInput(hash, index, value, address, { token, tokenData });
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
   * @param {number} [options.tokenData=0] TokenData of the Output.
   *
   * @throws AddressError
   */
  addOutput(
    token: string,
    value: number,
    address: string,
    {
      timelock = null,
      isChange = false,
      tokenData = 0
    }: { timelock?: number|null, isChange?: boolean, tokenData?: number } = {}
  ) {
    this.resetSignatures();

    const addr = new Address(address, {network: this.network});
    let script;
    switch(addr.getType()) {
      case OutputType.P2SH:
        script = new P2SH(addr, { timelock });
        break
      case OutputType.P2PKH:
        script = new P2PKH(addr, { timelock });
        break
      default:
        throw new AddressError('Unsupported address type');
    }
    this.partialTx.addOutput(value, script.createScript(), { token, tokenData, isChange });
  }

  /**
   * Calculate the token balance of the partial tx for a specific wallet.
   *
   * @param {HathorWallet} wallet Calculate the balance for this wallet.
   *
   * @returns {Record<string, Balance>}
   */
  calculateBalance(wallet: HathorWallet): Record<string, Balance> {
    const currentTimestamp = dateFormatter.dateToTimestamp(new Date());
    const isTimelocked = timelock => currentTimestamp < timelock;

    const getEmptyBalance = () => ({
      balance: { unlocked: 0, locked: 0 },
      authority: { unlocked: { mint: 0, melt: 0 }, locked: { mint: 0, melt: 0 } },
    });

    const tokenBalance: Record<string, Balance> = {};

    for (const input of this.partialTx.inputs) {
      if (!wallet.isAddressMine(input.address)) continue;

      if (!tokenBalance[input.token]) {
        tokenBalance[input.token] = getEmptyBalance();
      }

      if (input.isAuthority()) {
        // calculate authority balance
        tokenBalance[input.token].authority.unlocked.mint -= (input.value & TOKEN_MINT_MASK) > 0 ? 1 : 0;
        tokenBalance[input.token].authority.unlocked.melt -= (input.value & TOKEN_MELT_MASK) > 0 ? 1 : 0;
      } else {
        // calculate token balance
        tokenBalance[input.token].balance.unlocked -= input.value;
      }
    }

    for (const output of this.partialTx.outputs) {
      const decodedScript = output.decodedScript || output.parseScript(this.network);

      // Catch data output and non-standard scripts cases
      if (decodedScript instanceof ScriptData || !decodedScript) continue;

      if (!wallet.isAddressMine(decodedScript.address.base58)) continue;

      if (!tokenBalance[output.token]) {
        tokenBalance[output.token] = getEmptyBalance();
      }

      if (output.isAuthority()) {
        /**
         * Calculate authorities
         */
        if (isTimelocked(decodedScript.timelock)) {
          // Locked output
          tokenBalance[output.token].authority.locked.mint += (output.value & TOKEN_MINT_MASK) > 0 ? 1 : 0;
          tokenBalance[output.token].authority.locked.melt += (output.value & TOKEN_MELT_MASK) > 0 ? 1 : 0;
        } else {
          // Unlocked output
          tokenBalance[output.token].authority.unlocked.mint += (output.value & TOKEN_MINT_MASK) > 0 ? 1 : 0;
          tokenBalance[output.token].authority.unlocked.melt += (output.value & TOKEN_MELT_MASK) > 0 ? 1 : 0;
        }
      } else {
        /**
         * Calculate token balances
         */
        if (isTimelocked(decodedScript.timelock)) {
          // Locked output
          tokenBalance[output.token].balance.locked += output.value;
        } else {
          // Unlocked output
          tokenBalance[output.token].balance.unlocked += output.value;
        }
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
  unmarkAsSelected(wallet: HathorWallet) {
    for(const input of this.partialTx.inputs) {
      wallet.markUtxoSelected(input.hash, input.index, false);
    }
  }

  /**
   * Returns true if the transaction funds are balanced and the signatures match all inputs.
   *
   * @returns {boolean}
   */
  isComplete(): boolean {
    return (!!this.signatures) && this.partialTx.isComplete() && this.signatures.isComplete();
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

    this.signatures = new PartialTxInputData(
      tx.getDataToSign().toString('hex'),
      tx.inputs.length
    );

    if (validate) {
      // The validation method populates the addresses
      const valid = await this.partialTx.validate();
      if (!valid) {
        throw new InvalidPartialTxError('Transaction data inconsistent with fullnode');
      }
    }

    // sign inputs from the loaded wallet and save input data
    const txdata = transaction.prepareData(this.partialTx.getTxData(), pin);

    for (const [index, input] of txdata.inputs.entries()) {
      if ('data' in input && input.data.length > 0) {
        // add all signatures we know of this tx
        this.signatures.addData(index, input.data);
      }
    }
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

    const txdata = this.partialTx.getTxData();

    for (const [index, inputData] of Object.entries(this.signatures.data)) {
      txdata.inputs[index].data = inputData;
    }

    this.transaction = helpers.createTxFromData(
      transaction.prepareData(txdata, '', { getSignature: false }),
      this.network,
    );

    return this.transaction;
  }
}

export default PartialTxProposal;

"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _bitcoreLib = require("bitcore-lib");
var _errors = require("../errors");
var _constants = require("../constants");
var _transaction = _interopRequireDefault(require("../models/transaction"));
var _create_token_transaction = _interopRequireDefault(require("../models/create_token_transaction"));
var _input = _interopRequireDefault(require("../models/input"));
var _output = _interopRequireDefault(require("../models/output"));
var _types = require("../types");
var _address = _interopRequireDefault(require("../models/address"));
var _p2pkh = _interopRequireDefault(require("../models/p2pkh"));
var _p2sh = _interopRequireDefault(require("../models/p2sh"));
var _script_data = _interopRequireDefault(require("../models/script_data"));
var _helpers = _interopRequireDefault(require("./helpers"));
var _address2 = require("./address");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _asyncIterator(r) { var n, t, o, e = 2; for ("undefined" != typeof Symbol && (t = Symbol.asyncIterator, o = Symbol.iterator); e--;) { if (t && null != (n = r[t])) return n.call(r); if (o && null != (n = r[o])) return new AsyncFromSyncIterator(n.call(r)); t = "@@asyncIterator", o = "@@iterator"; } throw new TypeError("Object is not async iterable"); }
function AsyncFromSyncIterator(r) { function AsyncFromSyncIteratorContinuation(r) { if (Object(r) !== r) return Promise.reject(new TypeError(r + " is not an object.")); var n = r.done; return Promise.resolve(r.value).then(function (r) { return { value: r, done: n }; }); } return AsyncFromSyncIterator = function (r) { this.s = r, this.n = r.next; }, AsyncFromSyncIterator.prototype = { s: null, n: null, next: function () { return AsyncFromSyncIteratorContinuation(this.n.apply(this.s, arguments)); }, return: function (r) { var n = this.s.return; return void 0 === n ? Promise.resolve({ value: r, done: !0 }) : AsyncFromSyncIteratorContinuation(n.apply(this.s, arguments)); }, throw: function (r) { var n = this.s.return; return void 0 === n ? Promise.reject(r) : AsyncFromSyncIteratorContinuation(n.apply(this.s, arguments)); } }, new AsyncFromSyncIterator(r); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const transaction = {
  /**
   * Return if a tx is a block or not.
   *
   * @param {Pick<IHistoryTx, 'version'>} tx - Transaction to check
   * @returns {boolean}
   */
  isBlock(tx) {
    return tx.version === _constants.BLOCK_VERSION || tx.version === _constants.MERGED_MINED_BLOCK_VERSION || tx.version === _constants.POA_BLOCK_VERSION;
  },
  /**
   * Check if the output is an authority output
   *
   * @param {Pick<HistoryTransactionOutput, 'token_data'>} output An output with the token_data field
   * @returns {boolean} If the output is an authority output
   */
  isAuthorityOutput(output) {
    return (output.token_data & _constants.TOKEN_AUTHORITY_MASK) > 0;
  },
  /**
   * Check if the output is a mint authority output
   *
   * @param {Pick<HistoryTransactionOutput, 'token_data'|'value'>} output An output with the token_data and value fields
   * @returns {boolean} If the output is a mint authority output
   */
  isMint(output) {
    return this.isAuthorityOutput(output) && (output.value & _constants.TOKEN_MINT_MASK) > 0;
  },
  /**
   * Check if the output is a melt authority output
   *
   * @param {Pick<HistoryTransactionOutput, 'token_data'|'value'>} output An output with the token_data and value fields
   * @returns {boolean} If the output is a melt authority output
   */
  isMelt(output) {
    return this.isAuthorityOutput(output) && (output.value & _constants.TOKEN_MELT_MASK) > 0;
  },
  /**
   * Check if the utxo is locked
   *
   * @param {Pick<HistoryTransactionOutput, 'decoded'>} output The output to check
   * @param {{refTs: number|undefined}} options Use these values as reference to check if the output is locked
   * @returns {boolean} Wheather the output is locked or not
   */
  isOutputLocked(output, options = {}) {
    // XXX: check reward lock: requires blockHeight, bestBlockHeight and reward_spend_min_blocks
    const refTs = options.refTs || Math.floor(Date.now() / 1000);
    return output.decoded.timelock !== undefined && output.decoded.timelock !== null && refTs < output.decoded.timelock;
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
  isHeightLocked(blockHeight, currentHeight, rewardLock) {
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
  getSignature(dataToSignHash, privateKey) {
    const signature = _bitcoreLib.crypto.ECDSA.sign(dataToSignHash, privateKey).set({
      nhashtype: _bitcoreLib.crypto.Signature.SIGHASH_ALL
    });
    return signature.toDER();
  },
  /**
   * Get the signatures for a transaction
   * @param tx Transaction to sign
   * @param storage Storage of the wallet
   * @param pinCode Pin to unlock the mainKey for signatures
   */
  async getSignatureForTx(tx, storage, pinCode) {
    const xprivstr = await storage.getMainXPrivKey(pinCode);
    const xprivkey = _bitcoreLib.HDPrivateKey.fromString(xprivstr);
    const dataToSignHash = tx.getDataToSignHash();
    const signatures = [];
    let ncCallerSignature = null;
    var _iteratorAbruptCompletion = false;
    var _didIteratorError = false;
    var _iteratorError;
    try {
      for (var _iterator = _asyncIterator(storage.getSpentTxs(tx.inputs)), _step; _iteratorAbruptCompletion = !(_step = await _iterator.next()).done; _iteratorAbruptCompletion = false) {
        const {
          tx: spentTx,
          input,
          index: inputIndex
        } = _step.value;
        {
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
            pubkey: xpriv.publicKey.toDER()
          });
        }
      }
    } catch (err) {
      _didIteratorError = true;
      _iteratorError = err;
    } finally {
      try {
        if (_iteratorAbruptCompletion && _iterator.return != null) {
          await _iterator.return();
        }
      } finally {
        if (_didIteratorError) {
          throw _iteratorError;
        }
      }
    }
    if (tx.version === _constants.NANO_CONTRACTS_VERSION) {
      const {
        pubkey
      } = tx;
      const address = (0, _address2.getAddressFromPubkey)(pubkey.toString('hex'), storage.config.getNetwork());
      const addressInfo = await storage.getAddressInfo(address.base58);
      if (!addressInfo) {
        throw new Error('No address info found');
      }
      const xpriv = xprivkey.deriveNonCompliantChild(addressInfo.bip32AddressIndex);
      ncCallerSignature = this.getSignature(dataToSignHash, xpriv.privateKey);
    }
    return {
      inputSignatures: signatures,
      ncCallerSignature
    };
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
  async signTransaction(tx, storage, pinCode) {
    const signatures = await storage.getTxSignatures(tx, pinCode);
    for (const sigData of signatures.inputSignatures) {
      const input = tx.inputs[sigData.inputIndex];
      const inputData = this.createInputData(sigData.signature, sigData.pubkey);
      input.setData(inputData);
    }
    if (tx.version === _constants.NANO_CONTRACTS_VERSION) {
      // eslint-disable-next-line no-param-reassign
      tx.signature = signatures.ncCallerSignature;
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
  selectUtxos(utxos, totalAmount) {
    if (totalAmount <= 0) {
      throw new _errors.UtxoError('Total amount must be a positive integer.');
    }
    if (utxos.length === 0) {
      throw new _errors.UtxoError("Don't have enough utxos to fill total amount.");
    }
    let utxosToUse = [];
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
      throw new _errors.UtxoError("Don't have enough utxos to fill total amount.");
    }
    return {
      utxos: utxosToUse,
      changeAmount: filledAmount - totalAmount
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
  utxoFromHistoryOutput(txId, index, txout, {
    addressPath = ''
  }) {
    const isAuthority = this.isAuthorityOutput(txout);
    return {
      txId,
      index,
      addressPath,
      address: txout.decoded && txout.decoded.address || '',
      timelock: txout.decoded && txout.decoded.timelock || null,
      tokenId: txout.token,
      value: txout.value,
      authorities: isAuthority ? txout.value : 0n,
      heightlock: null,
      // not enough info to determine this.
      locked: false
    };
  },
  /**
   * Calculate the balance of a transaction
   *
   * @param tx Transaction to get balance from
   * @param storage Storage to get metadata from
   * @returns {Promise<Record<string, IBalance>>} Balance of the transaction
   */
  async getTxBalance(tx, storage) {
    const balance = {};
    const getEmptyBalance = () => ({
      tokens: {
        locked: 0n,
        unlocked: 0n
      },
      authorities: {
        mint: {
          locked: 0n,
          unlocked: 0n
        },
        melt: {
          locked: 0n,
          unlocked: 0n
        }
      }
    });
    const nowTs = Math.floor(Date.now() / 1000);
    const nowHeight = await storage.getCurrentHeight();
    const rewardLock = storage.version?.reward_spend_min_blocks;
    const isHeightLocked = this.isHeightLocked(tx.height, nowHeight, rewardLock);
    for (const output of tx.outputs) {
      const {
        address
      } = output.decoded;
      if (!(address && (await storage.isAddressMine(address)))) {
        continue;
      }
      if (!balance[output.token]) {
        balance[output.token] = getEmptyBalance();
      }
      const isLocked = this.isOutputLocked(output, {
        refTs: nowTs
      }) || isHeightLocked;
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
      const {
        address
      } = input.decoded;
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
  async calculateTxBalanceToFillTx(token, tx) {
    const balance = {
      funds: 0n,
      mint: 0n,
      melt: 0n
    };
    for (const output of tx.outputs) {
      if ((0, _types.isDataOutputCreateToken)(output)) {
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
  getTokenDataFromOutput(output, tokens) {
    if ((0, _types.isDataOutputCreateToken)(output)) {
      // This output does not contain the token since it will be creating
      // But knowing this, we also know the token index of it.
      if (output.authorities === 0n) {
        return 1;
      }
      return 1 | _constants.TOKEN_AUTHORITY_MASK;
    }

    // Token index of HTR is 0 and if it is a custom token it is its index on tokensWithoutHathor + 1
    const tokensWithoutHathor = tokens.filter(token => token !== _constants.NATIVE_TOKEN_UID);
    const tokenIndex = tokensWithoutHathor.indexOf(output.token) + 1;
    if (output.authorities === 0n) {
      return tokenIndex;
    }
    return tokenIndex | _constants.TOKEN_AUTHORITY_MASK;
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
  createOutputScript(output, network) {
    if (output.type === 'data') {
      // Data script for NFT
      const scriptData = new _script_data.default(output.data);
      return scriptData.createScript();
    }
    if ((0, _address2.getAddressType)(output.address, network) === 'p2sh') {
      // P2SH
      const address = new _address.default(output.address, {
        network
      });
      // This will throw AddressError in case the address is invalid
      address.validateAddress();
      const p2sh = new _p2sh.default(address, {
        timelock: output.timelock
      });
      return p2sh.createScript();
    }
    if ((0, _address2.getAddressType)(output.address, network) === 'p2pkh') {
      // P2PKH
      const address = new _address.default(output.address, {
        network
      });
      // This will throw AddressError in case the address is invalid
      address.validateAddress();
      const p2pkh = new _p2pkh.default(address, {
        timelock: output.timelock
      });
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
  createTransactionFromData(txData, network) {
    const inputs = txData.inputs.map(input => {
      const inputObj = new _input.default(input.txId, input.index);
      if (input.data) {
        inputObj.setData(Buffer.from(input.data, 'hex'));
      }
      return inputObj;
    });
    const outputs = txData.outputs.map(output => {
      const script = this.createOutputScript(output, network);
      const tokenData = this.getTokenDataFromOutput(output, txData.tokens);
      return new _output.default(output.value, script, {
        tokenData
      });
    });
    const options = {
      signalBits: txData.signalBits === undefined ? _constants.DEFAULT_SIGNAL_BITS : txData.signalBits,
      version: txData.version === undefined ? _constants.DEFAULT_TX_VERSION : txData.version,
      weight: txData.weight || 0,
      nonce: txData.nonce || 0,
      timestamp: txData.timestamp || null,
      parents: txData.parents || [],
      tokens: txData.tokens || []
    };
    if (options.version === _constants.CREATE_TOKEN_TX_VERSION) {
      return new _create_token_transaction.default(txData.name, txData.symbol, inputs, outputs, options);
    }
    if (options.version === _constants.DEFAULT_TX_VERSION) {
      return new _transaction.default(inputs, outputs, options);
    }
    throw new _errors.ParseError('Invalid transaction version.');
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
  async prepareTransaction(txData, pinCode, storage, options) {
    const newOptions = {
      signTx: true,
      ...options
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
  createInputData(signature, publicKey) {
    const arr = [];
    _helpers.default.pushDataToStack(arr, signature);
    _helpers.default.pushDataToStack(arr, publicKey);
    return Buffer.concat(arr);
  },
  /**
   * Calculate the authorities data for an output
   *
   * @param output History output
   * @returns {OutputValueType} Authorities from output
   */
  authoritiesFromOutput(output) {
    let authorities = 0n;
    if (this.isMint(output)) {
      authorities |= _constants.TOKEN_MINT_MASK;
    }
    if (this.isMelt(output)) {
      authorities |= _constants.TOKEN_MELT_MASK;
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
  async canUseUtxo(utxo, storage) {
    const currentHeight = await storage.getCurrentHeight();
    const rewardLock = storage.version?.reward_spend_min_blocks || 0;
    const nowTs = Math.floor(Date.now() / 1000);
    const tx = await storage.getTx(utxo.txId);
    if (tx === null || tx.outputs && tx.outputs.length <= utxo.index) {
      // This is not our utxo, so we cannot spend it.
      return false;
    }
    const output = tx.outputs[utxo.index];
    const isTimelocked = this.isOutputLocked(output, {
      refTs: nowTs
    });
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
  getTxType(tx) {
    if (this.isBlock(tx)) {
      if (tx.version === _constants.BLOCK_VERSION) {
        return 'Block';
      }
      if (tx.version === _constants.MERGED_MINED_BLOCK_VERSION) {
        return 'Merged Mining Block';
      }
      if (tx.version === _constants.POA_BLOCK_VERSION) {
        return 'Proof-of-Authority Block';
      }
    } else {
      if (tx.version === _constants.DEFAULT_TX_VERSION) {
        return 'Transaction';
      }
      if (tx.version === _constants.CREATE_TOKEN_TX_VERSION) {
        return 'Create Token Transaction';
      }
      if (tx.version === _constants.NANO_CONTRACTS_VERSION) {
        return 'Nano Contract';
      }
    }

    // If there is no match
    return 'Unknown';
  }
};
var _default = exports.default = transaction;
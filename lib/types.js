"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.WalletType = exports.WALLET_FLAGS = exports.TxHistoryProcessingStatus = exports.SCANNING_POLICY = exports.HistorySyncMode = void 0;
exports.getDefaultLogger = getDefaultLogger;
exports.isDataOutputAddress = isDataOutputAddress;
exports.isDataOutputCreateToken = isDataOutputCreateToken;
exports.isDataOutputData = isDataOutputData;
exports.isGapLimitScanPolicy = isGapLimitScanPolicy;
exports.isIndexLimitScanPolicy = isIndexLimitScanPolicy;
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Logger interface where each method is a leveled log method.
 */

/**
 * Get the default logger instance, the console
 */
function getDefaultLogger() {
  return console;
}
let HistorySyncMode = exports.HistorySyncMode = /*#__PURE__*/function (HistorySyncMode) {
  HistorySyncMode["POLLING_HTTP_API"] = "polling-http-api";
  HistorySyncMode["MANUAL_STREAM_WS"] = "manual-stream-ws";
  HistorySyncMode["XPUB_STREAM_WS"] = "xpub-stream-ws";
  return HistorySyncMode;
}({});
/**
 * This is the method signature for a method that signs a transaction and
 * returns an array with signature information.
 */
let TxHistoryProcessingStatus = exports.TxHistoryProcessingStatus = /*#__PURE__*/function (TxHistoryProcessingStatus) {
  TxHistoryProcessingStatus["PROCESSING"] = "processing";
  TxHistoryProcessingStatus["FINISHED"] = "finished";
  return TxHistoryProcessingStatus;
}({}); // Obs: this will change with nano contracts
function isDataOutputData(output) {
  return output.type === 'data';
}
function isDataOutputAddress(output) {
  return ['p2pkh', 'p2sh'].includes(output.type);
}

// This is for create token transactions, where we dont have a token uid yet

function isDataOutputCreateToken(output) {
  return ['mint', 'melt'].includes(output.type);
}

// XXX: This type is meant to be used as an intermediary for building transactions
// It should have everything we need to build and push transactions.
let WalletType = exports.WalletType = /*#__PURE__*/function (WalletType) {
  WalletType["P2PKH"] = "p2pkh";
  WalletType["MULTISIG"] = "multisig";
  return WalletType;
}({});
let WALLET_FLAGS = exports.WALLET_FLAGS = /*#__PURE__*/function (WALLET_FLAGS) {
  WALLET_FLAGS[WALLET_FLAGS["READONLY"] = 1] = "READONLY";
  WALLET_FLAGS[WALLET_FLAGS["HARDWARE"] = 2] = "HARDWARE";
  return WALLET_FLAGS;
}({});
let SCANNING_POLICY = exports.SCANNING_POLICY = /*#__PURE__*/function (SCANNING_POLICY) {
  SCANNING_POLICY["GAP_LIMIT"] = "gap-limit";
  SCANNING_POLICY["INDEX_LIMIT"] = "index-limit";
  return SCANNING_POLICY;
}({});
/**
 * This is a request from the scanning policy to load `count` addresses starting from nextIndex.
 */
function isGapLimitScanPolicy(scanPolicyData) {
  return scanPolicyData.policy === SCANNING_POLICY.GAP_LIMIT;
}
function isIndexLimitScanPolicy(scanPolicyData) {
  return scanPolicyData.policy === SCANNING_POLICY.INDEX_LIMIT;
}

/**
 */
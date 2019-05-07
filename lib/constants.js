'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SEND_TOKENS_TIMEOUT = exports.TIMEOUT = exports.NETWORK = exports.P2SH_BYTE = exports.P2PKH_BYTE = exports.HATHOR_TOKEN_INDEX = exports.HATHOR_TOKEN_CONFIG = exports.TOKEN_MELT_MASK = exports.TOKEN_MINT_MASK = exports.TOKEN_CREATION_MASK = exports.TOKEN_AUTHORITY_MASK = exports.TOKEN_INDEX_MASK = exports.HD_WALLET_ENTROPY = exports.MAX_OUTPUT_VALUE = exports.MAX_OUTPUT_VALUE_32 = exports.DEFAULT_TX_VERSION = exports.DEFAULT_SERVER = exports.DEFAULT_SERVERS = exports.HATHOR_BIP44_CODE = exports.LIMIT_ADDRESS_GENERATION = exports.MIN_API_VERSION = exports.GAP_LIMIT = exports.GENESIS_TX = exports.GENESIS_BLOCK = exports.DECIMAL_PLACES = undefined;

var _bitcoreLib = require('bitcore-lib');

/**
 * Constants defined for the Hathor Wallet
 * @module Constants
 */

/**
 * Quantity of decimal places of tokens amount
 */
var DECIMAL_PLACES = exports.DECIMAL_PLACES = 2;

/**
 * ID of the genesis block
 */
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

var GENESIS_BLOCK = exports.GENESIS_BLOCK = ['000164e1e7ec7700a18750f9f50a1a9b63f6c7268637c072ae9ee181e58eb01b'];

/**
 * ID of the genesis transactions
 */
var GENESIS_TX = exports.GENESIS_TX = ['00029b7f8051f6ebdc0338d02d4a8cfbd662500ee03224bbee75a6f2da0350b0', '0001e887c7b5ec3b4e57033d849a80d8bccbe3a749abfa87cc31c663530f3f4e'];

/**
 * How many addresses we can have without being used
 */
var GAP_LIMIT = exports.GAP_LIMIT = 20;

/**
 * Minimum expected API version
 */
var MIN_API_VERSION = exports.MIN_API_VERSION = '0.24.0-beta';

/**
 * If we should forbid to generate a quantity of unused addresses more than the GAP_LIMIT
 */
var LIMIT_ADDRESS_GENERATION = exports.LIMIT_ADDRESS_GENERATION = true;

/**
 * Hathor address BIP44 code  
 * (listed here: https://github.com/satoshilabs/slips/blob/master/slip-0044.md)
 */
var HATHOR_BIP44_CODE = exports.HATHOR_BIP44_CODE = 280;

/**
 * Server options for the user to choose which one to connect
 */
var DEFAULT_SERVERS = exports.DEFAULT_SERVERS = ['https://node1.alpha.testnet.hathor.network/v1a/', 'https://node2.alpha.testnet.hathor.network/v1a/', 'https://node3.alpha.testnet.hathor.network/v1a/', 'https://node4.alpha.testnet.hathor.network/v1a/'];

/**
 * Default server user will connect when none have been chosen
 */
var DEFAULT_SERVER = exports.DEFAULT_SERVER = DEFAULT_SERVERS[0];

/**
 * Transaction version field
 */
// FIXME tx version should not be hardcoded
var DEFAULT_TX_VERSION = exports.DEFAULT_TX_VERSION = 1;

/**
 * Max value (inclusive) before having to use 8 bytes: 2147483648 ~= 2.14748e+09
 */
var MAX_OUTPUT_VALUE_32 = exports.MAX_OUTPUT_VALUE_32 = 2 ** 31 - 1;

/**
 * Max accepted value for an output
 * Because of a precision problem in javascript we don't handle all 8 bytes of value
 */
var MAX_OUTPUT_VALUE = exports.MAX_OUTPUT_VALUE = 2 ** 43;

/**
 * Entropy for the new HD wallet words
 */
var HD_WALLET_ENTROPY = exports.HD_WALLET_ENTROPY = 256;

/**
 * Mask to get token index from token data
 */
var TOKEN_INDEX_MASK = exports.TOKEN_INDEX_MASK = 127;

/**
 * Mask to check if it's authority output (first bit indicates it)
 */
var TOKEN_AUTHORITY_MASK = exports.TOKEN_AUTHORITY_MASK = 128;

/**
 * Mask to check if it's token id creation UTXO (last bit indicates it)
 */
var TOKEN_CREATION_MASK = exports.TOKEN_CREATION_MASK = 1;

/**
 * Mask to check if it's mint UTXO (second to last bit indicates it)
 */
var TOKEN_MINT_MASK = exports.TOKEN_MINT_MASK = 2;

/**
 * Mask to check if it's melt UTXO (third bit from right to left indicates it)
 */
var TOKEN_MELT_MASK = exports.TOKEN_MELT_MASK = 4;

/**
 * Hathor token config
 */
var HATHOR_TOKEN_CONFIG = exports.HATHOR_TOKEN_CONFIG = { 'name': 'Hathor', 'symbol': 'HTR', 'uid': '00' };

/**
 * Hathor token default index
 */
var HATHOR_TOKEN_INDEX = exports.HATHOR_TOKEN_INDEX = 0;

// Version bytes for address generation
// Mainnet: P2PKH will start with H and P2SH will start with h
// Testnet: P2PKH will start with W and P2SH will start with w
var versionBytes = {
  'mainnet': {
    'p2pkh': 0x28,
    'p2sh': 0x64
  },
  'testnet': {
    'p2pkh': 0x49,
    'p2sh': 0x87
  }

  // Networks is an object of the bitcore-lib
  // Some of it's parameters are not used by us (network parameters), so I just kept their default
  // name: network name
  // alias: another name we can use as the network name
  // pubkeyhash: prefix for p2pkh addresses
  // scripthash: prefix for p2sh addresses
  // privatekey: prefix for private key WIF (Wallet Import Format)
  // xpubkey: prefix for xpubkeys (we will use 'xpub' for both mainnet and testnet)
  // xprivkey: prefix for xprivkeys (we will use 'xprv' for both mainnet and testnet)
  // networkMagic: used to send messages through the network (not used by us)
  // port: used to connect to the network (not used by us)
  // dnsSeed: list of dns to connect (not used by us)

};var mainnet = _bitcoreLib.Networks.add({
  name: 'mainnet',
  alias: 'production',
  pubkeyhash: versionBytes['mainnet']['p2pkh'],
  privatekey: 0x80,
  scripthash: versionBytes['mainnet']['p2sh'],
  xpubkey: 0x0488b21e,
  xprivkey: 0x0488ade4,
  networkMagic: 0xf9beb4d9,
  port: 8333,
  dnsSeeds: []
});

var testnet = _bitcoreLib.Networks.add({
  name: 'testnet',
  alias: 'test',
  pubkeyhash: versionBytes['testnet']['p2pkh'],
  privatekey: 0x80,
  scripthash: versionBytes['testnet']['p2sh'],
  xpubkey: 0x0488b21e,
  xprivkey: 0x0488ade4,
  networkMagic: 0xf9beb4d9,
  port: 8333,
  dnsSeeds: []
});

var networks = {
  testnet: testnet,
  mainnet: mainnet
};

var currentNetwork = process.env.HATHOR_WALLET_NETWORK || 'testnet';

/**
 * Version byte for the P2PKH address
 */
var P2PKH_BYTE = exports.P2PKH_BYTE = versionBytes[currentNetwork].p2pkh;

/**
 * Version byte for the P2SH address
 */
var P2SH_BYTE = exports.P2SH_BYTE = versionBytes[currentNetwork].p2sh;

/**
 * Selected address ('mainnet' or 'testnet')  
 * Selected using HATHOR_WALLET_NETWORK environment variable
 */
var NETWORK = exports.NETWORK = networks[currentNetwork];

/**
 * Default timeout for each request in milliseconds
 */
var TIMEOUT = exports.TIMEOUT = 10000;

/**
 * Default timeout for send tokens request in milliseconds
 */
var SEND_TOKENS_TIMEOUT = exports.SEND_TOKENS_TIMEOUT = 300000;
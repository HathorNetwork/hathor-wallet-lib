/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Networks } from 'bitcore-lib';

/**
 * Constants defined for the Hathor Wallet
 * @module Constants
 */

/**
 * Quantity of decimal places of tokens amount
 */
export const DECIMAL_PLACES = 2;

/**
 * ID of the genesis block
 */
export const GENESIS_BLOCK = [
  '000164e1e7ec7700a18750f9f50a1a9b63f6c7268637c072ae9ee181e58eb01b'
]

/**
 * ID of the genesis transactions
 */
export const GENESIS_TX = [
  '00029b7f8051f6ebdc0338d02d4a8cfbd662500ee03224bbee75a6f2da0350b0',
  '0001e887c7b5ec3b4e57033d849a80d8bccbe3a749abfa87cc31c663530f3f4e'
]

/**
 * How many addresses we can have without being used
 */
export const GAP_LIMIT = 20;

/**
 * Minimum expected API version
 */
export const MIN_API_VERSION = '0.24.0-beta';

/**
 * If we should forbid to generate a quantity of unused addresses more than the GAP_LIMIT
 */
export const LIMIT_ADDRESS_GENERATION = true;

/**
 * Hathor address BIP44 code  
 * (listed here: https://github.com/satoshilabs/slips/blob/master/slip-0044.md)
 */
export const HATHOR_BIP44_CODE = 280;

/**
 * Server options for the user to choose which one to connect
 */
export const DEFAULT_SERVERS = [
  'https://node1.alpha.testnet.hathor.network/v1a/',
  'https://node2.alpha.testnet.hathor.network/v1a/',
  'https://node3.alpha.testnet.hathor.network/v1a/',
  'https://node4.alpha.testnet.hathor.network/v1a/',
];

/**
 * Default server user will connect when none have been chosen
 */
export const DEFAULT_SERVER = DEFAULT_SERVERS[0];

/**
 * Transaction version field
 */
export const DEFAULT_TX_VERSION = 1;

/**
 * Create token transaction version field
 */
export const CREATE_TOKEN_TX_VERSION = 2;

/**
 * Create token information version
 * so far we expect name and symbol
 */
export const TOKEN_INFO_VERSION = 1;

/**
 * Max value (inclusive) before having to use 8 bytes: 2147483648 ~= 2.14748e+09
 */
export const MAX_OUTPUT_VALUE_32 = 2 ** 31 - 1;

/**
 * Max accepted value for an output
 * Because of a precision problem in javascript we don't handle all 8 bytes of value
 */
export const MAX_OUTPUT_VALUE = 2 ** 43;

/**
 * Entropy for the new HD wallet words
 */
export const HD_WALLET_ENTROPY = 256

/**
 * Mask to get token index from token data
 */
export const TOKEN_INDEX_MASK = 0b01111111

/**
 * Mask to check if it's authority output (first bit indicates it)
 */
export const TOKEN_AUTHORITY_MASK = 0b10000000

/**
 * Mask to check if it's mint UTXO (last bit indicates it)
 */
export const TOKEN_MINT_MASK = 0b00000001

/**
 * Mask to check if it's melt UTXO (second to last bit indicates it)
 */
export const TOKEN_MELT_MASK = 0b00000010

/**
 * Token data for an authority output of the first token in a transaction.
 * As most transactions with authority outputs have only one token, it may be directly used, as a shortcut.
 */
export const AUTHORITY_TOKEN_DATA = TOKEN_AUTHORITY_MASK | 1

/**
 * Hathor token config
 */
export const HATHOR_TOKEN_CONFIG = {'name': 'Hathor', 'symbol': 'HTR', 'uid': '00'};

/**
 * Hathor token default index
 */
export const HATHOR_TOKEN_INDEX = 0;

// Version bytes for address generation
// Mainnet: P2PKH will start with H and P2SH will start with h
// Testnet: P2PKH will start with W and P2SH will start with w
const versionBytes = {
  'mainnet': {
    'p2pkh': 0x28,
    'p2sh': 0x64,
  },
  'testnet': {
    'p2pkh': 0x49,
    'p2sh': 0x87,
  },
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

const mainnet = Networks.add({
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

const testnet = Networks.add({
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

const networks = {
  testnet,
  mainnet
}

const currentNetwork = process.env.HATHOR_WALLET_NETWORK || 'testnet';

/**
 * Version byte for the P2PKH address
 */
export const P2PKH_BYTE = versionBytes[currentNetwork].p2pkh;

/**
 * Version byte for the P2SH address
 */
export const P2SH_BYTE = versionBytes[currentNetwork].p2sh;

/**
 * Selected address ('mainnet' or 'testnet')  
 * Selected using HATHOR_WALLET_NETWORK environment variable
 */
export const NETWORK = networks[currentNetwork];

/**
 * Default timeout for each request in milliseconds
 */
export const TIMEOUT = 10000;

/**
 * Default timeout for send tokens request in milliseconds
 */
export const SEND_TOKENS_TIMEOUT = 300000;

/**
 * Number of iterations to execute when hashing the password
 *
 * Even though NIST recommeds at least 10,000 iterations (https://pages.nist.gov/800-63-3/sp800-63b.html#sec5),
 * some tests show that it takes ~3s in iPhone 7 and ~1,5s in Galaxy S8.
 * That's why we have decided to keep the default as 1,000 for now.
 */
export const HASH_ITERATIONS = 1000;

/**
 * Size of the key to hash the password
 */
export const HASH_KEY_SIZE = 256;

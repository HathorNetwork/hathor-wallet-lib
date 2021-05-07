const constants = require('./lib/constants');
const helpers = require('./lib/helpers');
const dateFormatter = require('./lib/date');
const tokens = require('./lib/tokens');
const transaction = require('./lib/transaction');
const version = require('./lib/version');
const wallet = require('./lib/wallet');
const WebSocketHandler = require('./lib/WebSocketHandler');
const errors = require('./lib/errors');
const walletApi = require('./lib/api/wallet');
const txApi = require('./lib/api/txApi');
const txMiningApi = require('./lib/api/txMining');
const versionApi = require('./lib/api/version');
const axios = require('./lib/api/axiosInstance');
const storage = require('./lib/storage');
const network = require('./lib/network');
const MemoryStore = require('./lib/memory_store');
const HathorWallet = require('./lib/new/wallet');
const Connection = require('./lib/new/connection');
const SendTransaction = require('./lib/new/sendTransaction');
const Address = require('./lib/models/address');
const Output = require('./lib/models/output');
const Input = require('./lib/models/input');
const Transaction = require('./lib/models/transaction');
const Network = require('./lib/models/network');
const dateUtils = require('./lib/utils/date');
const tokensUtils = require('./lib/utils/tokens');
const walletUtils = require('./lib/utils/wallet');
const helpersUtils = require('./lib/utils/helpers');
const HathorWalletServiceWallet = require('./lib/wallet/wallet');

module.exports = {
  helpers: helpers.default,
  dateFormatter: dateFormatter.default,
  tokens: tokens.default,
  transaction: transaction.default,
  version: version.default,
  wallet: wallet.default,
  WebSocketHandler: WebSocketHandler.default,
  walletApi: walletApi.default,
  txApi: txApi.default,
  txMiningApi: txMiningApi.default,
  versionApi: versionApi.default,
  errors: errors,
  constants: constants,
  axios: axios,
  storage: storage.default,
  MemoryStore: MemoryStore.default,
  network: network.default,
  HathorWallet: HathorWallet.default,
  Connection: Connection.default,
  SendTransaction: SendTransaction.default,
  Address: Address.default,
  Output: Output.default,
  Input: Input.default,
  Transaction: Transaction.default,
  Network: Network.default,
  dateUtils: dateUtils.default,
  tokensUtils: tokensUtils.default,
  walletUtils: walletUtils.default,
  helpersUtils: helpersUtils.default,
  HathorWalletServiceWallet: HathorWalletServiceWallet.default,
}

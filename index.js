const constants = require('./lib/constants');
const helpers = require('./lib/helpers');
const dateFormatter = require('./lib/date');
const tokens = require('./lib/tokens');
const transaction = require('./lib/transaction');
const version = require('./lib/version');
const wallet = require('./lib/wallet');
const WebSocketHandler = require('./lib/WebSocketHandler');
const websocket = require('./lib/websocket');
const errors = require('./lib/errors');
const ErrorMessages = require('./lib/errorMessages');
const walletApi = require('./lib/api/wallet');
const txApi = require('./lib/api/txApi');
const txMiningApi = require('./lib/api/txMining');
const versionApi = require('./lib/api/version');
const axios = require('./lib/api/axiosInstance');
const metadataApi = require('./lib/api/metadataApi');
const storage = require('./lib/storage');
const network = require('./lib/network');
const MemoryStore = require('./lib/memory_store');
const HathorWallet = require('./lib/new/wallet');
const Connection = require('./lib/new/connection');
const WalletServiceConnection = require('./lib/wallet/connection');
const SendTransaction = require('./lib/new/sendTransaction');
const Address = require('./lib/models/address');
const Output = require('./lib/models/output');
const P2PKH = require('./lib/models/p2pkh');
const Input = require('./lib/models/input');
const Transaction = require('./lib/models/transaction');
const CreateTokenTransaction = require('./lib/models/create_token_transaction');
const Network = require('./lib/models/network');
const dateUtils = require('./lib/utils/date');
const tokensUtils = require('./lib/utils/tokens');
const walletUtils = require('./lib/utils/wallet');
const helpersUtils = require('./lib/utils/helpers');
const scriptsUtils = require('./lib/utils/scripts');
const HathorWalletServiceWallet = require('./lib/wallet/wallet');
const SendTransactionWalletService = require('./lib/wallet/sendTransactionWalletService');
const config = require('./lib/config');

module.exports = {
  helpers: helpers.default,
  dateFormatter: dateFormatter.default,
  tokens: tokens.default,
  transaction: transaction.default,
  version: version.default,
  wallet: wallet.default,
  WebSocketHandler: WebSocketHandler.default,
  websocket: websocket.default,
  walletApi: walletApi.default,
  txApi: txApi.default,
  txMiningApi: txMiningApi.default,
  versionApi: versionApi.default,
  metadataApi: metadataApi.default,
  errors: errors,
  ErrorMessages: ErrorMessages,
  constants: constants,
  axios: axios,
  storage: storage.default,
  MemoryStore: MemoryStore.default,
  network: network.default,
  HathorWallet: HathorWallet.default,
  Connection: Connection.default,
  WalletServiceConnection: WalletServiceConnection.default,
  SendTransaction: SendTransaction.default,
  Address: Address.default,
  Output: Output.default,
  P2PKH: P2PKH.default,
  Input: Input.default,
  Transaction: Transaction.default,
  CreateTokenTransaction: CreateTokenTransaction.default,
  Network: Network.default,
  dateUtils: dateUtils.default,
  tokensUtils: tokensUtils.default,
  walletUtils: walletUtils.default,
  helpersUtils: helpersUtils.default,
  scriptsUtils: scriptsUtils,
  HathorWalletServiceWallet: HathorWalletServiceWallet.default,
  SendTransactionWalletService: SendTransactionWalletService.default,
  config: config.default,
}

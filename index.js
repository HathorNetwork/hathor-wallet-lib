const constants = require('./lib/constants');
const dateFormatter = require('./lib/utils/date');
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
const HathorWallet = require('./lib/new/wallet');
const Connection = require('./lib/new/connection');
const WalletServiceConnection = require('./lib/wallet/connection');
const SendTransaction = require('./lib/new/sendTransaction');
const Address = require('./lib/models/address');
const Output = require('./lib/models/output');
const P2PKH = require('./lib/models/p2pkh');
const P2SH = require('./lib/models/p2sh');
const P2SHSignature = require('./lib/models/p2sh_signature');
const ScriptData = require('./lib/models/script_data');
const Input = require('./lib/models/input');
const Transaction = require('./lib/models/transaction');
const CreateTokenTransaction = require('./lib/models/create_token_transaction');
const Network = require('./lib/models/network');
const cryptoUtils = require('./lib/utils/crypto');
const dateUtils = require('./lib/utils/date');
const tokensUtils = require('./lib/utils/tokens');
const walletUtils = require('./lib/utils/wallet');
const helpersUtils = require('./lib/utils/helpers');
const scriptsUtils = require('./lib/utils/scripts');
const transactionUtils = require('./lib/utils/transaction');
const bufferUtils = require('./lib/utils/buffer');
const HathorWalletServiceWallet = require('./lib/wallet/wallet');
const SendTransactionWalletService = require('./lib/wallet/sendTransactionWalletService');
const config = require('./lib/config');
const PushNotification = require('./lib/pushNotification');

const {PartialTx, PartialTxInputData} = require('./lib/models/partial_tx');
const PartialTxProposal = require('./lib/wallet/partialTxProposal');
const swapService = require('./lib/wallet/api/swapService');

module.exports = {
  PartialTx,
  PartialTxInputData,
  PartialTxProposal: PartialTxProposal.default,
  dateFormatter: dateFormatter.default,
  websocket: websocket.default,
  walletApi: walletApi.default,
  txApi: txApi.default,
  txMiningApi: txMiningApi.default,
  versionApi: versionApi.default,
  metadataApi: metadataApi.default,
  errors: errors,
  ErrorMessages: ErrorMessages,
  constants,
  axios,
  storage: storage.default,
  network: network.default,
  HathorWallet: HathorWallet.default,
  Connection: Connection.default,
  WalletServiceConnection: WalletServiceConnection.default,
  SendTransaction: SendTransaction.default,
  Address: Address.default,
  Output: Output.default,
  P2PKH: P2PKH.default,
  P2SH: P2SH.default,
  P2SHSignature: P2SHSignature.default,
  ScriptData: ScriptData.default,
  Input: Input.default,
  Transaction: Transaction.default,
  CreateTokenTransaction: CreateTokenTransaction.default,
  Network: Network.default,
  cryptoUtils: cryptoUtils,
  dateUtils: dateUtils.default,
  tokensUtils: tokensUtils.default,
  walletUtils: walletUtils.default,
  helpersUtils: helpersUtils.default,
  scriptsUtils: scriptsUtils,
  bufferUtils: bufferUtils,
  transactionUtils: transactionUtils.default,
  HathorWalletServiceWallet: HathorWalletServiceWallet.default,
  SendTransactionWalletService: SendTransactionWalletService.default,
  config: config.default,
  PushNotification,
  swapService: swapService,
}

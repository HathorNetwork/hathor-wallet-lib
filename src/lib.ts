import * as constants from './constants';
import dateFormatter from './utils/date';
import websocket from './websocket';
import * as errors from './errors';
import * as ErrorMessages from './errorMessages';
import walletApi from './api/wallet';
import txApi from './api/txApi';
import txMiningApi from './api/txMining';
import healthApi from './api/health';
import versionApi from './api/version';
import * as axios from './api/axiosInstance';
import metadataApi from './api/metadataApi';
import featuresApi from './api/featuresApi';
import { Storage } from './storage/storage';
import { MemoryStore } from './storage/memory_store';
import network from './network';
import HathorWallet from './new/wallet';
import Connection from './new/connection';
import WalletServiceConnection from './wallet/connection';
import SendTransaction from './new/sendTransaction';
import Address from './models/address';
import Output from './models/output';
import P2PKH from './models/p2pkh';
import P2SH from './models/p2sh';
import P2SHSignature from './models/p2sh_signature';
import ScriptData from './models/script_data';
import Input from './models/input';
import Transaction from './models/transaction';
import CreateTokenTransaction from './models/create_token_transaction';
import Network from './models/network';
import FeeHeader from './headers/fee';
import * as addressUtils from './utils/address';
import * as cryptoUtils from './utils/crypto';
import tokensUtils from './utils/tokens';
import walletUtils from './utils/wallet';
import helpersUtils from './utils/helpers';
import * as numberUtils from './utils/numbers';
import * as scriptsUtils from './utils/scripts';
import transactionUtils from './utils/transaction';
import * as bufferUtils from './utils/buffer';
import HathorWalletServiceWallet from './wallet/wallet';
import walletServiceApi from './wallet/api/walletApi';
import SendTransactionWalletService from './wallet/sendTransactionWalletService';
import { WalletServiceStorageProxy } from './wallet/walletServiceStorageProxy';
import config from './config';
import * as PushNotification from './pushNotification';
import { PartialTx, PartialTxInputData } from './models/partial_tx';
import PartialTxProposal from './wallet/partialTxProposal';
import * as swapService from './wallet/api/swapService';
import { AtomicSwapServiceConnection } from './swapService/swapConnection';
import ncApi from './api/nano';
import * as nanoUtils from './nano_contracts/utils';
import NanoContractTransactionParser from './nano_contracts/parser';
import * as bigIntUtils from './utils/bigint';
import {
  TransactionTemplate,
  TransactionTemplateBuilder,
  WalletTxTemplateInterpreter,
} from './template/transaction';
import { stopGLLBackgroundTask } from './sync/gll';
import * as enums from './models/enum';
import { Fee } from './utils/fee';

export {
  PartialTx,
  PartialTxInputData,
  PartialTxProposal,
  dateFormatter,
  websocket,
  walletApi,
  txApi,
  txMiningApi,
  healthApi,
  versionApi,
  metadataApi,
  featuresApi,
  errors,
  ErrorMessages,
  constants,
  axios,
  Storage,
  MemoryStore,
  network,
  HathorWallet,
  Connection,
  AtomicSwapServiceConnection,
  WalletServiceConnection,
  SendTransaction,
  Address,
  Output,
  P2PKH,
  P2SH,
  P2SHSignature,
  ScriptData,
  Input,
  Transaction,
  CreateTokenTransaction,
  Network,
  FeeHeader,
  Fee,
  addressUtils,
  cryptoUtils,
  dateFormatter as dateUtils,
  tokensUtils,
  walletUtils,
  numberUtils,
  helpersUtils,
  scriptsUtils,
  bufferUtils,
  transactionUtils,
  HathorWalletServiceWallet,
  walletServiceApi,
  SendTransactionWalletService,
  WalletServiceStorageProxy,
  config,
  PushNotification,
  swapService,
  ncApi,
  nanoUtils,
  NanoContractTransactionParser,
  bigIntUtils,
  TransactionTemplate,
  TransactionTemplateBuilder,
  WalletTxTemplateInterpreter,
  stopGLLBackgroundTask,
  enums,
};

// Re-export all types from modules without naming conflicts.
export * from './types';
export * from './nano_contracts/types';
export * from './models/types';
export * from './template/transaction/types';
export * from './headers/types';
export * from './models/enum';

// Re-export wallet/types.ts explicitly because it has naming conflicts:
//   - Balance / Authority clash with models/types.ts
//   - DelegateAuthorityOptions / DestroyAuthorityOptions clash with new/types.ts
// Conflicting names are re-exported with descriptive aliases.
export type { Balance as WalletBalance, Authority as WalletAuthority } from './wallet/types';
export {
  ConnectionState,
  OutputType,
  type CreateTokenOptionsInput,
  type GetAddressesObject,
  type GetBalanceObject,
  type TokenInfo,
  type AuthoritiesBalance,
  type GetHistoryObject,
  type AddressInfoObject,
  type GetAddressDetailsObject,
  type WalletStatusResponseData,
  type WalletStatus,
  type AddressesResponseData,
  type AddressDetailsResponseData,
  type CheckAddressesMineResponseData,
  type NewAddressesResponseData,
  type BalanceResponseData,
  type TokenDetailsResponseData,
  type TokenDetailsAuthoritiesObject,
  type TokenDetailsObject,
  type HistoryResponseData,
  type TxProposalCreateResponseData,
  type TxProposalInputs,
  type TxProposalOutputs,
  type TxProposalUpdateResponseData,
  type TxProposalDeleteResponseData,
  type RequestError,
  type InputRequestObject,
  type SendManyTxOptionsParam,
  type SendTxOptionsParam,
  type GetTxOutputsOptions,
  type TxOutputResponseData,
  type Utxo,
  type AuthorityTxOutput,
  type AuthTokenResponseData,
  type OutputRequestObj,
  type DataScriptOutputRequestObj,
  type OutputSendTransaction,
  type InputRequestObj,
  type TokensResponseData,
  type SendTransactionEvents,
  type SendTransactionResponse,
  type WalletAddressMap,
  type TokenMap,
  type TransactionFullObject,
  type IStopWalletParams,
  type DelegateAuthorityOptions,
  type DestroyAuthorityOptions,
  type IHathorWallet,
  type ISendTransaction,
  type MineTxSuccessData,
  type DecodedOutput,
  type TxOutput,
  type TxInput,
  type WsBufferScript,
  type WsTxInputDecoded,
  type WsTxInput,
  type WsTxOutputDecoded,
  type WsTxOutput,
  type WsTransaction,
  type CreateWalletAuthData,
  type FullNodeVersionData,
  type TxByIdTokenData,
  type TxByIdTokensResponseData,
  type WalletServiceServerUrls,
  type FullNodeToken,
  type FullNodeDecodedInput,
  type FullNodeDecodedOutput,
  type FullNodeInput,
  type FullNodeOutput,
  type FullNodeTx,
  type FullNodeMeta,
  type FullNodeTxResponse,
  type FullNodeTxConfirmationDataResponse,
  type HasTxOutsideFirstAddressResponseData,
} from './wallet/types';

// Re-export new/types.ts explicitly because it has naming conflicts:
//   - DelegateAuthorityOptions / DestroyAuthorityOptions clash with wallet/types.ts
//   - CreateNanoTxData clashes with nano_contracts/types.ts
// Conflicting names are re-exported with descriptive aliases.
export type {
  DelegateAuthorityOptions as FullnodeDelegateAuthorityOptions,
  DestroyAuthorityOptions as FullnodeDestroyAuthorityOptions,
  CreateNanoTxData as FullnodeCreateNanoTxData,
} from './new/types';
export {
  type HathorWalletConstructorParams,
  type UtxoOptions,
  type GetAvailableUtxosOptions,
  type GetUtxosForAmountOptions,
  type GetAuthorityOptions,
  type MintTokensOptions,
  type MeltTokensOptions,
  type WalletStartOptions,
  type WalletStopOptions,
  type WalletWebSocketData,
  type CreateNanoTokenTxOptions,
  type CreateOnChainBlueprintTxOptions,
  type BuildTxTemplateOptions,
  type StartReadOnlyOptions,
  type UtxoDetails,
  type ProposedOutput,
  type ProposedInput,
  type SendTransactionFullnodeOptions,
  type SendManyOutputsOptions,
  type CreateTokenOptions,
  type CreateNFTOptions,
  type GetBalanceFullnodeFacadeReturnType,
  type GetTxHistoryFullnodeFacadeReturnType,
  type GetTokenDetailsFullnodeFacadeReturnType,
  type GetTxByIdTokenDetails,
  type GetTxByIdFullnodeFacadeReturnType,
  type IWalletInputInfo,
  type ISignature,
} from './new/types';

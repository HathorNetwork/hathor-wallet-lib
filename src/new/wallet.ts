/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * TypeScript Migration In Progress
 *
 * Status: Constructor and key public methods have been typed with 'any'
 *
 * Next Steps:
 * - Replace 'any' with proper interfaces and types
 * - Enable strict type checking incrementally
 * - Integrate with external definitions in other files
 *
 * Note: @ts-nocheck is enabled to allow gradual migration without breaking the build
 *
 */

/* eslint @typescript-eslint/explicit-function-return-type: "error" */

import { cloneDeep, get } from 'lodash';
import bitcore, { HDPrivateKey } from 'bitcore-lib';
import EventEmitter from 'events';
import { z } from 'zod';
import {
  NATIVE_TOKEN_UID,
  ON_CHAIN_BLUEPRINTS_VERSION,
  P2PKH_ACCT_PATH,
  P2SH_ACCT_PATH,
  SHIELDED_SPEND_ACCT_PATH,
  GAP_LIMIT,
} from '../constants';
import tokenUtils from '../utils/tokens';
import walletApi from '../api/wallet';
import versionApi from '../api/version';
import { hexToBuffer } from '../utils/buffer';
import { signMessage } from '../utils/crypto';
import helpers from '../utils/helpers';
import { createP2SHRedeemScript } from '../utils/scripts';
import walletUtils from '../utils/wallet';
import SendTransaction from './sendTransaction';
import Network from '../models/network';
import {
  AddressError,
  HasTxOutsideFirstAddressError,
  NanoContractTransactionError,
  PinRequiredError,
  TxNotFoundError,
  WalletError,
  WalletFromXPubGuard,
} from '../errors';
import { ErrorMessages } from '../errorMessages';
import P2SHSignature from '../models/p2sh_signature';
import {
  ApiVersion,
  AddressScanPolicyData,
  AuthorityType,
  EcdsaTxSign,
  getDefaultLogger,
  HistorySyncMode,
  IHistoryTx,
  IIndexLimitAddressScanPolicy,
  ILogger,
  IMultisigData,
  IPrecalculatedShieldedAddress,
  IStorage,
  ITokenData,
  IUtxo,
  IWalletAccessData,
  OutputValueType,
  SCANNING_POLICY,
  TokenVersion,
  TxHistoryProcessingStatus,
  WalletState,
  WalletType,
  WalletAddressMode,
  IAddressChainOptions,
} from '../types';
import transactionUtils from '../utils/transaction';
import Queue from '../models/queue';
import {
  checkScanningPolicy,
  getHistorySyncMethod,
  getSupportedSyncMode,
  loadAddressHistory,
  processMetadataChanged,
  savePrecalculatedShieldedAddresses,
  scanPolicyStartAddresses,
} from '../utils/storage';
import txApi from '../api/txApi';
import { MemoryStore, Storage } from '../storage';
import {
  deriveAddressP2PKH,
  deriveAddressP2SH,
  deriveShieldedAddressFromStorage,
  getAddressFromPubkey,
} from '../utils/address';
import NanoContractTransactionBuilder from '../nano_contracts/builder';
import { prepareNanoSendTransaction, setNanoHeaderCallerFromWallet } from '../nano_contracts/utils';
import OnChainBlueprint, { Code, CodeKind } from '../nano_contracts/on_chain_blueprint';
import {
  CreateNanoTxOptions,
  NanoContractBuilderCreateTokenOptions,
  NanoContractVertexType,
} from '../nano_contracts/types';
import { IHistoryTxSchema } from '../schemas';
import GLL from '../sync/gll';
import { TransactionTemplate, WalletTxTemplateInterpreter } from '../template/transaction';
import Address from '../models/address';
import type { HistoryTransactionOutput } from '../models/types';
import type { IShieldedCryptoProvider } from '../shielded/types';
import {
  ConnectionState,
  FullNodeVersionData,
  IHathorWallet,
  OutputType,
  Utxo,
} from '../wallet/types';
import Transaction from '../models/transaction';
import {
  CreateNFTOptions,
  CreateTokenOptions,
  FullnodeCreateNanoTxData,
  CreateNanoTokenTxOptions,
  CreateOnChainBlueprintTxOptions,
  DelegateAuthorityOptions,
  DestroyAuthorityOptions,
  GetAuthorityOptions,
  GetAvailableUtxosOptions,
  GetBalanceFullnodeFacadeReturnType,
  GetTokenDetailsFullnodeFacadeReturnType,
  GetTxByIdFullnodeFacadeReturnType,
  GetTxHistoryFullnodeFacadeReturnType,
  GetUtxosForAmountOptions,
  MintTokensOptions,
  MeltTokensOptions,
  HathorWalletConstructorParams,
  ISignature,
  IWalletInputInfo,
  ProposedOutput,
  ShieldedOpening,
  ShieldedOpeningEntry,
  SendManyOutputsOptions,
  UtxoDetails,
  UtxoOptions,
  SendTransactionFullnodeOptions,
  WalletWebSocketData,
  WalletStartOptions,
  WalletStopOptions,
  BuildTxTemplateOptions,
  StartReadOnlyOptions,
} from './types';
import {
  FullNodeTxApiResponse,
  GraphvizNeighboursDotResponse,
  GraphvizNeighboursErrorResponse,
  GraphvizNeighboursResponse,
  TransactionAccWeightResponse,
} from '../api/schemas/txApi';
import { GeneralTokenInfoSchema } from '../api/schemas/wallet';
import WalletConnection from './connection';
import NanoContractHeader from '../nano_contracts/header';

const ERROR_MESSAGE_PIN_REQUIRED = 'Pin is required.';

const ERROR_MESSAGE_PASSWORD_REQUIRED = 'Password is required.';

/**
 * This is a Wallet that is supposed to be simple to be used by a third-party app.
 *
 * This class handles all the details of syncing, including receiving the same transaction
 * multiple times from the server. It also keeps the balance of the tokens updated.
 *
 * It has the following states:
 * - CLOSED: When it is disconnected from the server.
 * - CONNECTING: When it is connecting to the server.
 * - SYNCING: When it has connected and is syncing the transaction history.
 * - READY: When it is ready to be used.
 *
 * You can subscribe for the following events:
 * - state: Fired when the state of the Wallet changes.
 * - new-tx: Fired when a new tx arrives.
 * - update-tx: Fired when a known tx is updated. Usually, it happens when one of its outputs is spent.
 * - more-addresses-loaded: Fired when loading the history of transactions. It is fired multiple times,
 *                          one for each request sent to the server.
 */
class HathorWallet extends EventEmitter {
  // Core dependencies
  storage: IStorage;

  logger: ILogger;

  conn: WalletConnection;

  // Wallet state
  state: WalletState;

  // Wallet keys (may be undefined after cleared for security)
  xpriv?: string;

  seed?: string;

  xpub?: string;

  // Token configuration
  token: ITokenData | null;

  tokenUid: string;

  // Security
  passphrase: string;

  pinCode: string | null;

  password: string | null;

  // Address management
  preCalculatedAddresses: string[] | null;

  preCalculatedShieldedAddresses: IPrecalculatedShieldedAddress[] | null;

  // Connection state
  firstConnection: boolean;

  walletStopped: boolean;

  // Configuration
  debug: boolean;

  beforeReloadCallback: (() => void) | null;

  multisig?: { pubkeys: string[]; numSignatures: number };

  // Transaction queue
  wsTxQueue: Queue<WalletWebSocketData>;

  newTxPromise: Promise<void>;

  // Scanning & sync configuration
  scanPolicy: AddressScanPolicyData | null;

  isSignedExternally: boolean;

  historySyncMode: HistorySyncMode;

  // Template interpreter
  txTemplateInterpreter: WalletTxTemplateInterpreter;

  /**
   * Wallet state: CLOSED — disconnected from the server.
   * @deprecated Use WalletState.CLOSED instead
   */
  static CLOSED: WalletState = WalletState.CLOSED;

  /**
   * Wallet state: CONNECTING — currently establishing a connection.
   * @deprecated Use WalletState.CONNECTING instead
   */
  static CONNECTING: WalletState = WalletState.CONNECTING;

  /**
   * Wallet state: SYNCING — connected and syncing transaction history.
   * @deprecated Use WalletState.SYNCING instead
   */
  static SYNCING: WalletState = WalletState.SYNCING;

  /**
   * Wallet state: READY — synced and ready to be used.
   * @deprecated Use WalletState.READY instead
   */
  static READY: WalletState = WalletState.READY;

  /**
   * Wallet state: ERROR — the wallet encountered an error.
   * @deprecated Use WalletState.ERROR instead
   */
  static ERROR: WalletState = WalletState.ERROR;

  /**
   * Wallet state: PROCESSING — performing an internal processing task.
   * @deprecated Use WalletState.PROCESSING instead
   */
  static PROCESSING: WalletState = WalletState.PROCESSING;

  /**
   * Creates a new HathorWallet instance.
   *
   * @remarks
   * Must provide exactly one of: seed, xpriv, or xpub for wallet initialization.
   * - Use seed + password for full wallet with encryption
   * - Use xpriv for full wallet without seed encryption
   * - Use xpub for read-only wallet (watch-only mode)
   *
   * @example
   * ```typescript
   * // Full wallet with seed
   * const wallet = new HathorWallet({
   *   connection: myConnection,
   *   seed: '24 word mnemonic phrase here...',
   *   password: 'plaintext-password',
   *   pinCode: '123456',
   * });
   *
   * // Read-only wallet
   * const readOnlyWallet = new HathorWallet({
   *   connection: myConnection,
   *   xpub: 'xpub...',
   * });
   * ```
   */
  constructor(
    {
      connection,
      storage,

      seed,
      passphrase = '',

      xpriv,

      xpub,

      tokenUid = NATIVE_TOKEN_UID,

      password = null,
      pinCode = null,

      // debug mode
      debug = false,
      // Callback to be executed before reload data
      beforeReloadCallback = null,
      multisig = null,
      preCalculatedAddresses = null,
      preCalculatedShieldedAddresses = null,
      scanPolicy = null,
      logger = null,
    }: HathorWalletConstructorParams = {} as HathorWalletConstructorParams
  ) {
    super();

    if (!connection) {
      throw Error('You must provide a connection.');
    }

    if (!seed && !xpriv && !xpub) {
      throw Error('You must explicitly provide the seed, xpriv or the xpub.');
    }

    if (seed && xpriv) {
      throw Error('You cannot provide both a seed and an xpriv.');
    }

    if (xpriv && passphrase !== '') {
      throw Error("You can't use xpriv with passphrase.");
    }

    if (connection.getState() !== ConnectionState.CLOSED) {
      throw Error("You can't share connections.");
    }

    if (multisig) {
      if (!(multisig.pubkeys && multisig.numSignatures)) {
        throw Error('Multisig configuration requires both pubkeys and numSignatures.');
      } else if (multisig.pubkeys.length < multisig.numSignatures) {
        throw Error('Multisig configuration invalid.');
      }
    }

    this.logger = logger || getDefaultLogger();
    if (storage) {
      this.storage = storage;
    } else {
      // Default to a memory store
      const store = new MemoryStore();
      this.storage = new Storage(store);
    }
    this.storage.setLogger(this.logger);
    this.conn = connection;
    this.conn.startControlHandlers(this.storage);

    this.state = HathorWallet.CLOSED;

    this.xpriv = xpriv;
    this.seed = seed;
    this.xpub = xpub;

    // tokenUid is optional so we can get the token of the wallet
    this.token = null;
    this.tokenUid = tokenUid;

    this.passphrase = passphrase;
    this.pinCode = pinCode;
    this.password = password;

    this.preCalculatedAddresses = preCalculatedAddresses;
    this.preCalculatedShieldedAddresses = preCalculatedShieldedAddresses;

    this.onConnectionChangedState = this.onConnectionChangedState.bind(this);
    this.handleWebsocketMsg = this.handleWebsocketMsg.bind(this);

    // Used to know if the wallet is loading data for the first time
    // or if it's reloading it (e.g. after a ws reconnection).
    // The reload must execute some cleanups, that's why it's important
    // to differentiate both actions
    this.firstConnection = true;

    // Debug mode. It is used to include debugging information
    // when a problem occurs.
    this.debug = debug;

    // The reload is called automatically in the lib when the ws reconnects
    // this callback gives a chance to the apps to run a method before reloading data in the lib
    this.beforeReloadCallback = beforeReloadCallback;

    // Set to true when stop() method is called
    this.walletStopped = false;

    if (multisig) {
      this.multisig = {
        pubkeys: multisig.pubkeys,
        numSignatures: multisig.numSignatures,
      };
    }

    this.wsTxQueue = new Queue<WalletWebSocketData>();
    this.newTxPromise = Promise.resolve();

    // Defaults to single address scanning policy
    if (scanPolicy == null) {
      this.scanPolicy = { policy: SCANNING_POLICY.SINGLE_ADDRESS };
    } else {
      this.scanPolicy = scanPolicy;
    }
    this.isSignedExternally = this.storage.hasTxSignatureMethod();

    this.historySyncMode = HistorySyncMode.POLLING_HTTP_API;

    this.txTemplateInterpreter = new WalletTxTemplateInterpreter(this);
  }

  /**
   * Gets the current server url from connection
   * @returns The server url. Ex.: 'http://server.com:8083'
   */
  getServerUrl(): string {
    return this.conn.getCurrentServer();
  }

  /**
   * Gets the current network from connection
   * @returns The network name. Ex.: 'mainnet', 'testnet'
   */
  getNetwork(): string {
    return this.conn.getCurrentNetwork();
  }

  /**
   * Gets the network model object
   */
  getNetworkObject(): Network {
    return new Network(this.getNetwork());
  }

  /**
   * Gets version data from the fullnode
   *
   * @returns The data information from the fullnode
   *
   * @memberof HathorWallet
   * @inner
   * */
  // eslint-disable-next-line class-methods-use-this -- The server address is fetched directly from the configs
  async getVersionData(): Promise<FullNodeVersionData> {
    const versionData: ApiVersion = await new Promise((resolve, reject) => {
      versionApi.getVersion(resolve).catch(error => reject(error));
    });

    return {
      // The new facade returns the timestamp of when this information was cached, since we don't
      // cache this information on the fullnode, it is ok to just return the current timestamp.
      // This is currently not being used on hathor official wallets
      timestamp: Date.now(),
      version: versionData.version,
      network: versionData.network,
      minWeight: versionData.min_weight,
      minTxWeight: versionData.min_tx_weight,
      minTxWeightCoefficient: versionData.min_tx_weight_coefficient,
      minTxWeightK: versionData.min_tx_weight_k,
      tokenDepositPercentage: versionData.token_deposit_percentage,
      tokenDepositPercentageNumerator: versionData.token_deposit_percentage_numerator,
      tokenDepositPercentageDenominator: versionData.token_deposit_percentage_denominator,
      rewardSpendMinBlocks: versionData.reward_spend_min_blocks,
      maxNumberInputs: versionData.max_number_inputs,
      maxNumberOutputs: versionData.max_number_outputs,
    };
  }

  /**
   * Set the server url to connect to
   *
   * @memberof HathorWallet
   * @inner
   * */
  async changeServer(newServer: string): Promise<void> {
    this.storage.config.setServerUrl(newServer);
  }

  /**
   * Set the value of the gap limit for this wallet instance.
   * @param value The new gap limit value
   */
  async setGapLimit(value: number): Promise<void> {
    return this.storage.setGapLimit(value);
  }

  /**
   * Load more addresses if configured to index-limit scanning policy.
   * @param count Number of addresses to load
   * @returns The index of the last address loaded
   */
  async indexLimitLoadMore(count: number): Promise<number> {
    const scanPolicy = await this.storage.getScanningPolicy();
    if (scanPolicy !== SCANNING_POLICY.INDEX_LIMIT) {
      throw new Error('Wallet is not configured for index-limit scanning policy');
    }

    const limits = await this.storage.getIndexLimit();
    if (!limits) {
      throw new Error('Index limit scanning policy config error');
    }
    const newEndIndex = limits.endIndex + count;
    await this.indexLimitSetEndIndex(newEndIndex);
    return newEndIndex;
  }

  /**
   * Set the value of the index limit end for this wallet instance.
   * @param endIndex The new index limit value
   */
  async indexLimitSetEndIndex(endIndex: number): Promise<void> {
    const scanPolicy = await this.storage.getScanningPolicy();
    if (scanPolicy !== SCANNING_POLICY.INDEX_LIMIT) {
      throw new Error('Wallet is not configured for index-limit scanning policy');
    }

    const limits = await this.storage.getIndexLimit();
    if (!limits) {
      throw new Error('Index limit scanning policy config error');
    }

    if (endIndex <= limits.endIndex) {
      // Cannot unload addresses from storage.
      return;
    }

    const newPolicyData: IIndexLimitAddressScanPolicy = {
      ...limits,
      endIndex,
      policy: SCANNING_POLICY.INDEX_LIMIT,
    };
    await this.storage.setScanningPolicyData(newPolicyData);
    // Force loading more addresses and process history if any tx is found
    await this.scanAddressesToLoad(true);
  }

  /**
   * Get the value of the gap limit for this wallet instance.
   */
  async getGapLimit(): Promise<number> {
    return this.storage.getGapLimit();
  }

  /**
   * Get the access data object from storage.
   */
  async getAccessData(): Promise<IWalletAccessData> {
    const accessData = await this.storage.getAccessData();
    if (!accessData) {
      throw new WalletError('Wallet was not initialized.');
    }
    return accessData;
  }

  /**
   * Get the configured wallet type.
   */
  async getWalletType(): Promise<WalletType> {
    const accessData = await this.getAccessData();
    return accessData.walletType;
  }

  /**
   * Get the multisig data object from storage.
   * Only works if the wallet is a multisig wallet.
   */
  async getMultisigData(): Promise<IMultisigData> {
    const accessData = await this.getAccessData();
    if (accessData.walletType !== WalletType.MULTISIG) {
      throw new WalletError('Wallet is not a multisig wallet.');
    }
    if (!accessData.multisigData) {
      throw new WalletError('Multisig data not found in storage');
    }

    return accessData.multisigData;
  }

  /**
   * Enable debug mode.
   * */
  enableDebugMode(): void {
    this.debug = true;
  }

  /**
   * Disable debug mode.
   */
  disableDebugMode(): void {
    this.debug = false;
  }

  /**
   * Check that this wallet is readonly.
   * This can be shortcircuted if the wallet is meant to be signed externally.
   */
  async isReadonly(): Promise<boolean> {
    if (this.isSignedExternally) {
      return false;
    }
    return this.storage.isReadonly();
  }

  /**
   * Called when the connection to the websocket changes.
   * It is also called if the network is down.
   *
   * @param newState The new connection state (0: CLOSED, 1: CONNECTING, 2: CONNECTED)
   */
  async onConnectionChangedState(newState: ConnectionState): Promise<void> {
    if (newState === ConnectionState.CONNECTED) {
      this.setState(HathorWallet.SYNCING);

      try {
        // If it's the first connection we just load the history
        // otherwise we are reloading data, so we must execute some cleans
        // before loading the full data again
        if (this.firstConnection) {
          this.firstConnection = false;
          const scanPolicy = await this.storage.getScanningPolicy();
          if (scanPolicy === SCANNING_POLICY.SINGLE_ADDRESS) {
            try {
              await this.enableSingleAddressMode();
            } catch (err) {
              if (err instanceof HasTxOutsideFirstAddressError) {
                this.scanPolicy = { policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: GAP_LIMIT };
                await this.storage.setScanningPolicyData(this.scanPolicy);
              } else {
                throw err;
              }
            }
          }
          const addressesToLoad = await scanPolicyStartAddresses(this.storage);
          await this.syncHistory(
            addressesToLoad.nextIndex,
            addressesToLoad.count,
            false,
            this.pinCode ?? undefined
          );
        } else {
          if (this.beforeReloadCallback) {
            this.beforeReloadCallback();
          }
          await this.reloadStorage();
        }
        this.setState(HathorWallet.PROCESSING);
      } catch (error) {
        this.setState(HathorWallet.ERROR);
        this.logger.error('Error loading wallet', { error });
      }
    } else if (this.walletStopped) {
      this.setState(HathorWallet.CLOSED);
    } else {
      // Otherwise we just lost websocket connection
      this.setState(HathorWallet.CONNECTING);
    }
  }

  /**
   * Sign and return all signatures of the inputs belonging to this wallet.
   *
   * @param txHex - Hex representation of the transaction
   * @param pin - PIN to decrypt the private key
   *
   * @returns Serialized P2SHSignature data
   */
  async getAllSignatures(txHex: string, pin: string): Promise<string> {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('getAllSignatures');
    }
    const tx = helpers.createTxFromHex(txHex, this.getNetworkObject());
    const accessData = await this.storage.getAccessData();
    if (accessData === null) {
      throw new Error('Wallet is not initialized');
    }

    const signatures: Record<number, string> = {};

    for (const signatureInfo of await this.getSignatures(tx, { pinCode: pin })) {
      const { inputIndex, signature } = signatureInfo;
      signatures[inputIndex] = signature;
    }

    const p2shSig = new P2SHSignature(accessData.multisigData!.pubkey!, signatures);
    return p2shSig.serialize();
  }

  /**
   * Assemble transaction from hex and collected p2sh_signatures.
   *
   * @param txHex - Hex representation of the transaction
   * @param signatures - Array of serialized p2sh_signatures (string)
   *
   * @returns Transaction with input data created from the signatures
   *
   * @throws {Error} if there are not enough signatures for an input
   */
  async assemblePartialTransaction(txHex: string, signatures: string[]): Promise<Transaction> {
    const tx = helpers.createTxFromHex(txHex, this.getNetworkObject());
    const accessData = await this.storage.getAccessData();
    if (accessData === null) {
      throw new Error('Wallet was not started');
    }
    const { multisigData } = accessData;
    if (!multisigData) {
      throw new Error('Cannot call this method from a p2pkh wallet');
    }

    // Deserialize P2SHSignature for all signatures
    // XXX: the .sort here is very important since the fullnode requires the signatures
    // in the same order as the pubkeys in the redeemScript and the order chosen for the
    // pubkeys is the order of the sorted account path pubkey (hex encoded). This sort
    // only works because the serialized signature starts with the account path pubkey.
    const p2shSignatures = signatures.sort().map(sig => P2SHSignature.deserialize(sig));

    for await (const { tx: spentTx, input, index } of this.storage.getSpentTxs(tx.inputs)) {
      // SEPARATED-model resolve so the P2SH signing path picks the correct
      // address info when the spent output lives in shielded_outputs[] (its
      // array position is not its on-chain index).
      const resolved = transactionUtils.resolveSpentOutput(spentTx, input.index);
      if (!resolved?.output.decoded?.address) {
        continue;
      }
      const storageAddress = await this.storage.getAddressInfo(resolved.output.decoded.address);
      if (storageAddress === null) {
        // The transaction is on our history but this input is not ours
        continue;
      }

      const redeemScript = createP2SHRedeemScript(
        multisigData.pubkeys,
        multisigData.numSignatures,
        storageAddress.bip32AddressIndex
      );
      const sigs: Buffer[] = [];
      for (const p2shSig of p2shSignatures) {
        try {
          sigs.push(hexToBuffer(p2shSig.signatures[index]));
        } catch (e) {
          // skip if there is no signature, or if it's not hex
          continue;
        }
      }
      const inputData = walletUtils.getP2SHInputData(sigs, redeemScript);
      tx.inputs[index].setData(inputData);
    }

    return tx;
  }

  /**
   * Return all addresses of the wallet with info of each of them
   *
   * @async
   * @generator
   * @returns Address object with the count of txs for this address
   * @memberof HathorWallet
   * */
  async *getAllAddresses(opts?: IAddressChainOptions): AsyncGenerator<{
    address: string;
    index: number;
    transactions: number;
  }> {
    // We add the count of transactions
    // in order to replicate the same return as the new
    // wallet service facade.
    //
    // `opts.legacy` defaults to `true`; pass `legacy: false` to
    // enumerate the shielded receive chain instead. The storage
    // surface filters out the internal `shielded-spend` entries on
    // either branch, so callers always get the user-facing shape.
    for await (const address of this.storage.getAllAddresses(opts)) {
      yield {
        address: address.base58,
        index: address.bip32AddressIndex,
        transactions: address.numTransactions,
      };
    }
  }

  /**
   * Check if the wallet has any transactions on addresses with index > 0.
   * This is used to determine if a wallet can use single-address mode.
   *
   * @returns true if there are transactions on addresses other than the first one
   * @memberof HathorWallet
   */
  async hasTxOutsideFirstAddress(): Promise<boolean> {
    const addresses: string[] = [];
    let foundAnyTx = false;
    // Load address from index 1 to GAP_LIMIT
    for (let i = 1; i < GAP_LIMIT; i++) {
      const address = await this.getAddressAtIndex(i);
      addresses.push(address);
    }

    for await (const gotTx of loadAddressHistory(addresses, this.storage, false)) {
      if (gotTx) {
        // This will signal we have found a transaction when syncing the history
        foundAnyTx = true;
        break;
      }
    }

    return foundAnyTx;
  }

  /**
   * Get address from specific derivation index
   *
   * @returns Address
   *
   * @memberof HathorWallet
   * @inner
   */
  async getAddressAtIndex(index: number, opts?: IAddressChainOptions): Promise<string> {
    let address = await this.storage.getAddressAtIndex(index, opts);

    if (address === null) {
      // Derivation on a storage miss is a pure PEEK: the address is returned
      // without being persisted. Persisting belongs to loadAddresses /
      // scanAddressesToLoad, which manage the loaded window, its tracking
      // cursors and the WS subscriptions coherently — saving here would leave
      // holes in the window and claim ownership of an unwatched address.
      if (opts?.legacy === false) {
        // Shielded address not yet derived at this index
        const result = await deriveShieldedAddressFromStorage(index, this.storage);
        if (!result) {
          throw new Error('Shielded keys not available');
        }
        return result.shieldedAddress.base58;
      }
      // Legacy address derivation
      if ((await this.storage.getWalletType()) === 'p2pkh') {
        address = await deriveAddressP2PKH(index, this.storage);
      } else {
        address = await deriveAddressP2SH(index, this.storage);
      }
    }
    return address.base58;
  }

  /**
   * Get address path from specific derivation index
   *
   * @param index Address path index
   * @returns Address path for the given index
   *
   * @memberof HathorWallet
   * @inner
   */
  async getAddressPathForIndex(index: number, opts?: IAddressChainOptions): Promise<string> {
    let acctPath: string;
    if (opts?.legacy === false) {
      // Shielded addresses are formed by scanPubkey (account 1') + spendPubkey (account 2').
      // We return the spend path since it's used for on-chain scripts and signing.
      acctPath = SHIELDED_SPEND_ACCT_PATH;
    } else if ((await this.storage.getWalletType()) === WalletType.MULTISIG) {
      // P2SH
      acctPath = P2SH_ACCT_PATH;
    } else {
      // P2PKH
      acctPath = P2PKH_ACCT_PATH;
    }
    return `${acctPath}/0/${index}`;
  }

  /**
   * Get address to be used in the wallet
   *
   * @param [options]
   * @param [options.markAsUsed] if true, we will locally mark this address as used and won't return it again to be used
   *
   * @memberof HathorWallet
   * @inner
   */
  async getCurrentAddress(
    // eslint-disable-next-line default-param-last
    { markAsUsed = false } = {},
    opts?: IAddressChainOptions
  ): Promise<{
    address: string;
    index: number | null;
    addressPath: string;
  }> {
    const address = await this.storage.getCurrentAddress(markAsUsed, opts);
    const index = await this.getAddressIndex(address);
    const addressPath = await this.getAddressPathForIndex(index!, opts);

    return { address, index, addressPath };
  }

  /**
   * Get the next address after the current available
   */
  async getNextAddress(
    opts?: IAddressChainOptions
  ): Promise<{ address: string; index: number | null; addressPath: string }> {
    // First we mark the current address as used, then return the next
    await this.getCurrentAddress({ markAsUsed: true }, opts);
    return this.getCurrentAddress({}, opts);
  }

  /**
   * Called when a new message arrives from websocket.
   *
   * @param wsData WebSocket message data
   */
  handleWebsocketMsg(wsData: WalletWebSocketData): void {
    if (wsData.type === 'wallet:address_history') {
      if (this.state !== HathorWallet.READY) {
        // Cannot process new transactions from ws when the wallet is not ready.
        // So we will enqueue this message to be processed later
        this.wsTxQueue.enqueue(wsData);
      } else {
        this.enqueueOnNewTx(wsData);
      }
    }
  }

  /**
   * Get balance for a token
   *
   * @param token
   *
   * @return Array of balance for each token
   *
   * @memberof HathorWallet
   * @inner
   * */
  async getBalance(token: string | null = null): Promise<GetBalanceFullnodeFacadeReturnType[]> {
    // TODO if token is null we should get the balance for each token I have
    // but we don't use it in the wallets, so I won't implement it
    if (token === null) {
      throw new WalletError('Not implemented.');
    }
    const uid = token || this.token!.uid; // FIXME: this.token may be null
    // Using clone deep so the balance returned will not be updated in case
    // we change the storage
    let tokenData = cloneDeep(await this.storage.getToken(uid));
    if (tokenData === null) {
      // We don't have the token on storage, so we need to return an empty default response
      tokenData = {
        uid,
        numTransactions: 0,
        balance: {
          tokens: { unlocked: 0n, locked: 0n },
          authorities: {
            mint: { unlocked: 0n, locked: 0n },
            melt: { unlocked: 0n, locked: 0n },
          },
        },
        name: '',
        symbol: '',
      };
    }
    return [
      {
        token: {
          id: tokenData.uid,
          name: tokenData.name,
          symbol: tokenData.symbol,
          version: tokenData.version,
        },
        balance: tokenData.balance!.tokens,
        transactions: tokenData.numTransactions,
        lockExpires: null,
        tokenAuthorities: {
          unlocked: {
            mint: tokenData.balance!.authorities.mint.unlocked,
            melt: tokenData.balance!.authorities.melt.unlocked,
          },
          locked: {
            mint: tokenData.balance!.authorities.mint.locked,
            melt: tokenData.balance!.authorities.melt.locked,
          },
        },
      },
    ];
  }

  /**
   * Get transaction history
   *
   * @param options
   *
   * @return Array of transactions
   *
   * @memberof HathorWallet
   * @inner
   */
  async getTxHistory(
    options: {
      token_id?: string;
      count?: number;
      skip?: number;
    } = {}
  ): Promise<GetTxHistoryFullnodeFacadeReturnType[]> {
    const newOptions = {
      token_id: NATIVE_TOKEN_UID,
      count: 15,
      skip: 0,
      ...options,
    };
    const { skip } = newOptions;
    let { count } = newOptions;
    const uid = newOptions.token_id || this.token!.uid; // FIXME: this.token may be null

    const txs: GetTxHistoryFullnodeFacadeReturnType[] = [];
    let it = 0;
    for await (const tx of this.storage.tokenHistory(uid)) {
      if (it < skip) {
        it++;
        continue;
      }
      if (count <= 0) {
        break;
      }
      const txbalance = await this.getTxBalance(tx);
      const txHistory: GetTxHistoryFullnodeFacadeReturnType = {
        txId: tx.tx_id,
        timestamp: tx.timestamp,
        voided: tx.is_voided,
        balance: txbalance[uid] || 0n,
        version: tx.version,
        ncId: tx.nc_id,
        ncMethod: tx.nc_method,
        ncCaller: (tx.nc_address &&
          new Address(tx.nc_address, { network: this.getNetworkObject() })) as Address,
        firstBlock: tx.first_block as string | undefined,
        // Pass-through fields needed by display layers that compute
        // fees per-tx (network fee from FeeHeader entries, privacy
        // fee from per-shielded-output mode). Cheap to copy and lets
        // the consumer skip a second round-trip via `getTx`. Both are
        // optional on `IHistoryTx`; spread-conditionally so the
        // returned shape doesn't carry explicit `undefined` keys when
        // the upstream payload didn't include them.
        ...(tx.headers ? { headers: tx.headers } : {}),
        ...(tx.shielded_outputs ? { shielded_outputs: tx.shielded_outputs } : {}),
      };
      if (tx.version === ON_CHAIN_BLUEPRINTS_VERSION) {
        txHistory.ncCaller = (tx.nc_pubkey &&
          getAddressFromPubkey(tx.nc_pubkey, this.getNetworkObject())) as Address;
      }
      txs.push(txHistory);
      count--;
    }
    return txs;
  }

  /**
   * Get tokens that this wallet has transactions
   *
   * @return Array of strings (token uid)
   *
   * @memberof HathorWallet
   * @inner
   * */
  async getTokens(): Promise<string[]> {
    const tokens: string[] = [];
    for await (const token of this.storage.getAllTokens()) {
      tokens.push(token.uid);
    }
    return tokens;
  }

  /**
   * Get a transaction data from the wallet
   *
   * @param id Hash of the transaction to get data from
   *
   * @return Data from the transaction to get. Can be null if the wallet does not contain the tx.
   */
  async getTx(id: string): Promise<IHistoryTx | null> {
    return this.storage.getTx(id);
  }

  /**
   * Get the unblinding factors for shielded outputs in a transaction.
   *
   * Returns one entry per shielded output **the wallet owns** (received +
   * change). Outputs the wallet generated for other recipients are not in
   * scope — even though the wallet knows their blinding factors at signing
   * time, disclosing them would leak the recipient's amount/token to a third
   * party. The same is true of any shielded output decoded with a different
   * wallet's scan key.
   *
   * Each entry carries the on-chain absolute output index the explorer / a
   * fullnode uses to identify the output (`len(transparent_outputs) +
   * shielded_index`). The viewer can recompute the Pedersen commitment from
   * `{value, token, vbf, abf?}` and confirm it matches the on-chain
   * commitment at that index.
   *
   * SEPARATED model: shielded outputs live in `tx.shielded_outputs[]` (the
   * full on-chain-ordered list); the wallet writes the owned-marker fields
   * (`value`/`token`/`blindingFactor`/`assetBlindingFactor`) IN PLACE on the
   * slots it decrypts. The single ownership gate is `value !== undefined`;
   * the on-chain absolute index of `shielded_outputs[s]` is
   * `tx.outputs.length + s`.
   */
  async getShieldedUnblindingForTx(
    txId: string
  ): Promise<{ outputs: ShieldedOpeningEntry[]; inputs: ShieldedOpeningEntry[] }> {
    const tx = await this.storage.getTx(txId);
    if (!tx) return { outputs: [], inputs: [] };

    const ownedOutputsOf = (target: IHistoryTx): Map<number, ShieldedOpening> => {
      // Build a lookup keyed by on-chain absolute output index for shielded
      // outputs the wallet owns (decoded). Same shape used by both the outputs
      // path (this tx's shielded_outputs) and the inputs path (each input's
      // parent tx's shielded_outputs). The single ownership gate is the
      // top-level `value !== undefined`: slots the fullnode delivered but the
      // wallet couldn't decode never get the owned-marker fields written, so
      // they are excluded here. `blindingFactor` must also be present to
      // produce a usable opening.
      const transparentCount = (target.outputs ?? []).length;
      const out = new Map<number, ShieldedOpening>();
      const shielded = target.shielded_outputs ?? [];
      for (let s = 0; s < shielded.length; s += 1) {
        const output = shielded[s];
        if (output.value === undefined) continue;
        if (!output.blindingFactor || output.token === undefined) continue;
        const absIdx = transparentCount + s;
        out.set(absIdx, {
          value: output.value,
          token: output.token,
          vbf: output.blindingFactor,
          ...(output.assetBlindingFactor ? { abf: output.assetBlindingFactor } : {}),
        });
      }
      return out;
    };

    const outputsResult: ShieldedOpeningEntry[] = [];
    for (const [absIdx, opening] of ownedOutputsOf(tx).entries()) {
      outputsResult.push({ index: absIdx, ...opening });
    }

    // Inputs: a shielded input references a previous shielded output by
    // `tx_id` + `index` (the parent's on-chain absolute index). If the wallet
    // owned that previous output (its parent tx is in history with the
    // owned-marker fields written on the slot), the same opening unblinds the
    // input. Inputs whose parent the wallet doesn't own stay opaque — the
    // wallet has no business disclosing someone else's blinding factors.
    const inputsResult: ShieldedOpeningEntry[] = [];
    const parentTxCache = new Map<string, Map<number, ShieldedOpening>>();
    for (const [inputIdx, input] of (tx.inputs ?? []).entries()) {
      // We don't gate on `input.type === 'shielded'`: the sender-local insert
      // path builds the IHistoryTx without setting `type` on inputs that spend
      // shielded parents. Instead attempt the parent-opening lookup on every
      // input — only inputs whose parent tx has a decoded shielded entry at the
      // referenced absolute index produce a hit, which is exactly the ownership
      // gate we want. Transparent inputs naturally miss (parents have no
      // shielded entry at that absolute index) and fall through.
      const { tx_id: parentTxId, index: parentOutputIndex } = input;
      if (!parentTxId || parentOutputIndex === undefined) continue;
      let parentOwned = parentTxCache.get(parentTxId);
      if (parentOwned === undefined) {
        const parent = await this.storage.getTx(parentTxId);
        parentOwned = parent ? ownedOutputsOf(parent) : new Map();
        parentTxCache.set(parentTxId, parentOwned);
      }
      const opening = parentOwned.get(parentOutputIndex);
      if (!opening) continue;
      inputsResult.push({ index: inputIdx, ...opening });
    }

    return { outputs: outputsResult, inputs: inputsResult };
  }

  /**
   * @typedef AddressInfoOptions
   * @property {string} token Optionally filter transactions by this token uid (Default: HTR)
   */

  /**
   * @typedef AddressInfo
   * @property {bigint} total_amount_received Sum of the amounts received
   * @property {bigint} total_amount_sent Sum of the amounts sent
   * @property {bigint} total_amount_available Amount available to transfer
   * @property {bigint} total_amount_locked Amount locked and thus no available to transfer
   * @property {number} token Token used to calculate the amounts received, sent, available and locked
   * @property {number} index Derivation path for the given address
   */

  /**
   * Get information of a given address
   *
   * @param address Address to get information of
   * @param options Optional parameters to filter the results
   * @returns Aggregated information about the given address
   *
   */
  async getAddressInfo(
    address: string,
    options: { token?: string } = {}
  ): Promise<{
    total_amount_received: bigint;
    total_amount_sent: bigint;
    total_amount_available: bigint;
    total_amount_locked: bigint;
    token: string;
    index: number;
  }> {
    const { token = NATIVE_TOKEN_UID } = options;

    // Throws an error if the address does not belong to this wallet
    if (!(await this.storage.isAddressMine(address))) {
      throw new AddressError('Address does not belong to this wallet.');
    }

    // Derivation path index
    const addressData = await this.storage.getAddressInfo(address);
    const index = addressData!.bip32AddressIndex;

    // A user-facing shielded address is the 71-byte 'shielded' record, but its
    // owned shielded outputs carry decoded.address = the spend-derived P2PKH
    // (ctMappingAddress). Translate so the shielded accounting below matches —
    // the same swap the store's selectUtxos filter does for getUtxos. A
    // non-shielded query keeps `address` (a legacy address owns no shielded
    // outputs anyway).
    const shieldedMatchAddress =
      addressData?.addressType === 'shielded' ? addressData.ctMappingAddress : address;

    // Address information that will be calculated below
    const addressInfo = {
      total_amount_received: 0n,
      total_amount_sent: 0n,
      total_amount_available: 0n,
      total_amount_locked: 0n,
      token,
      index,
    };

    // Height-lock inputs are constant across the whole scan; read them once
    // instead of per-output.
    const nowHeight = await this.storage.getCurrentHeight();
    const rewardLock = this.storage.version?.reward_spend_min_blocks;

    // Iterate through transactions
    for await (const tx of this.storage.txHistory()) {
      // Voided transactions should be ignored
      if (tx.is_voided) {
        continue;
      }

      // Shared per-output accounting for this address+token. hathor-core
      // stamps `spent_by` and `decoded` on BOTH transparent and
      // shielded outputs, so the two output kinds feed identical totals — only
      // the field plumbing differs at the two call sites below.
      const accrue = (
        value: bigint,
        decodedAddress: string | undefined,
        outputToken: string,
        // Absent on entries the wallet inserted locally (spent_by cannot be
        // reconstructed there); the wire always stamps it (hex or null).
        spentBy: string | null | undefined,
        // Only `decoded` is consumed (timelock check) — passing the full
        // output object at the call sites is fine.
        lockable: Pick<HistoryTransactionOutput, 'decoded'>,
        // The address decodedAddress must equal for this output to count: the
        // query `address` for transparent outputs, the spend-P2PKH
        // (ctMappingAddress) for shielded outputs.
        matchAddress: string | undefined = address
      ): void => {
        if (decodedAddress !== matchAddress || token !== outputToken) return;
        const is_spent = spentBy != null;
        const is_locked =
          transactionUtils.isOutputLocked(lockable) ||
          transactionUtils.isHeightLocked(tx.height, nowHeight, rewardLock);

        addressInfo.total_amount_received += value;
        if (is_spent) {
          addressInfo.total_amount_sent += value;
          return;
        }
        if (is_locked) {
          addressInfo.total_amount_locked += value;
        } else {
          addressInfo.total_amount_available += value;
        }
      };

      // Transparent outputs — authority outputs never count toward value totals.
      for (const output of tx.outputs) {
        if (transactionUtils.isAuthorityOutput(output)) continue;
        accrue(output.value, output.decoded?.address, output.token, output.spent_by, output);
      }

      // SEPARATED model: owned shielded outputs live in tx.shielded_outputs[]
      // (value/token written in place after decryption), with decoded.address =
      // the shielded-spend P2PKH. Only wallet-owned slots (value !== undefined)
      // carry an opening; the rest are skipped.
      for (const so of tx.shielded_outputs ?? []) {
        if (so.value === undefined) continue; // not owned / not yet decrypted
        // The `value` gate above proves the slot was decrypted, and decode
        // writes value+token together — so `token` is always present here.
        accrue(so.value, so.decoded?.address, so.token!, so.spent_by, so, shieldedMatchAddress);
      }
    }

    return addressInfo;
  }

  /**
   * Get utxos of the wallet addresses
   *
   * @param options Utxo filtering options
   *
   * @return Utxos and meta information about it
   */
  async getUtxos(options: UtxoOptions = {}): Promise<UtxoDetails> {
    const newOptions = {
      token: options.token,
      authorities: 0n,
      max_utxos: options.max_utxos,
      filter_address: options.filter_address,
      amount_smaller_than: options.amount_smaller_than,
      amount_bigger_than: options.amount_bigger_than,
      max_amount: options.max_amount,
      only_available_utxos: options.only_available_utxos,
      // Transparent-only by default: getUtxos feeds consolidateUtxos, which
      // spends its results as TRANSPARENT inputs — a shielded UTXO leaking in
      // would be mis-spent. Callers wanting shielded UTXOs opt in explicitly.
      shielded: options.shielded ?? false,
    };
    const utxoDetails: UtxoDetails = {
      total_amount_available: 0n,
      total_utxos_available: 0n,
      total_amount_locked: 0n,
      total_utxos_locked: 0n,
      utxos: [],
    };
    const nowTs = Math.floor(Date.now() / 1000);
    const isTimeLocked = (timestamp: number | null): boolean =>
      !!timestamp && !!nowTs && nowTs < timestamp;
    const nowHeight = await this.storage.getCurrentHeight();
    const rewardLock = this.storage.version?.reward_spend_min_blocks;

    for await (const utxo of this.storage.selectUtxos(newOptions)) {
      const isLocked =
        isTimeLocked(utxo.timelock) ||
        transactionUtils.isHeightLocked(utxo.height, nowHeight, rewardLock);

      const utxoInfo = {
        address: utxo.address,
        amount: utxo.value,
        tx_id: utxo.txId,
        locked: !!isLocked,
        index: utxo.index,
      };

      utxoDetails.utxos.push(utxoInfo);
      if (isLocked) {
        utxoDetails.total_amount_locked += utxo.value;
        utxoDetails.total_utxos_locked += 1n;
      } else {
        utxoDetails.total_amount_available += utxo.value;
        utxoDetails.total_utxos_available += 1n;
      }
    }
    return utxoDetails;
  }

  /**
   * Generates all available utxos
   *
   * @param options Utxo filtering options
   *
   * @async
   * @generator
   * @yields all available utxos
   */
  async *getAvailableUtxos(options: GetAvailableUtxosOptions = {}): AsyncGenerator<IUtxo> {
    // Defaults to transparent-only (shielded ?? false): the main consumer,
    // getUtxosForAmount, feeds the tx-template interpreter and nano-contract
    // deposit selection, which spend inputs as transparent and hard-fail on a
    // shielded outpoint — so shielded must not leak into an unqualified call
    // (the store returns both kinds when the flag is absent). A caller that
    // explicitly wants shielded available UTXOs passes { shielded: true };
    // shielded-aware spending uses bestUtxoSelection.
    for await (const utxo of this.storage.selectUtxos({
      ...options,
      shielded: options.shielded ?? false,
      only_available_utxos: true,
    })) {
      const addressIndex = await this.getAddressIndex(utxo.address);
      const addressPath = await this.getAddressPathForIndex(addressIndex!);
      // XXX: selectUtxos is supposed to return IUtxos, but here we re-create the entire object.
      yield {
        txId: utxo.txId,
        index: utxo.index,
        tokenId: utxo.token,
        address: utxo.address,
        value: utxo.value,
        authorities: utxo.authorities,
        timelock: utxo.timelock,
        heightlock: null,
        locked: false,
        addressPath,
        token: utxo.token,
        type: utxo.type,
        height: utxo.height,
      } as IUtxo;
    }
  }

  /**
   * Get utxos of the wallet addresses to fill the amount specified.
   *
   * @param amount The amount to fill with UTXOs
   * @param options Utxo filtering options
   *
   * @return Utxos and change information.
   */
  async getUtxosForAmount(
    amount: bigint,
    options: GetUtxosForAmountOptions = {}
  ): Promise<{ utxos: Utxo[]; changeAmount: bigint }> {
    const newOptions = {
      token: NATIVE_TOKEN_UID,
      filter_address: undefined,
      ...options,
      order_by_value: 'desc',
    };

    const utxos: IUtxo[] = [];
    for await (const utxo of this.getAvailableUtxos(newOptions)) {
      utxos.push(utxo);
    }

    return transactionUtils.selectUtxos(
      // XXX: Only the `value` property of the UTXO is used in selectUtxos, so the cast is safe
      utxos.filter(utxo => utxo.authorities === 0n) as unknown as Utxo[],
      amount
    );
  }

  /**
   * Mark UTXO selected_as_input.
   *
   * @param txId Transaction id of the UTXO
   * @param index Output index of the UTXO
   * @param value The value to set the utxos.
   * @param ttl Time to live for the selection
   */
  async markUtxoSelected(
    txId: string,
    index: number,
    value: boolean = true,
    ttl: number | undefined = undefined
  ): Promise<void> {
    await this.storage.utxoSelectAsInput({ txId, index }, value, ttl);
  }

  /**
   * Prepare all required data to consolidate utxos.
   *
   * @param destinationAddress Address of the consolidated utxos
   * @param options Utxo filtering options
   *
   * @return Required data to consolidate utxos
   *
   */
  async prepareConsolidateUtxosData(
    destinationAddress: string,
    options: UtxoOptions = {}
  ): Promise<{
    outputs: Array<{ address: string; value: bigint; token: string }>;
    inputs: Array<{ txId: string; index: number; token: string }>;
    utxos: UtxoDetails['utxos'];
    total_amount: bigint;
  }> {
    // Consolidation spends its selected UTXOs as transparent inputs, so a
    // shielded UTXO must never be selected here (a SEPARATED-model shielded
    // input index would fall past outputs.length). Force shielded:false even if
    // a caller passes shielded:true — the literal after the spread wins.
    const utxoDetails = await this.getUtxos({
      ...options,
      only_available_utxos: true,
      shielded: false,
    });
    const inputs: { txId: string; index: number; token: string }[] = [];
    const utxos: UtxoDetails['utxos'] = [];
    let total_amount = 0n;
    const tokenUid = options.token || NATIVE_TOKEN_UID;
    for (let i = 0; i < utxoDetails.utxos.length; i++) {
      if (inputs.length === this.storage.version!.max_number_inputs) {
        // Max number of inputs reached
        break;
      }
      const utxo = utxoDetails.utxos[i];
      inputs.push({
        txId: utxo.tx_id,
        index: utxo.index,
        token: tokenUid,
      });
      utxos.push(utxo);
      total_amount += utxo.amount;
    }
    const outputs = [
      {
        address: destinationAddress,
        value: total_amount,
        token: tokenUid,
      },
    ];

    return { outputs, inputs, utxos, total_amount };
  }

  /**
   * Consolidates many utxos into a single one for either HTR or exactly one custom token.
   *
   * @param destinationAddress Address of the consolidated utxos
   * @param options Utxo filtering options
   *
   * @return Consolidation result with SendTransaction instance
   *
   */
  async consolidateUtxosSendTransaction(
    destinationAddress: string,
    options: UtxoOptions = {}
  ): Promise<{
    total_utxos_consolidated: number;
    total_amount: bigint;
    utxos: UtxoDetails['utxos'];
    sendTx: SendTransaction;
  }> {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('consolidateUtxos');
    }
    const { outputs, inputs, utxos, total_amount } = await this.prepareConsolidateUtxosData(
      destinationAddress,
      options
    );

    if (!(await this.isAddressMine(destinationAddress))) {
      throw new Error("Utxo consolidation to an address not owned by this wallet isn't allowed.");
    }

    if (inputs.length === 0) {
      throw new Error('No available utxo to consolidate.');
    }

    const sendTx = await this.sendManyOutputsSendTransaction(outputs, { inputs });

    return {
      total_utxos_consolidated: utxos.length,
      total_amount,
      utxos,
      sendTx,
    };
  }

  /**
   * Consolidates many utxos into a single one for either HTR or exactly one custom token.
   *
   * @param destinationAddress Address of the consolidated utxos
   * @param options Utxo filtering options
   *
   * @return Indicates that the transaction is sent or not
   *
   */
  async consolidateUtxos(
    destinationAddress: string,
    options: UtxoOptions = {}
  ): Promise<{
    total_utxos_consolidated: number;
    total_amount: bigint;
    txId: string;
    utxos: UtxoDetails['utxos'];
  }> {
    const { total_utxos_consolidated, total_amount, sendTx, utxos } =
      await this.consolidateUtxosSendTransaction(destinationAddress, options);

    const tx = await sendTx.run();

    return {
      total_utxos_consolidated,
      total_amount,
      txId: tx!.hash!,
      utxos,
    };
  }

  /**
   * Get full wallet history (same as old method to be used for compatibility)
   *
   * @return Object with transaction data { tx_id: { full_transaction_data }}
   *
   * @memberof HathorWallet
   * @inner
   * */
  async getFullHistory(): Promise<Record<string, IHistoryTx>> {
    const history: Record<string, IHistoryTx> = {};
    for await (const tx of this.storage.txHistory()) {
      history[tx.tx_id] = tx;
    }
    return history;
  }

  /**
   * Process the transactions on the websocket transaction queue as if they just arrived.
   */
  async processTxQueue(): Promise<void> {
    let wsData = this.wsTxQueue.dequeue();

    while (wsData !== undefined) {
      // save new txdata
      await this.onNewTx(wsData);
      wsData = this.wsTxQueue.dequeue();
      // We should release the event loop for other threads
      // This effectively awaits 0 seconds
      // but it schedule the next iteration to run after other threads.
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
    }

    await this.storage.processHistory(this.pinCode ?? undefined);
  }

  /**
   * Check if we need to load more addresses and load them if needed.
   * The configured scanning policy will be used to determine the loaded addresses.
   *
   * @param processHistory If we should process the txs found on the loaded addresses
   */
  async scanAddressesToLoad(processHistory: boolean = false): Promise<void> {
    // check address scanning policy and load more addresses if needed
    const loadMoreAddresses = await checkScanningPolicy(this.storage);
    if (loadMoreAddresses !== null) {
      await this.syncHistory(
        loadMoreAddresses.nextIndex,
        loadMoreAddresses.count,
        processHistory,
        this.pinCode ?? undefined
      );
    }
  }

  /**
   * Call the method to process data and resume with the correct state after processing.
   *
   * @returns A promise that resolves when the wallet is done processing the tx queue.
   */
  async onEnterStateProcessing(): Promise<void> {
    // Started processing state now, so we prepare the local data to support using this facade interchangeable with wallet service facade in both wallets
    try {
      await this.processTxQueue();
      this.setState(HathorWallet.READY);
    } catch (e) {
      this.setState(HathorWallet.ERROR);
    }
  }

  setState(state: WalletState): void {
    if (state === HathorWallet.PROCESSING && state !== this.state) {
      // XXX: will not await this so we can process history on background.
      this.onEnterStateProcessing().catch(e => {
        this.logger.error(e);
        this.setState(HathorWallet.ERROR);
      });
    }
    this.state = state;
    this.emit('state', state);
  }

  /**
   * Enqueue the call for onNewTx with the given data.
   *
   * The `.catch` is load-bearing — without it, one rejection inside
   * onNewTx (or any of its downstream awaits: `addTx`, `processNewTx`,
   * the shielded decryption loop, `processHistory`, etc.) would leave
   * `newTxPromise` in a rejected state, and every subsequent
   * `.then(() => onNewTx(...))` would propagate the rejection without
   * invoking the handler. The wallet would silently stop processing
   * websocket events for the rest of the session. Logging the error and
   * swallowing the rejection preserves the queue contract for follow-up
   * messages while keeping the underlying failure visible.
   *
   * @param wsData WebSocket message data containing transaction history
   * @param txPin Optional PIN for THIS message's shielded decryption. The
   *   sender-local insert passes the pin it used for the send so a wallet
   *   constructed without a stored `pinCode` (per-call-pin flow) still decodes
   *   and credits its own shielded change. WebSocket-delivered messages omit it
   *   and fall back to `this.pinCode`.
   */
  enqueueOnNewTx(wsData: WalletWebSocketData, txPin?: string): void {
    this.newTxPromise = this.newTxPromise
      .then(() => this.onNewTx(wsData, txPin))
      .catch(err => {
        const txId = wsData?.history?.tx_id ?? '<unknown>';
        this.logger.error(`enqueueOnNewTx: onNewTx failed for tx ${txId}: ${err?.stack ?? err}`);
      });
  }

  /**
   * Process a new transaction received from websocket.
   *
   * @param wsData WebSocket message data containing transaction history
   * @param txPin Optional PIN for this tx's shielded decryption (see
   *   enqueueOnNewTx); falls back to the wallet's stored `pinCode`.
   */
  async onNewTx(wsData: WalletWebSocketData, txPin?: string): Promise<void> {
    const parseResult = IHistoryTxSchema.safeParse(wsData.history);
    if (!parseResult.success) {
      this.logger.error(parseResult.error);
      return;
    }
    const newTx = parseResult.data;

    // Normalize: convert the shielded outputs' base64 confidential fields to hex
    // (the fullnode delivers them already separated in shielded_outputs[]).
    transactionUtils.normalizeShieldedOutputs(newTx);

    // SECURITY: strip the decode-only shielded fields the fullnode can never
    // legitimately provide (a shielded output's value/token/blinding and a
    // shielded input's echoed value/token/decoded). Ownership is re-established
    // only from our own ECDH rewind (processNewTx) or, for a known tx, restored
    // from our own storage inside storage.addTx. Honest deliveries carry these
    // bare, so this is a no-op there. See transactionUtils for the rationale.
    transactionUtils.clearUntrustedShieldedData(newTx);

    // Bail before touching storage if the wallet was already stopped. stop()
    // sets walletStopped synchronously as its first statement (before the
    // awaited storage wipe), so this entry check wins the race — the addTx
    // below cannot resurrect a tx into a just-cleaned store.
    if (this.walletStopped) {
      return;
    }

    const storageTx = await this.storage.getTx(newTx.tx_id);
    const isNewTx = storageTx === null;

    newTx.processingStatus = TxHistoryProcessingStatus.PROCESSING;

    // storage.addTx restores the wallet's decoded shielded data (stripped above)
    // from the previously-stored copy before persisting, so a bare re-delivery
    // never clobbers the decoded balance.
    await this.storage.addTx(newTx);
    await this.scanAddressesToLoad();

    // Prefer the per-message pin (sender-local insert) so a wallet with no
    // stored pinCode still decrypts its own shielded change; fall back to the
    // stored pin for WebSocket-delivered txs.
    const pin = txPin ?? this.pinCode ?? undefined;

    // set state to processing and save current state.
    const previousState = this.state;
    this.state = HathorWallet.PROCESSING;
    try {
      if (isNewTx) {
        // Process this single transaction.
        // Handling new metadatas and deleting utxos that are not available anymore
        await this.storage.processNewTx(newTx, pin);
      } else if (storageTx.is_voided !== newTx.is_voided) {
        // Voided flag changed — a full history reprocess is required to avoid
        // double-counting from the prior processNewTx.
        await this.storage.processHistory(pin);
      } else if (!newTx.is_voided) {
        // Process other types of metadata updates.
        await processMetadataChanged(this.storage, newTx);
      }

      // If the wallet was stopped while this tx was mid-processing (a concurrent
      // stop()/logout, possibly with cleanStorage), bail before the final save
      // and emit: re-inserting the tx would resurrect it — including any decoded
      // shielded value/blinding restored above — into the storage the user just
      // wiped, and 'update-tx'/'new-tx' would fire on a closed wallet.
      if (this.walletStopped) {
        return;
      }

      // restore previous state before the final save/emit
      this.state = previousState;

      // Flip PROCESSING -> FINISHED. The tx was deliberately saved as PROCESSING
      // before the branches above so a crash mid-processing is detectable; this
      // final save publishes the flag. It re-reads the PERSISTED tx (not the
      // in-scope `newTx`) because storage holds the authoritative
      // post-processing state — decode markers written in place, enriched
      // inputs — and after a processHistory branch the local object is stale.
      // The addTx round-trip also pushes the in-place decode mutations through
      // an explicit store.saveTx instead of relying on object aliasing.
      const persisted = await this.storage.getTx(newTx.tx_id);
      // If the tx vanished under us — a concurrent stop({cleanStorage}) wiped
      // the store between the walletStopped guard above and this read — do NOT
      // resurrect it. Re-saving the in-scope `newTx` would re-insert a
      // value-less (undecoded, wire-form) tx into the cleaned store; a restart
      // re-adds it correctly from the fullnode.
      if (!persisted) {
        return;
      }
      persisted.processingStatus = TxHistoryProcessingStatus.FINISHED;
      await this.storage.addTx(persisted);

      if (isNewTx) {
        this.emit('new-tx', persisted);
      } else {
        this.emit('update-tx', persisted);
      }
    } finally {
      // Safety net: if the block above threw before restoring the state (the
      // enqueueOnNewTx .catch then logs+swallows it), un-stick it here.
      // Otherwise the wallet stays at PROCESSING forever and handleWebsocketMsg
      // parks every later WS tx in wsTxQueue with nothing to drain it. A
      // deliberate CLOSED from a concurrent stop() is left untouched.
      if (this.state === HathorWallet.PROCESSING && !this.walletStopped) {
        this.state = previousState;
      }
    }
  }

  /**
   * Send a transaction with a single output
   *
   * @param address - Output address
   * @param value - Output value
   * @param options - Options parameters
   * @param options.changeAddress - Address of the change output
   * @param options.token - Token uid
   * @param options.pinCode - PIN to decrypt the private key
   *
   * @returns Promise that resolves when transaction is sent
   */
  async sendTransactionInstance(
    address: string,
    value: OutputValueType,
    options: SendTransactionFullnodeOptions = {}
  ): Promise<SendTransaction> {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('sendTransaction');
    }
    const newOptions = {
      token: '00',
      changeAddress: null,
      ...options,
    };
    const { token, changeAddress, pinCode } = newOptions;
    const outputs = [{ address, value, token }];
    return this.sendManyOutputsSendTransaction(outputs, { inputs: [], changeAddress, pinCode });
  }

  /**
   * Send a transaction with a single output
   *
   * @param address - Output address
   * @param value - Output value
   * @param options - Options parameters
   * @param options.changeAddress - Address of the change output
   * @param options.token - Token uid
   * @param options.pinCode - PIN to decrypt the private key
   *
   * @returns Promise that resolves when transaction is sent
   */
  async sendTransaction(
    address: string,
    value: OutputValueType,
    options: SendTransactionFullnodeOptions = {}
  ): Promise<Transaction | null> {
    const sendTx = await this.sendTransactionInstance(address, value, options);
    return sendTx.run();
  }

  /**
   * Create a SendTransaction instance to send a transaction with possibly multiple outputs.
   *
   * @param outputs - Array of proposed outputs
   * @param options - Options parameters
   *
   * @returns Promise that resolves with SendTransaction instance
   */
  async sendManyOutputsSendTransaction(
    outputs: ProposedOutput[],
    options: SendManyOutputsOptions = {}
  ): Promise<SendTransaction> {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('sendManyOutputsTransaction');
    }
    const newOptions = {
      inputs: [],
      changeAddress: null,
      startMiningTx: true,
      pinCode: null,
      changeShieldedMode: null,
      ...options,
    };

    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }
    const { inputs, changeAddress, changeShieldedMode } = newOptions;

    // Map ProposedOutput[] to ISendOutput[], handling shielded outputs
    const network = this.storage.config.getNetwork();
    const sendOutputs = outputs.map(o => {
      if (o.shielded) {
        const addressObj = new Address(o.address, { network });
        if (!addressObj.isShielded()) {
          throw new Error('Shielded output requires a shielded address');
        }
        // Extract scan pubkey from shielded address for ECDH.
        // Use the spend-derived P2PKH as the on-chain address.
        const spendAddress = addressObj.getSpendAddress();
        return {
          type: OutputType.P2PKH as OutputType.P2PKH,
          address: spendAddress.base58,
          value: o.value,
          token: o.token,
          scanPubkey: addressObj.getScanPubkey().toString('hex'),
          shieldedMode: o.shielded,
          ...(o.timelock != null ? { timelock: o.timelock } : {}),
        };
      }
      return {
        address: o.address,
        value: o.value,
        token: o.token,
        ...(o.timelock ? { timelock: o.timelock } : {}),
      };
    });

    return new SendTransaction({
      wallet: this,
      outputs: sendOutputs,
      inputs,
      changeAddress,
      changeShieldedMode,
      pin,
    });
  }

  /**
   * Send a transaction from its outputs
   *
   * @param outputs - Array of proposed outputs
   * @param options - Options parameters
   *
   * @returns Promise that resolves when transaction is sent
   */
  async sendManyOutputsTransaction(
    outputs: ProposedOutput[],
    options: SendManyOutputsOptions = {}
  ): Promise<Transaction | null> {
    const sendTransaction = await this.sendManyOutputsSendTransaction(outputs, options);
    return sendTransaction.run();
  }

  /**
   * Connect to the server and start emitting events.
   *
   * @param optionsParams Options parameters for starting the wallet
   */
  async start(optionsParams: WalletStartOptions = {}): Promise<ApiVersion> {
    const options = { pinCode: null, password: null, ...optionsParams };
    const pinCode = options.pinCode || this.pinCode;
    const password = options.password || this.password;
    if (!this.xpub && !pinCode) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }

    if (this.seed && !password) {
      throw new Error(ERROR_MESSAGE_PASSWORD_REQUIRED);
    }

    // Check database consistency
    await this.storage.store.validate();
    await this.storage.setScanningPolicyData(this.scanPolicy || null);

    this.storage.config.setNetwork(this.conn.getCurrentNetwork());
    this.storage.config.setServerUrl(this.conn.getCurrentServer());
    this.conn.on('state', this.onConnectionChangedState);
    this.conn.on('wallet-update', this.handleWebsocketMsg);

    if (this.preCalculatedAddresses) {
      for (const [index, addr] of this.preCalculatedAddresses.entries()) {
        await this.storage.saveAddress({
          base58: addr,
          bip32AddressIndex: index,
        });
      }
    }

    if (this.preCalculatedShieldedAddresses) {
      // Mirrors the legacy injection above: pre-populates the shielded chain so
      // loadAddresses skips the per-index EC derivation for these indexes.
      await savePrecalculatedShieldedAddresses(this.storage, this.preCalculatedShieldedAddresses);
    }

    let accessData = await this.storage.getAccessData();
    if (!accessData) {
      if (this.seed) {
        if (!pinCode) {
          throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
        }
        if (!password) {
          throw new Error(ERROR_MESSAGE_PASSWORD_REQUIRED);
        }
        accessData = walletUtils.generateAccessDataFromSeed(this.seed, {
          multisig: this.multisig,
          passphrase: this.passphrase,
          pin: pinCode,
          password,
          networkName: this.conn.getCurrentNetwork(),
        });
      } else if (this.xpriv) {
        if (!pinCode) {
          throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
        }
        accessData = walletUtils.generateAccessDataFromXpriv(this.xpriv, {
          multisig: this.multisig,
          pin: pinCode,
        });
      } else if (this.xpub) {
        accessData = walletUtils.generateAccessDataFromXpub(this.xpub, {
          multisig: this.multisig,
        });
      } else {
        throw new Error('This should never happen');
      }
      await this.storage.saveAccessData(accessData);
    } else if (pinCode && password) {
      // Existing wallet — migrate forward if the persisted record predates
      // shielded support. `migrateShieldedAccessData` is idempotent and a
      // no-op for xpub-only wallets (nothing to derive from). We only persist
      // when fields were actually written.
      const migrated = walletUtils.migrateShieldedAccessData(accessData, {
        pin: pinCode,
        password,
        passphrase: this.passphrase,
        networkName: this.conn.getCurrentNetwork(),
      });
      if (migrated) {
        await this.storage.saveAccessData(accessData);
      }
    }

    this.clearSensitiveData();
    this.getTokenData();
    this.walletStopped = false;
    this.setState(HathorWallet.CONNECTING);

    const info = await new Promise<ApiVersion>((resolve, reject) => {
      versionApi.getVersion(resolve).catch(error => reject(error));
    });
    if (info.network.indexOf(this.conn.getCurrentNetwork()) >= 0) {
      this.storage.setApiVersion(info);
      await this.storage.saveNativeToken();

      // Note: shielded crypto provider is not auto-detected. Clients that need
      // shielded support MUST install the appropriate crypto package
      // (@hathor/ct-crypto-node for Node, @hathor/ct-crypto-wasm for browser
      // verifier-only) and register the provider explicitly via
      // `wallet.setShieldedCryptoProvider(...)` before starting the wallet.

      this.conn.start();
    } else {
      this.setState(HathorWallet.CLOSED);
      throw new Error(
        `Wrong network. server=${info.network} expected=${this.conn.getCurrentNetwork()}`
      );
    }
    return info;
  }

  /**
   * Close the connections and stop emitting events.
   *
   * @param options Options for stopping the wallet
   */
  async stop({
    cleanStorage = true,
    cleanAddresses = false,
    cleanTokens = false,
  }: WalletStopOptions = {}): Promise<void> {
    // Set synchronously, BEFORE the awaited handleStop() wipe, so an in-flight
    // onNewTx cannot pass its walletStopped guard during the wipe and resurrect
    // a tx (with decoded shielded secrets) into the just-cleaned storage.
    this.walletStopped = true;
    this.setState(HathorWallet.CLOSED);
    this.removeAllListeners();

    await this.storage.handleStop({
      connection: this.conn,
      cleanStorage,
      cleanAddresses,
      cleanTokens,
    });

    this.firstConnection = true;
    this.conn.stop();
  }

  /**
   * Returns an address' HDPrivateKey given an index and the encryption password
   *
   * @param pinCode - The PIN used to encrypt data in accessData
   * @param addressIndex - The address' index to fetch
   *
   * @memberof HathorWallet
   * @inner
   */
  async getAddressPrivKey(pinCode: string, addressIndex: number): Promise<unknown> {
    const mainXPrivKey = await this.storage.getMainXPrivKey(pinCode);
    const addressHDPrivKey = new bitcore.HDPrivateKey(mainXPrivKey).derive(addressIndex);

    return addressHDPrivKey;
  }

  /**
   * Returns a base64 encoded signed message with an address' private key given an
   * address index
   *
   * @param message - The message to sign
   * @param index - The address index to sign with
   * @param pinCode - The PIN used to encrypt data in accessData
   *
   * @returns Promise that resolves with the signed message
   */
  async signMessageWithAddress(message: string, index: number, pinCode: string): Promise<string> {
    const addressHDPrivKey = (await this.getAddressPrivKey(pinCode, index)) as {
      privateKey: unknown;
    };
    const signedMessage = signMessage(message, addressHDPrivKey.privateKey);

    return signedMessage;
  }

  /**
   * Create SendTransaction object and run from mining
   *
   * @param transaction Transaction object to be mined and pushed to the network
   * @returns Promise that resolves with transaction object if succeeds, or with error message
   * if it fails
   * @deprecated
   */
  async handleSendPreparedTransaction(transaction: Transaction): Promise<Transaction | null> {
    const sendTransaction = new SendTransaction({ wallet: this, transaction });
    return sendTransaction.runFromMining();
  }

  /**
   * Prepare create token transaction data before mining
   *
   * @param name - Name of the token
   * @param symbol - Symbol of the token
   * @param amount - Quantity of the token to be minted
   * @param options - Options parameters
   *
   * @returns Promise that resolves with transaction object if succeeds or with error message if it fails
   */
  async prepareCreateNewToken(
    name: string,
    symbol: string,
    amount: OutputValueType,
    options: CreateTokenOptions = {}
  ): Promise<Transaction> {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('createNewToken');
    }
    const newOptions = {
      address: null,
      changeAddress: null,
      startMiningTx: true,
      pinCode: null,
      createMint: true,
      mintAuthorityAddress: null,
      allowExternalMintAuthorityAddress: false,
      createMelt: true,
      meltAuthorityAddress: null,
      allowExternalMeltAuthorityAddress: false,
      data: null,
      isCreateNFT: false,
      signTx: true,
      tokenVersion: TokenVersion.DEPOSIT,
      ...options,
    };

    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }

    if (newOptions.mintAuthorityAddress && !newOptions.allowExternalMintAuthorityAddress) {
      // Validate that the mint authority address belongs to the wallet
      const isAddressMine = await this.isAddressMine(newOptions.mintAuthorityAddress);
      if (!isAddressMine) {
        throw new Error('The mint authority address must belong to your wallet.');
      }
    }

    if (newOptions.meltAuthorityAddress && !newOptions.allowExternalMeltAuthorityAddress) {
      // Validate that the melt authority address belongs to the wallet
      const isAddressMine = await this.isAddressMine(newOptions.meltAuthorityAddress);
      if (!isAddressMine) {
        throw new Error('The melt authority address must belong to your wallet.');
      }
    }

    const mintAddress = newOptions.address || (await this.getCurrentAddress()).address;

    const txData = await tokenUtils.prepareCreateTokenData(
      mintAddress,
      name,
      symbol,
      amount,
      this.storage,
      {
        changeAddress: newOptions.changeAddress,
        createMint: newOptions.createMint,
        mintAuthorityAddress: newOptions.mintAuthorityAddress,
        createMelt: newOptions.createMelt,
        meltAuthorityAddress: newOptions.meltAuthorityAddress,
        data: newOptions.data,
        isCreateNFT: newOptions.isCreateNFT,
        tokenVersion: newOptions.tokenVersion,
      }
    );
    return transactionUtils.prepareTransaction(txData, pin, this.storage, {
      signTx: newOptions.signTx,
    });
  }

  /**
   * Builds a SendTransaction instance that will create a new token for this wallet
   *
   * @param name - Name of the token
   * @param symbol - Symbol of the token
   * @param amount - Quantity of the token to be minted
   * @param options - Options parameters
   *
   * @returns Promise that resolves with SendTransaction instance
   */
  async createNewTokenSendTransaction(
    name: string,
    symbol: string,
    amount: OutputValueType,
    options: CreateTokenOptions = {}
  ): Promise<SendTransaction> {
    const transaction = await this.prepareCreateNewToken(name, symbol, amount, options);
    return new SendTransaction({ wallet: this, transaction });
  }

  /**
   * Create a new token for this wallet
   *
   * @param name - Name of the token
   * @param symbol - Symbol of the token
   * @param amount - Quantity of the token to be minted
   * @param options - Options parameters
   *
   * @returns Promise that resolves with CreateTokenTransaction
   */
  async createNewToken(
    name: string,
    symbol: string,
    amount: OutputValueType,
    options: CreateTokenOptions = {}
  ): Promise<Transaction | null> {
    const sendTx = await this.createNewTokenSendTransaction(name, symbol, amount, options);
    return sendTx.runFromMining();
  }

  /**
   * Get mint authorities
   *
   * @param tokenUid - UID of the token to select the authority utxo
   * @param options - Object with custom options.
   * @param options.many - if should return many utxos or just one (default false)
   * @param options.only_available_utxos - If we should filter for available utxos.
   * @param options.filter_address - Address to filter the utxo to get.
   *
   * @return Promise that resolves with an Array of objects with properties of the authority output.
   *       The "authorities" field actually contains the output value with the authority masks.
   *       Returns an empty array in case there are no tx_outupts for this type.
   * */
  async getMintAuthority(tokenUid: string, options: GetAuthorityOptions = {}): Promise<IUtxo[]> {
    return this.getAuthorityUtxo(tokenUid, AuthorityType.MINT, options);
  }

  /**
   * Get melt authorities
   *
   * @param tokenUid - UID of the token to select the authority utxo
   * @param options - Object with custom options.
   * @param options.many - if should return many utxos or just one (default false)
   * @param options.only_available_utxos - If we should filter for available utxos.
   * @param options.filter_address - Address to filter the utxo to get.
   *
   * @return Promise that resolves with an Array of objects with properties of the authority output.
   *       The "authorities" field actually contains the output value with the authority masks.
   *       Returns an empty array in case there are no tx_outupts for this type.
   * */
  async getMeltAuthority(tokenUid: string, options: GetAuthorityOptions = {}): Promise<IUtxo[]> {
    return this.getAuthorityUtxo(tokenUid, AuthorityType.MELT, options);
  }

  /**
   * Get authority utxo
   *
   * @param tokenUid - UID of the token to select the authority utxo
   * @param authority - The authority to filter (AuthorityType.MINT or AuthorityType.MELT)
   * @param options - Object with custom options.
   * @param options.many - if should return many utxos or just one (default false)
   * @param options.only_available_utxos - If we should filter for available utxos.
   * @param options.filter_address - Address to filter the utxo to get.
   *
   * @return Promise that resolves with an Array of objects with properties of the authority output.
   *       The "authorities" field actually contains the output value with the authority masks.
   *       Returns an empty array in case there are no tx_outputs for this type.
   * */
  async getAuthorityUtxo(
    tokenUid: string,
    authority: AuthorityType,
    options: GetAuthorityOptions = {}
  ): Promise<IUtxo[]> {
    let authorityValue: bigint;
    if (authority === AuthorityType.MINT) {
      authorityValue = 1n;
    } else if (authority === AuthorityType.MELT) {
      authorityValue = 2n;
    } else {
      throw new Error('Invalid authority value.');
    }

    const newOptions: {
      token?: string;
      authorities?: bigint;
      only_available_utxos?: boolean;
      filter_address?: string;
      max_utxos?: number;
    } = {
      token: tokenUid,
      authorities: authorityValue,
      only_available_utxos: options.only_available_utxos ?? false,
      filter_address: options.filter_address || undefined,
    };
    if (!options.many) {
      // limit number of utxos to select if many is false
      newOptions.max_utxos = 1;
    }
    const utxos: IUtxo[] = [];
    for await (const utxo of this.storage.selectUtxos(newOptions)) {
      utxos.push(utxo);
    }
    return utxos;
  }

  /**
   * Prepare mint transaction before mining
   *
   * @param tokenUid - UID of the token to mint
   * @param amount - Quantity to mint
   * @param options - Options parameters
   *
   * @memberof HathorWallet
   * @inner
   * */
  async prepareMintTokensData(
    tokenUid: string,
    amount: OutputValueType,
    options: MintTokensOptions = {}
  ): Promise<Transaction> {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('mintTokens');
    }
    const newOptions = {
      address: null,
      changeAddress: null,
      createAnotherMint: true,
      mintAuthorityAddress: null,
      allowExternalMintAuthorityAddress: false,
      unshiftData: false,
      data: null,
      pinCode: null,
      signTx: true,
      ...options,
    };

    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }

    if (newOptions.mintAuthorityAddress && !newOptions.allowExternalMintAuthorityAddress) {
      // Validate that the mint authority address belongs to the wallet
      const isAddressMine = await this.isAddressMine(newOptions.mintAuthorityAddress);
      if (!isAddressMine) {
        throw new Error('The mint authority address must belong to your wallet.');
      }
    }

    const mintAddress = newOptions.address || (await this.getCurrentAddress()).address;

    const mintInput = await this.getMintAuthority(tokenUid, {
      many: false,
      only_available_utxos: true,
    });

    if (!mintInput || mintInput.length === 0) {
      throw new Error("Don't have mint authority output available.");
    }

    const mintOptions = {
      token: tokenUid,
      mintInput: mintInput[0],
      createAnotherMint: newOptions.createAnotherMint,
      changeAddress: newOptions.changeAddress,
      mintAuthorityAddress: newOptions.mintAuthorityAddress,
      unshiftData: newOptions.unshiftData,
      data: newOptions.data,
    };
    const txData = await tokenUtils.prepareMintTxData(
      mintAddress,
      amount,
      this.storage,
      mintOptions
    );
    return transactionUtils.prepareTransaction(txData, pin, this.storage, {
      signTx: newOptions.signTx,
    });
  }

  /**
   * Mint tokens - SendTransaction
   * Create a SendTransaction instance with a prepared mint tokens transaction.
   *
   * @param tokenUid - UID of the token to mint
   * @param amount - Quantity to mint
   * @param options - Options parameters
   *
   * @memberof HathorWallet
   * @inner
   * */
  async mintTokensSendTransaction(
    tokenUid: string,
    amount: OutputValueType,
    options: MintTokensOptions = {}
  ): Promise<SendTransaction> {
    const transaction = await this.prepareMintTokensData(tokenUid, amount, options);
    return new SendTransaction({ wallet: this, transaction });
  }

  /**
   * Mint tokens
   *
   * @param tokenUid - UID of the token to mint
   * @param amount - Quantity to mint
   * @param options - Options parameters
   *
   * @return Promise that resolves with transaction object
   *
   * @memberof HathorWallet
   * @inner
   * */
  async mintTokens(
    tokenUid: string,
    amount: OutputValueType,
    options: MintTokensOptions = {}
  ): Promise<Transaction | null> {
    const sendTx = await this.mintTokensSendTransaction(tokenUid, amount, options);
    return sendTx.runFromMining();
  }

  /**
   * Prepare melt transaction before mining
   *
   * @param tokenUid - UID of the token to melt
   * @param amount - Quantity to melt
   * @param options - Options parameters
   *
   * @memberof HathorWallet
   * @inner
   * */
  async prepareMeltTokensData(
    tokenUid: string,
    amount: OutputValueType,
    options: MeltTokensOptions = {}
  ): Promise<Transaction> {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('meltTokens');
    }
    const newOptions = {
      address: null,
      changeAddress: null,
      createAnotherMelt: true,
      meltAuthorityAddress: null,
      allowExternalMeltAuthorityAddress: false,
      unshiftData: false,
      data: null,
      pinCode: null,
      signTx: true,
      ...options,
    };

    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }

    if (newOptions.meltAuthorityAddress && !newOptions.allowExternalMeltAuthorityAddress) {
      // Validate that the melt authority address belongs to the wallet
      const isAddressMine = await this.isAddressMine(newOptions.meltAuthorityAddress);
      if (!isAddressMine) {
        throw new Error('The melt authority address must belong to your wallet.');
      }
    }

    const meltInput = await this.getMeltAuthority(tokenUid, {
      many: false,
      only_available_utxos: true,
    });

    if (!meltInput || meltInput.length === 0) {
      throw new Error("Don't have melt authority output available.");
    }

    const meltOptions = {
      createAnotherMelt: newOptions.createAnotherMelt,
      meltAuthorityAddress: newOptions.meltAuthorityAddress,
      changeAddress: newOptions.changeAddress,
      unshiftData: newOptions.unshiftData,
      data: newOptions.data,
    };
    const txData = await tokenUtils.prepareMeltTxData(
      tokenUid,
      meltInput[0],
      newOptions.address || (await this.getCurrentAddress()).address,
      amount,
      this.storage,
      meltOptions
    );
    return transactionUtils.prepareTransaction(txData, pin, this.storage, {
      signTx: newOptions.signTx,
    });
  }

  /**
   * Melt tokens - SendTransaction
   * Create a SendTransaction instance with a prepared melt tokens transaction.
   *
   * @param tokenUid - UID of the token to melt
   * @param amount - Quantity to melt
   * @param options - Options parameters
   *
   * @memberof HathorWallet
   * @inner
   * */
  async meltTokensSendTransaction(
    tokenUid: string,
    amount: OutputValueType,
    options: MeltTokensOptions = {}
  ): Promise<SendTransaction> {
    const transaction = await this.prepareMeltTokensData(tokenUid, amount, options);
    return new SendTransaction({ wallet: this, transaction });
  }

  /**
   * Melt tokens
   *
   * @param tokenUid - UID of the token to melt
   * @param amount - Quantity to melt
   * @param options - Options parameters
   *
   * @return Promise that resolves with transaction object
   *
   * @memberof HathorWallet
   * @inner
   * */
  async meltTokens(
    tokenUid: string,
    amount: OutputValueType,
    options: MeltTokensOptions = {}
  ): Promise<Transaction | null> {
    const sendTx = await this.meltTokensSendTransaction(tokenUid, amount, options);
    return sendTx.runFromMining();
  }

  /**
   * Prepare delegate authority transaction before mining
   *
   * @param tokenUid - UID of the token to delegate the authority
   * @param type - Type of the authority to delegate (AuthorityType.MINT or AuthorityType.MELT)
   * @param destinationAddress - Destination address of the delegated authority
   * @param options - Options parameters
   *
   * @memberof HathorWallet
   * @inner
   * */
  async prepareDelegateAuthorityData(
    tokenUid: string,
    type: AuthorityType,
    destinationAddress: string,
    options: DelegateAuthorityOptions = {}
  ): Promise<Transaction> {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('delegateAuthority');
    }
    const newOptions = { createAnother: true, pinCode: null, ...options };
    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }
    const { createAnother } = newOptions;
    let delegateInput: IUtxo[];
    if (type === AuthorityType.MINT) {
      delegateInput = await this.getMintAuthority(tokenUid, {
        many: false,
        only_available_utxos: true,
      });
    } else if (type === AuthorityType.MELT) {
      delegateInput = await this.getMeltAuthority(tokenUid, {
        many: false,
        only_available_utxos: true,
      });
    } else {
      throw new Error('This should never happen.');
    }

    if (delegateInput.length === 0) {
      // FIXME: This obviously invalid cast is to prevent a breaking change that possibly would only
      // cause problems at the clients. This fix will need to wait until a major version change.
      throw new Error({
        success: false,
        message: ErrorMessages.NO_UTXOS_AVAILABLE,
      } as unknown as string);
    }

    const txData = await tokenUtils.prepareDelegateAuthorityTxData(
      tokenUid,
      delegateInput[0],
      destinationAddress,
      this.storage,
      createAnother
    );

    return transactionUtils.prepareTransaction(txData, pin, this.storage);
  }

  /**
   * Delegate authority - Send Transaction
   * Create a SendTransaction instance ready to mine a delegate authority transaction.
   *
   * @param tokenUid - UID of the token to delegate the authority
   * @param type - Type of the authority to delegate (AuthorityType.MINT or AuthorityType.MELT)
   * @param destinationAddress - Destination address of the delegated authority
   * @param options - Options parameters
   *
   * @memberof HathorWallet
   * @inner
   * */
  async delegateAuthoritySendTransaction(
    tokenUid: string,
    type: AuthorityType,
    destinationAddress: string,
    options: DelegateAuthorityOptions = {}
  ): Promise<SendTransaction> {
    const transaction = await this.prepareDelegateAuthorityData(
      tokenUid,
      type,
      destinationAddress,
      options
    );
    return new SendTransaction({ wallet: this, transaction });
  }

  /**
   * Delegate authority
   *
   * @param tokenUid - UID of the token to delegate the authority
   * @param type - Type of the authority to delegate (AuthorityType.MINT or AuthorityType.MELT)
   * @param destinationAddress - Destination address of the delegated authority
   * @param options - Options parameters
   *
   * @return Promise that resolves with transaction object
   *
   * @memberof HathorWallet
   * @inner
   * */
  async delegateAuthority(
    tokenUid: string,
    type: AuthorityType,
    destinationAddress: string,
    options: DelegateAuthorityOptions = {}
  ): Promise<Transaction | null> {
    const sendTx = await this.delegateAuthoritySendTransaction(
      tokenUid,
      type,
      destinationAddress,
      options
    );
    return sendTx.runFromMining();
  }

  /**
   * Prepare destroy authority transaction before mining
   *
   * @param tokenUid - UID of the token to delegate the authority
   * @param type - Type of the authority to destroy (AuthorityType.MINT or AuthorityType.MELT)
   * @param count - How many authority outputs to destroy
   * @param options - Options parameters
   *
   * @memberof HathorWallet
   * @inner
   * */
  async prepareDestroyAuthorityData(
    tokenUid: string,
    type: AuthorityType,
    count: number,
    options: DestroyAuthorityOptions = {}
  ): Promise<Transaction> {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('destroyAuthority');
    }
    const newOptions = { pinCode: null, ...options };
    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }
    let destroyInputs: IUtxo[];
    if (type === AuthorityType.MINT) {
      destroyInputs = await this.getMintAuthority(tokenUid, {
        many: true,
        only_available_utxos: true,
      });
    } else if (type === AuthorityType.MELT) {
      destroyInputs = await this.getMeltAuthority(tokenUid, {
        many: true,
        only_available_utxos: true,
      });
    } else {
      throw new Error('This should never happen.');
    }

    if (destroyInputs.length < count) {
      throw new Error(ErrorMessages.NO_UTXOS_AVAILABLE);
    }

    const data: IUtxo[] = [];
    for (const utxo of destroyInputs) {
      // FIXME: select utxos passing count to the method
      data.push(utxo);
      // Even though count is expected as a number, I am using ==
      // in case someone sends a string in the future
      if (data.length >= count) {
        break;
      }
    }

    const txData = tokenUtils.prepareDestroyAuthorityTxData(data);
    return transactionUtils.prepareTransaction(txData, pin, this.storage);
  }

  /**
   * Destroy authority - SendTransaction
   * Creates a SendTransaction instance with a prepared destroy transaction.
   *
   * @param tokenUid - UID of the token to destroy the authority
   * @param type - Type of the authority to destroy (AuthorityType.MINT or AuthorityType.MELT)
   * @param count - How many authority outputs to destroy
   * @param options - Options parameters
   *
   * @memberof HathorWallet
   * @inner
   * */
  async destroyAuthoritySendTransaction(
    tokenUid: string,
    type: AuthorityType,
    count: number,
    options: DestroyAuthorityOptions = {}
  ): Promise<SendTransaction> {
    const transaction = await this.prepareDestroyAuthorityData(tokenUid, type, count, options);
    return new SendTransaction({ wallet: this, transaction });
  }

  /**
   * Destroy authority
   *
   * @param tokenUid - UID of the token to destroy the authority
   * @param type - Type of the authority to destroy (AuthorityType.MINT or AuthorityType.MELT)
   * @param count - How many authority outputs to destroy
   * @param options - Options parameters
   *
   * @return Promise that resolves with transaction object
   *
   * @memberof HathorWallet
   * @inner
   * */
  async destroyAuthority(
    tokenUid: string,
    type: AuthorityType,
    count: number,
    options: DestroyAuthorityOptions = {}
  ): Promise<Transaction | null> {
    const sendTx = await this.destroyAuthoritySendTransaction(tokenUid, type, count, options);
    return sendTx.runFromMining();
  }

  /**
   * Remove sensitive data from memory
   *
   * NOTICE: This won't remove data from memory immediately, we have to wait until javascript
   * garbage collect it. JavaScript currently does not provide a standard way to trigger
   * garbage collection
   * */
  clearSensitiveData(): void {
    this.xpriv = undefined;
    this.seed = undefined;
  }

  /**
   * Get all authorities utxos for specific token
   *
   * @param tokenUid - UID of the token to delegate the authority
   * @param type - Type of the authority to search for (AuthorityType.MINT or AuthorityType.MELT)
   *
   * @return Array of the authority outputs.
   * */
  async getAuthorityUtxos(tokenUid: string, type: AuthorityType): Promise<IUtxo[]> {
    if (type === AuthorityType.MINT) {
      return this.getMintAuthority(tokenUid, { many: true });
    }
    if (type === AuthorityType.MELT) {
      return this.getMeltAuthority(tokenUid, { many: true });
    }
    throw new Error('This should never happen.');
  }

  getTokenData(): void {
    if (this.tokenUid === NATIVE_TOKEN_UID) {
      // Hathor token we don't get from the full node
      this.token = this.storage.getNativeTokenData();
    } else {
      // XXX: This request is not awaited
      // Get token info from full node
      // XXX This request might take longer than the ws connection to start
      // so it's possible (but hard to happen) that the wallet will change to
      // READY state with token still null.
      // I will keep it like that for now but to protect from this
      // we should change to READY only after both things finish
      walletApi.getGeneralTokenInfo(this.tokenUid, (response: GeneralTokenInfoSchema) => {
        if (response.success) {
          this.token = {
            uid: this.tokenUid,
            name: response.name,
            symbol: response.symbol,
            version: response.version ?? undefined, // Version can't be null
          };
        } else {
          throw Error(response.message);
        }
      });
    }
  }

  /**
   * Call get token details API
   *
   * @param tokenId Token uid to get the token details
   *
   * @return token details
   */
  // eslint-disable-next-line class-methods-use-this -- The server address is fetched directly from the configs
  async getTokenDetails(tokenId: string): Promise<GetTokenDetailsFullnodeFacadeReturnType> {
    const result: GeneralTokenInfoSchema = await new Promise((resolve, reject) => {
      walletApi.getGeneralTokenInfo(tokenId, resolve).catch(error => reject(error));
    });

    if (!result.success) {
      throw new Error(result.message);
    }

    const { name, symbol, mint, melt, total, transactions_count, version } = result;

    // Transform to the same format the wallet service facade responds
    return {
      totalSupply: total,
      totalTransactions: transactions_count,
      tokenInfo: {
        id: tokenId,
        name,
        symbol,
        version: version ?? undefined,
      },
      authorities: {
        mint: mint.length > 0,
        melt: melt.length > 0,
      },
    };
  }

  isReady(): boolean {
    return this.state === HathorWallet.READY;
  }

  /**
   * HTR deposit required to mint the given amount of a deposit-based token.
   *
   * The deposit percentage is read from the connected fullnode's `/version` data,
   * so callers pass only the amount. Requires the wallet to be READY.
   *
   * @memberof HathorWallet
   * @inner
   */
  getDepositAmount(mintAmount: OutputValueType): OutputValueType {
    if (!this.isReady()) {
      throw new WalletError('Wallet not ready');
    }
    const { numerator, denominator } = this.storage.getTokenDepositPercentageFraction();
    return tokenUtils.getDepositAmount(mintAmount, numerator, denominator);
  }

  /**
   * HTR withdrawal returned when melting the given amount of a deposit-based token.
   *
   * The deposit percentage is read from the connected fullnode's `/version` data,
   * so callers pass only the amount. Requires the wallet to be READY.
   *
   * @memberof HathorWallet
   * @inner
   */
  getWithdrawAmount(meltAmount: OutputValueType): OutputValueType {
    if (!this.isReady()) {
      throw new WalletError('Wallet not ready');
    }
    const { numerator, denominator } = this.storage.getTokenDepositPercentageFraction();
    return tokenUtils.getWithdrawAmount(meltAmount, numerator, denominator);
  }

  /**
   * Check if address is from the loaded wallet
   *
   * @param address Address to check
   */
  async isAddressMine(address: string): Promise<boolean> {
    return this.storage.isAddressMine(address);
  }

  /**
   * Check if a list of addresses are from the loaded wallet
   *
   * @param addresses Addresses to check
   *
   * @returns Object with the addresses and whether it belongs or not { address: boolean }
   */
  async checkAddressesMine(addresses: string[]): Promise<Record<string, boolean>> {
    const promises: Promise<{ address: string; mine: boolean }>[] = [];
    for (const address of addresses) {
      promises.push(this.storage.isAddressMine(address).then(mine => ({ address, mine })));
    }

    const results = await Promise.all(promises);
    return results.reduce((acc, result) => {
      acc[result.address] = result.mine;
      return acc;
    }, {});
  }

  /**
   * Get index of address
   * Returns null if address does not belong to the wallet
   *
   * @param address Address to get the index
   */
  async getAddressIndex(address: string): Promise<number | null> {
    const addressInfo = await this.storage.getAddressInfo(address);
    return get(addressInfo, 'bip32AddressIndex', null);
  }

  /**
   * FIXME: does not differentiate between locked and unlocked, also ignores authorities
   * Returns the balance for each token in tx, if the input/output belongs to this wallet
   *
   * @param tx Decoded transaction with populated data from local wallet history
   * @param optionsParam
   *
   * @return Promise that resolves with an object with each token and it's balance in this tx for this wallet
   *
   * @example
   * const decodedTx = hathorWalletInstance.getTx(txHash);
   * const txBalance = await hathorWalletInstance.getTxBalance(decodedTx);
   * */
  async getTxBalance(
    tx: IHistoryTx,
    optionsParam: { includeAuthorities?: boolean } = {}
  ): Promise<Record<string, bigint>> {
    const balance: Record<string, bigint> = {};
    const fullBalance = await transactionUtils.getTxBalance(tx, this.storage);

    // We need to map balance for backwards compatibility
    for (const [token, tokenBalance] of Object.entries(fullBalance)) {
      balance[token] = tokenBalance.tokens.locked + tokenBalance.tokens.unlocked;
    }

    return balance;
  }

  /**
   * Return the addresses of the tx that belongs to this wallet
   * The address might be in the input or output
   * Removes duplicates
   *
   * @param tx Transaction data with array of inputs and outputs
   *
   * @return Set of strings with addresses
   * */
  async getTxAddresses(tx: IHistoryTx): Promise<Set<string>> {
    const addresses = new Set<string>();
    for (const io of [...tx.outputs, ...tx.inputs]) {
      if (io.decoded && io.decoded.address && (await this.isAddressMine(io.decoded.address))) {
        addresses.add(io.decoded.address);
      }
    }
    // SEPARATED model: a shielded output the wallet owns lives in
    // tx.shielded_outputs[], not tx.outputs[]; its decoded.address is the
    // wallet's on-chain spend-derived P2PKH. Without this a shielded-only
    // receive returns an empty/incomplete address set. decoded.address is
    // on-wire so this works regardless of decryption state.
    for (const so of tx.shielded_outputs ?? []) {
      if (so.decoded?.address && (await this.isAddressMine(so.decoded.address))) {
        addresses.add(so.decoded.address);
      }
    }

    return addresses;
  }

  /**
   * Create a SendTransaction instance with a create NFT transaction prepared.
   *
   * @param name - Name of the token
   * @param symbol - Symbol of the token
   * @param amount - Quantity of the token to be minted
   * @param data - NFT data string using utf8 encoding
   * @param options - Options parameters
   *
   * @returns Promise that resolves with SendTransaction instance
   */
  async createNFTSendTransaction(
    name: string,
    symbol: string,
    amount: OutputValueType,
    data: string,
    options: CreateNFTOptions = {}
  ): Promise<SendTransaction> {
    const newOptions: CreateTokenOptions = {
      address: null,
      changeAddress: null,
      startMiningTx: true,
      pinCode: null,
      createMint: false,
      mintAuthorityAddress: null,
      allowExternalMintAuthorityAddress: false,
      createMelt: false,
      meltAuthorityAddress: null,
      allowExternalMeltAuthorityAddress: false,
      ...options,
      data: [data],
      isCreateNFT: true,
    };
    const transaction = await this.prepareCreateNewToken(name, symbol, amount, newOptions);
    return new SendTransaction({ wallet: this, transaction });
  }

  /**
   * Create an NFT for this wallet
   *
   * @param name - Name of the token
   * @param symbol - Symbol of the token
   * @param amount - Quantity of the token to be minted
   * @param data - NFT data string using utf8 encoding
   * @param options - Options parameters
   *
   * @returns Promise that resolves with CreateTokenTransaction
   */
  async createNFT(
    name: string,
    symbol: string,
    amount: OutputValueType,
    data: string,
    options: CreateNFTOptions = {}
  ): Promise<Transaction | null> {
    const sendTx = await this.createNFTSendTransaction(name, symbol, amount, data, options);
    return sendTx.runFromMining();
  }

  /**
   * Identify all inputs from the loaded wallet
   *
   * @param tx - The transaction
   *
   * @returns List of indexes and their associated address index
   */
  async getWalletInputInfo(tx: Transaction): Promise<Array<IWalletInputInfo>> {
    const walletInputs: IWalletInputInfo[] = [];

    for await (const { tx: spentTx, input, index } of this.storage.getSpentTxs(tx.inputs)) {
      // SEPARATED model: a shielded input's on-chain index is >= outputs.length,
      // so a positional `spentTx.outputs[input.index]` read is undefined and
      // throws. Resolve arithmetically (mirrors getSignatureForTx); the
      // spend-derived decoded.address is on the wire for every output.
      const resolved = transactionUtils.resolveSpentOutput(spentTx, input.index);
      const spentAddress = resolved?.output?.decoded?.address;
      if (!spentAddress) {
        continue;
      }
      const addressInfo = await this.storage.getAddressInfo(spentAddress);
      if (addressInfo === null) {
        continue;
      }
      // A shielded-spend input's key lives on the spend chain (m/44'/280'/2'),
      // not the legacy P2PKH chain — select the right path so it matches the key
      // that actually signs the input (see getSignatureForTx).
      const addressPath = await this.getAddressPathForIndex(addressInfo.bip32AddressIndex, {
        legacy: addressInfo.addressType !== 'shielded-spend',
      });
      walletInputs.push({
        inputIndex: index,
        addressIndex: addressInfo.bip32AddressIndex,
        addressPath,
      });
    }

    return walletInputs;
  }

  /**
   * Get signatures for all inputs of the loaded wallet.
   *
   * @param tx - The transaction to be signed
   * @param options - Options for getting signatures
   * @param options.pinCode - PIN to decrypt the private key. Optional but required if not set in this
   *
   * @returns Input and signature information
   */
  async getSignatures(
    tx: Transaction,
    { pinCode = null }: { pinCode?: string | null } = {}
  ): Promise<Array<ISignature>> {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('getSignatures');
    }
    const pin = pinCode || this.pinCode;
    if (!pin) {
      throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
    }
    const signatures = await this.storage.getTxSignatures(tx, pin);
    const sigInfoArray: ISignature[] = [];
    for (const sigData of signatures.inputSignatures) {
      sigInfoArray.push({
        ...sigData,
        pubkey: sigData.pubkey.toString('hex'),
        signature: sigData.signature.toString('hex'),
        // Render the path that matches the key that signed: a 'shielded-spend'
        // input was signed with the spend chain, not the legacy P2PKH chain.
        addressPath: await this.getAddressPathForIndex(sigData.addressIndex, {
          legacy: sigData.addressType !== 'shielded-spend',
        }),
      });
    }
    return sigInfoArray;
  }

  /**
   * Sign all inputs of the given transaction.
   *
   * @param tx - The transaction to be signed
   * @param options - Options for signing
   * @param options.pinCode - PIN to decrypt the private key
   *
   * @returns The signed transaction
   */
  async signTx(tx: Transaction, options: { pinCode?: string | null } = {}): Promise<Transaction> {
    if (await this.isReadonly()) {
      throw new WalletFromXPubGuard('signTx');
    }
    const pinCode = options.pinCode ?? this.pinCode;
    if (!pinCode) {
      throw new Error('Pin code is required to sign a transaction');
    }

    const signedTx = await transactionUtils.signTransaction(tx, this.storage, pinCode);
    signedTx.prepareToSend(transactionUtils.getWeightConstantsFromStorage(this.storage));
    return signedTx;
  }

  /**
   * Guard to check if the response is a transaction not found response
   *
   * @param data The request response data
   * @throws TxNotFoundError if the returned error was a transaction not found
   */
  static _txNotFoundGuard(data: unknown): void {
    if ((get(data, 'message', '') as string) === 'Transaction not found') {
      throw new TxNotFoundError();
    }
  }

  /**
   * Queries the fullnode for a transaction
   *
   * @param txId The transaction to query
   *
   * @returns Transaction data in the fullnode
   */
  // eslint-disable-next-line class-methods-use-this -- The server address is fetched directly from the configs
  async getFullTxById(txId: string): Promise<FullNodeTxApiResponse> {
    const tx = await new Promise<FullNodeTxApiResponse>((resolve, reject) => {
      txApi
        .getTransaction(txId, resolve)
        // txApi will call the `resolve` callback and end the promise chain,
        // so if it falls here, we should throw
        .then(() => reject(new Error('API client did not use the callback')))
        .catch(err => reject(err));
    });
    if (!tx.success) {
      HathorWallet._txNotFoundGuard(tx);

      throw new Error(`Invalid transaction ${txId}`);
    }

    return tx;
  }

  /**
   * Queries the fullnode for a transaction confirmation data
   *
   * @param txId The transaction to query
   *
   * @returns Transaction confirmation data
   */
  // eslint-disable-next-line class-methods-use-this -- The server address is fetched directly from the configs
  async getTxConfirmationData(txId: string): Promise<TransactionAccWeightResponse> {
    const confirmationData: TransactionAccWeightResponse = await new Promise((resolve, reject) => {
      txApi
        .getConfirmationData(txId, resolve)
        .then(() => reject(new Error('API client did not use the callback')))
        .catch(err => reject(err));
    });

    if (!confirmationData.success) {
      HathorWallet._txNotFoundGuard(confirmationData);

      throw new Error(`Invalid transaction ${txId}`);
    }

    return confirmationData;
  }

  /**
   * Queries the fullnode for a graphviz graph, given a graph type and txId
   *
   * @param txId The transaction to query
   * @param graphType The graph type to query
   * @param maxLevel Max level to render
   *
   * @returns The graphviz digraph
   */
  // eslint-disable-next-line class-methods-use-this -- The server address is fetched directly from the configs
  async graphvizNeighborsQuery(
    txId: string,
    graphType: string,
    maxLevel: number
  ): Promise<GraphvizNeighboursDotResponse> {
    const graphvizData: GraphvizNeighboursResponse = await new Promise<GraphvizNeighboursResponse>(
      (resolve, reject) => {
        txApi
          .getGraphvizNeighbors(txId, graphType, maxLevel, resolve)
          .then(() => reject(new Error('API client did not use the callback')))
          .catch(err => reject(err));
      }
    );

    const isGraphvizError = (d: unknown): d is GraphvizNeighboursErrorResponse =>
      typeof d === 'object' && d !== null && 'success' in d && typeof d.success === 'boolean';

    // The response will either be a string with the graphviz data or an object
    // { success: boolean, message: string } so we need to check if the response has
    // the `success` key
    if (isGraphvizError(graphvizData) && !graphvizData.success) {
      HathorWallet._txNotFoundGuard(graphvizData);

      throw new Error(`Invalid transaction ${txId}`);
    }

    return graphvizData as GraphvizNeighboursDotResponse;
  }

  /**
   * This function is responsible for getting the details of each token in the transaction.
   * @param txId - Transaction id
   * @returns Array of token details
   * @example
   * {
   *   success: true,
   *   txTokens: [
   *     {
   *      txId: '000021e7addbb94a8e43d7f1237d556d47efc4d34800c5923ed3a75bf5a2886e';
   *      timestamp: 123456789;
   *      version: 1;
   *      voided: false;
   *      weight: 18.5;
   *      tokenId: '00',
   *      tokenName: 'Hathor',
   *      tokenSymbol: 'HTR',
   *      balance: 100,
   *     },
   *   ],
   * }
   * @throws {Error} Invalid transaction
   * @throws {Error} Client did not use the callback
   * @throws {Error} Transaction not found
   * @throws {Error} Transaction does not have any balance for this wallet
   * @throws {Error} Token uid not found in tokens list
   * @throws {Error} Token uid not found in tx
   */
  async getTxById(txId: string): Promise<GetTxByIdFullnodeFacadeReturnType> {
    /**
     * Hydrate input and output with token uid
     * @param  io - Input or output
     * @param tokens - Array of token configs
     * @example
     * {
     *   ...output,
     *   token: '00',
     * }
     * @throws {Error} Token uid not found in tokens list
     */
    const hydrateWithTokenUid = <T extends { token_data: number }>(
      io: T,
      tokens: Array<{ uid: string }>
    ): T & { token: string } => {
      const { token_data } = io;

      if (token_data === 0) {
        return {
          ...io,
          token: NATIVE_TOKEN_UID,
        };
      }

      const tokenIdx = tokenUtils.getTokenIndexFromData(token_data);
      const tokenUid = tokens[tokenIdx - 1]?.uid;
      if (!tokenUid) {
        throw new Error(`Invalid token_data ${token_data}, token not found in tokens list`);
      }

      return {
        ...io,
        token: tokenUid,
      };
    };

    const fullTx = await this.getFullTxById(txId);
    if (!fullTx.success) {
      throw new Error(`Failed to get transaction ${txId}: ${fullTx.message}`);
    }

    // Shielded outputs are never delivered inline in outputs[] (they arrive in
    // the dedicated shielded_outputs[] field), so every wire output here is
    // transparent and can be hydrated. Shielded inputs, however, may arrive bare
    // (commitment only) and lack the token_data hydrateWithTokenUid needs, so
    // those are skipped.
    fullTx.tx.outputs = fullTx.tx.outputs.map(output =>
      hydrateWithTokenUid(output, fullTx.tx.tokens)
    );
    // Inputs can include a bare shielded input (no transparent token_data) — skip
    // it; getTxBalance recovers its value/token from the parent shielded output.
    fullTx.tx.inputs = fullTx.tx.inputs.map(input =>
      transactionUtils.isShieldedInputEntry(input as { type?: string })
        ? input
        : hydrateWithTokenUid(input as { token_data: number }, fullTx.tx.tokens)
    ) as typeof fullTx.tx.inputs;

    // Prefer the locally-decoded tx for the balance. A fresh fullnode fetch
    // carries shielded_outputs WITHOUT their decrypted value/token (the wallet's
    // ECDH-recovered plaintext lives only in local storage), so getTxBalance
    // over the wire copy credits 0 for owned shielded outputs and could even
    // throw "no balance" for a shielded-only receive. Fall back to the
    // (normalized) wire copy only when the tx isn't in our local history.
    const localTx = await this.storage.getTx(txId);
    let balanceTx: IHistoryTx;
    if (localTx) {
      balanceTx = localTx;
    } else {
      // Normalize the shielded outputs' base64 confidential fields to hex
      // (getTxBalance reads off the separated shielded_outputs[] array).
      transactionUtils.normalizeShieldedOutputs(fullTx.tx as unknown as IHistoryTx);
      balanceTx = fullTx.tx as unknown as IHistoryTx;
    }

    // Get the balance of each token in the transaction that belongs to this wallet
    // sample output: { 'A': 100, 'B': 10 }, where 'A' and 'B' are token UIDs
    const tokenBalances = await this.getTxBalance(balanceTx);
    const { length: hasBalance } = Object.keys(tokenBalances);
    if (!hasBalance) {
      throw new Error(`Transaction ${txId} does not have any balance for this wallet`);
    }

    const listTokenUid = Object.keys(tokenBalances);
    const txTokens = listTokenUid.map(uid => {
      /**
       * Retrieves the token config from the transaction.
       * @param tokenUid
       * @returns Token config
       */
      const getToken = (
        tokenUid: string
      ): { uid: string; name: string | null; symbol: string | null } => {
        if (tokenUid === NATIVE_TOKEN_UID) {
          return this.storage.getNativeTokenData();
        }

        const token = fullTx.tx.tokens.find(tokenElem => tokenElem.uid === tokenUid);
        if (!token) {
          throw new Error(`Token ${tokenUid} not found in tx`);
        }

        return token;
      };

      const isVoided = fullTx.meta.voided_by.length > 0;
      const token = getToken(uid);
      const tokenBalance = tokenBalances[uid];

      const tokenDetails = {
        txId,
        timestamp: fullTx.tx.timestamp,
        version: fullTx.tx.version,
        voided: isVoided,
        weight: fullTx.tx.weight,
        tokenId: token.uid,
        tokenName: token.name,
        tokenSymbol: token.symbol,
        balance: tokenBalance,
      };
      return tokenDetails;
    });

    return { success: true, txTokens };
  }

  /**
   * Check if the pin used to encrypt the main key is valid.
   */
  async checkPin(pin: string): Promise<boolean> {
    return this.storage.checkPin(pin);
  }

  /**
   * Check if the password used to encrypt the seed is valid.
   */
  async checkPassword(password: string): Promise<boolean> {
    return this.storage.checkPassword(password);
  }

  /**
   * Check if both pin and password are valid.
   */
  async checkPinAndPassword(pin: string, password: string): Promise<boolean> {
    return (await this.checkPin(pin)) && this.checkPassword(password); // The promise from checkPassword will be returned here
  }

  /**
   * Check if the wallet is a hardware wallet.
   */
  async isHardwareWallet(): Promise<boolean> {
    return this.storage.isHardwareWallet();
  }

  /**
   * Create and send a Transaction with nano header
   *
   * @param method Method of nano contract to have the transaction created
   * @param address Address that will be used to sign the nano contract transaction
   * @param data Data for the nano contract transaction
   * @param options Options for the nano contract transaction
   */
  async createAndSendNanoContractTransaction(
    method: string,
    address: string,
    data: FullnodeCreateNanoTxData,
    options: Omit<CreateNanoTxOptions, 'signTx'> = {}
  ): Promise<Transaction | null> {
    const sendTransaction = await this.createNanoContractTransaction(method, address, data, {
      ...options,
      signTx: true,
    });
    return sendTransaction.runFromMining();
  }

  /**
   * Create a Transaction with nano header and return the SendTransaction object
   *
   * @param method Method of nano contract to have the transaction created
   * @param address Address that will be used to sign the nano contract transaction
   * @param data Data for the nano contract transaction
   * @param options Options for the nano contract transaction
   */
  async createNanoContractTransaction(
    method: string,
    address: string,
    data: FullnodeCreateNanoTxData,
    options: CreateNanoTxOptions = {}
  ): Promise<SendTransaction> {
    if (await this.storage.isReadonly()) {
      throw new WalletFromXPubGuard('createNanoContractTransaction');
    }
    const newOptions = { pinCode: null, signTx: true, ...options };
    const pin = newOptions.pinCode || this.pinCode;

    // Only require PIN if we're actually signing
    if (newOptions.signTx !== false && !pin) {
      throw new PinRequiredError(ERROR_MESSAGE_PIN_REQUIRED);
    }

    // Get caller pubkey
    const addressInfo = await this.storage.getAddressInfo(address);
    if (!addressInfo) {
      throw new NanoContractTransactionError(
        `Address used to sign the transaction (${address}) does not belong to the wallet.`
      );
    }

    // Build and send transaction
    const builder = new NanoContractTransactionBuilder()
      .setMethod(method)
      .setWallet(this)
      .setBlueprintId(data.blueprintId!)
      .setNcId(data.ncId!)
      .setCaller(new Address(address, { network: this.getNetworkObject() }))
      .setActions(data.actions)
      .setArgs(data.args!)
      .setVertexType(NanoContractVertexType.TRANSACTION);

    // Set max fee if declared
    if (newOptions.maxFee !== undefined) {
      builder.setMaxFee(newOptions.maxFee);
    }

    // Set contract pays fees if declared
    if (newOptions.contractPaysFees !== undefined) {
      builder.setContractPaysFees(newOptions.contractPaysFees);
    }

    const nc = await builder.build();
    if (newOptions.signTx !== false) {
      return prepareNanoSendTransaction(nc, pin!, this.storage);
    }

    return new SendTransaction({
      storage: this.storage,
      transaction: nc,
    });
  }

  /**
   * Create and send a Create Token Transaction with nano header
   *
   * @param method Method of nano contract to have the transaction created
   * @param address Address that will be used to sign the nano contract transaction
   * @param data Data for the nano contract transaction
   * @param createTokenOptions Options for the create token transaction
   * @param options Options for the nano contract transaction
   */
  async createAndSendNanoContractCreateTokenTransaction(
    method: string,
    address: string,
    data: FullnodeCreateNanoTxData,
    createTokenOptions: CreateNanoTokenTxOptions,
    options: CreateNanoTxOptions = {}
  ): Promise<Transaction | null> {
    const sendTransaction = await this.createNanoContractCreateTokenTransaction(
      method,
      address,
      data,
      createTokenOptions,
      options
    );
    return sendTransaction.runFromMining();
  }

  /**
   * Create a Create Token Transaction with nano header and return the SendTransaction object
   *
   * @param method Method of nano contract to have the transaction created
   * @param address Address that will be used to sign the nano contract transaction
   * @param data Data for the nano contract transaction
   * @param createTokenOptions Options for the create token transaction
   * @param options Options for the nano contract transaction
   */
  async createNanoContractCreateTokenTransaction(
    method: string,
    address: string,
    data: FullnodeCreateNanoTxData,
    createTokenOptions: CreateNanoTokenTxOptions,
    options: CreateNanoTxOptions = {}
  ): Promise<SendTransaction> {
    if (await this.storage.isReadonly()) {
      throw new WalletFromXPubGuard('createNanoContractCreateTokenTransaction');
    }
    const newOptions = { pinCode: null, signTx: true, ...options };
    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new PinRequiredError(ERROR_MESSAGE_PIN_REQUIRED);
    }

    const newCreateTokenOptions = {
      mintAddress: null,
      changeAddress: null,
      createMint: true,
      mintAuthorityAddress: null,
      allowExternalMintAuthorityAddress: false,
      createMelt: true,
      meltAuthorityAddress: null,
      allowExternalMeltAuthorityAddress: false,
      data: null,
      isCreateNFT: false,
      tokenVersion: TokenVersion.DEPOSIT,
      ...createTokenOptions,
    };

    if (
      newCreateTokenOptions.mintAuthorityAddress &&
      !newCreateTokenOptions.allowExternalMintAuthorityAddress
    ) {
      // Validate that the mint authority address belongs to the wallet
      const isAddressMine = await this.isAddressMine(newCreateTokenOptions.mintAuthorityAddress);
      if (!isAddressMine) {
        throw new NanoContractTransactionError(
          'The mint authority address must belong to your wallet.'
        );
      }
    }

    if (
      newCreateTokenOptions.meltAuthorityAddress &&
      !newCreateTokenOptions.allowExternalMeltAuthorityAddress
    ) {
      // Validate that the melt authority address belongs to the wallet
      const isAddressMine = await this.isAddressMine(newCreateTokenOptions.meltAuthorityAddress);
      if (!isAddressMine) {
        throw new NanoContractTransactionError(
          'The melt authority address must belong to your wallet.'
        );
      }
    }

    newCreateTokenOptions.mintAddress =
      newCreateTokenOptions.mintAddress || (await this.getCurrentAddress()).address;

    // Get caller pubkey
    const addressInfo = await this.storage.getAddressInfo(address);
    if (!addressInfo) {
      throw new NanoContractTransactionError(
        `Address used to sign the transaction (${address}) does not belong to the wallet.`
      );
    }
    // Build and send transaction
    const builder = new NanoContractTransactionBuilder()
      .setMethod(method)
      .setWallet(this)
      .setBlueprintId(data.blueprintId!)
      .setNcId(data.ncId!)
      .setCaller(new Address(address, { network: this.getNetworkObject() }))
      .setActions(data.actions)
      .setArgs(data.args!)
      .setVertexType(
        NanoContractVertexType.CREATE_TOKEN_TRANSACTION,
        newCreateTokenOptions as NanoContractBuilderCreateTokenOptions
      );

    // Set max fee if declared
    if (newOptions.maxFee !== undefined) {
      builder.setMaxFee(newOptions.maxFee);
    }

    // Set contract pays fees if declared
    if (newOptions.contractPaysFees !== undefined) {
      builder.setContractPaysFees(newOptions.contractPaysFees);
    }

    const nc = await builder.build();
    if (newOptions.signTx !== false) {
      return prepareNanoSendTransaction(nc, pin, this.storage);
    }
    return new SendTransaction({
      storage: this.storage,
      transaction: nc,
    });
  }

  /**
   * Generate and return the PrivateKey for an address
   *
   * @param address Address to get the PrivateKey from
   * @param [options]
   * @param [options.pinCode] PIN to decrypt the private key.
   *                          Optional but required if not set in instance
   */
  async getPrivateKeyFromAddress(address: string, options = {}): Promise<unknown> {
    if (await this.storage.isReadonly()) {
      throw new WalletFromXPubGuard('getPrivateKeyFromAddress');
    }
    const newOptions = { pinCode: null, ...options };
    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new PinRequiredError(ERROR_MESSAGE_PIN_REQUIRED);
    }

    const addressIndex = await this.getAddressIndex(address);
    if (addressIndex === null) {
      throw new AddressError('Address does not belong to the wallet.');
    }

    const xprivkey = await this.storage.getMainXPrivKey(pin);
    const key = HDPrivateKey(xprivkey);
    // Derive key to addressIndex
    const derivedKey = key.deriveNonCompliantChild(addressIndex);
    return derivedKey.privateKey;
  }

  /**
   * Set the external tx signing method.
   *
   * @param method The external transaction signing method, or null to clear
   */
  setExternalTxSigningMethod(method: EcdsaTxSign | null): void {
    this.isSignedExternally = !!method;
    this.storage.setTxSignatureMethod(method);
  }

  /**
   * Set the shielded crypto provider for confidential transaction support.
   * Use this for explicit injection (e.g., mobile apps using UniFFI bindings).
   *
   * @param provider The shielded crypto provider, or undefined to disable
   */
  setShieldedCryptoProvider(provider?: IShieldedCryptoProvider): void {
    this.storage.setShieldedCryptoProvider(provider);
  }

  /**
   * Set the history sync mode.
   *
   * @param mode The history sync mode to use
   */
  setHistorySyncMode(mode: HistorySyncMode): void {
    this.historySyncMode = mode;
  }

  /**
   * Sync wallet history starting from a specific address index.
   *
   * @param startIndex The index of the first address to sync
   * @param count The number of addresses to sync
   * @param shouldProcessHistory If we should process the transaction history found
   */
  async syncHistory(
    startIndex: number,
    count: number,
    shouldProcessHistory?: boolean,
    pinCode?: string
  ): Promise<void> {
    if (!(await getSupportedSyncMode(this.storage)).includes(this.historySyncMode)) {
      throw new Error('Trying to use an unsupported sync method for this wallet.');
    }
    let syncMode = this.historySyncMode;
    if (
      [HistorySyncMode.MANUAL_STREAM_WS, HistorySyncMode.XPUB_STREAM_WS].includes(
        this.historySyncMode
      ) &&
      !(await this.conn.hasCapability('history-streaming'))
    ) {
      // History sync mode is streaming but fullnode is not streaming capable.
      // We revert to the http polling default.
      this.logger.debug(
        'Either fullnode does not support history-streaming or has not sent a capabilities event'
      );
      this.logger.debug('Falling back to http polling API');
      syncMode = HistorySyncMode.POLLING_HTTP_API;
    }
    const syncMethod = getHistorySyncMethod(syncMode);
    // This will add the task to the GLL queue and return a promise that
    // resolves when the task finishes executing
    await GLL.add(async () => {
      await syncMethod(startIndex, count, this.storage, this.conn, shouldProcessHistory, pinCode);
    });
  }

  /**
   * Reload all addresses and transactions from the full node.
   */
  async reloadStorage(): Promise<void> {
    await this.conn.onReload();

    // unsub all addresses. getAllAddresses() yields the legacy chain; shielded
    // receives are subscribed by their on-chain spend-derived P2PKH (the 71-byte
    // shielded address itself is never subscribed — the fullnode indexes by
    // on-chain script), so also unsubscribe each shielded record's paired spend
    // P2PKH (ctMappingAddress). Without this, shielded subscriptions leak on reload.
    for await (const address of this.storage.getAllAddresses()) {
      this.conn.unsubscribeAddress(address.base58);
    }
    for await (const address of this.storage.getAllAddresses({ legacy: false })) {
      if (address.ctMappingAddress) {
        this.conn.unsubscribeAddress(address.ctMappingAddress);
      }
    }
    const accessData = await this.storage.getAccessData();
    if (accessData != null) {
      // Clean entire storage
      await this.storage.cleanStorage(true, true);
      // Reset access data
      await this.storage.saveAccessData(accessData);
    }
    const addressesToLoad = await scanPolicyStartAddresses(this.storage);
    await this.syncHistory(
      addressesToLoad.nextIndex,
      addressesToLoad.count,
      false,
      this.pinCode ?? undefined
    );
  }

  /**
   * Build a transaction from a template.
   *
   * @param template The transaction template to build
   * @param options Options for building the template
   */
  async buildTxTemplate(
    template: z.input<typeof TransactionTemplate>,
    options: BuildTxTemplateOptions = {}
  ): Promise<Transaction> {
    const newOptions = {
      signTx: false,
      pinCode: null,
      ...options,
    };
    const instructions = TransactionTemplate.parse(template);
    const tx = await this.txTemplateInterpreter.build(instructions, this.debug);
    if (newOptions.signTx) {
      const pin = newOptions.pinCode || this.pinCode;
      if (!pin) {
        throw new Error(ERROR_MESSAGE_PIN_REQUIRED);
      }
      await transactionUtils.signTransaction(tx, this.storage, pin);
      tx.prepareToSend(transactionUtils.getWeightConstantsFromStorage(this.storage));
    }
    return tx;
  }

  /**
   * Run a transaction template and send the transaction.
   *
   * @param template The transaction template to run
   * @param pinCode PIN to decrypt the private key
   */
  async runTxTemplate(
    template: z.input<typeof TransactionTemplate>,
    pinCode?: string
  ): Promise<Transaction | null> {
    const transaction = await this.buildTxTemplate(template, {
      signTx: true,
      pinCode,
    });
    return this.handleSendPreparedTransaction(transaction);
  }

  /**
   * Create and send an on chain blueprint transaction
   *
   * @param code Blueprint code in utf-8
   * @param address Address that will be used to sign the on chain blueprint transaction
   * @param options Options for the on chain blueprint transaction
   */
  async createAndSendOnChainBlueprintTransaction(
    code: string,
    address: string,
    options: CreateOnChainBlueprintTxOptions = {}
  ): Promise<Transaction | null> {
    const sendTransaction = await this.createOnChainBlueprintTransaction(code, address, options);
    return sendTransaction.runFromMining();
  }

  /**
   * Create an on chain blueprint transaction and return the SendTransaction object
   *
   * @param code Blueprint code in utf-8
   * @param address Address that will be used to sign the on chain blueprint transaction
   * @param options Options for the on chain blueprint transaction
   */
  async createOnChainBlueprintTransaction(
    code: string,
    address: string,
    options: CreateOnChainBlueprintTxOptions = {}
  ): Promise<SendTransaction> {
    if (await this.storage.isReadonly()) {
      throw new WalletFromXPubGuard('createOnChainBlueprintTransaction');
    }
    const newOptions = { pinCode: null, ...options };
    const pin = newOptions.pinCode || this.pinCode;
    if (!pin) {
      throw new PinRequiredError(ERROR_MESSAGE_PIN_REQUIRED);
    }

    // Get caller pubkey
    const addressInfo = await this.storage.getAddressInfo(address);
    if (!addressInfo) {
      throw new NanoContractTransactionError(
        `Address used to sign the transaction (${address}) does not belong to the wallet.`
      );
    }
    const pubkeyStr = await this.storage.getAddressPubkey(addressInfo.bip32AddressIndex);
    const pubkey = Buffer.from(pubkeyStr, 'hex');

    // Create code object from code data
    const codeContent = Buffer.from(code, 'utf8');
    const codeObj = new Code(CodeKind.PYTHON_ZLIB, codeContent);

    const tx = new OnChainBlueprint(codeObj, pubkey);

    return prepareNanoSendTransaction(tx, pin, this.storage);
  }

  /**
   * Get the seqnum to be used in a nano header for the address
   *
   * @param address Address string that will be the nano header caller
   */
  async getNanoHeaderSeqnum(address: string): Promise<number> {
    const addressInfo = await this.storage.getAddressInfo(address);
    return addressInfo!.seqnum! + 1;
  }

  /**
   * Set the caller address and seqnum on a nano contract header
   *
   * @param nanoHeader The nano contract header to modify
   * @param address The new caller address
   */
  async setNanoHeaderCaller(nanoHeader: NanoContractHeader, address: string): Promise<void> {
    const addressInfo = await this.storage.getAddressInfo(address);
    if (!addressInfo) {
      throw new NanoContractTransactionError(
        `Address used to sign the transaction (${address}) does not belong to the wallet.`
      );
    }

    await setNanoHeaderCallerFromWallet(nanoHeader, address, this as unknown as IHathorWallet);
  }

  /**
   * Start wallet in read-only mode
   *
   * @param options Options for starting in read-only mode
   * @throws Error - This method is not implemented
   */
  // eslint-disable-next-line class-methods-use-this
  async startReadOnly(options?: StartReadOnlyOptions): Promise<void> {
    throw new Error('Not Implemented');
  }

  /**
   * Get authentication token for read-only mode
   *
   * @throws Error - This method is not implemented
   */
  // eslint-disable-next-line class-methods-use-this
  async getReadOnlyAuthToken(): Promise<string> {
    throw new Error('Not implemented.');
  }

  /**
   * Get which address mode is currently enabled.
   *
   * @memberof HathorWallet
   * @inner
   */
  async getAddressMode(): Promise<WalletAddressMode> {
    if (!this.isReady()) {
      throw new WalletError('Wallet not ready');
    }

    const scanPolicy = await this.storage.getScanningPolicy();
    if (scanPolicy === SCANNING_POLICY.SINGLE_ADDRESS) {
      return WalletAddressMode.SINGLE;
    }
    return WalletAddressMode.MULTI;
  }

  /**
   * Enable multi address mode for this wallet.
   * Converts to a gap-limit wallet.
   *
   * @memberof HathorWallet
   * @inner
   */
  async enableMultiAddressMode(gapLimit: number = GAP_LIMIT): Promise<void> {
    if (!this.isReady()) {
      throw new WalletError('Wallet not ready');
    }

    const currScanPolicy = await this.storage.getScanningPolicy();
    if (currScanPolicy !== SCANNING_POLICY.SINGLE_ADDRESS) {
      // multi address mode is already enabled.
      return;
    }

    // Switch policy in storage
    await this.storage.setScanningPolicyData({
      policy: SCANNING_POLICY.GAP_LIMIT,
      gapLimit,
    });

    // Load new addresses
    await this.reloadStorage();
  }

  /**
   * Enable single-address scanning policy for this wallet.
   * Converts a gap-limit wallet to use only the first address (index 0).
   *
   * @memberof HathorWallet
   * @inner
   */
  async enableSingleAddressMode(): Promise<void> {
    if (await this.hasTxOutsideFirstAddress()) {
      throw new HasTxOutsideFirstAddressError(
        'Cannot enable single-address policy: wallet has transactions on addresses other than the first'
      );
    }

    const currScanPolicy = await this.storage.getScanningPolicy();
    if (currScanPolicy === SCANNING_POLICY.SINGLE_ADDRESS) {
      // single address mode is already enabled.
      return;
    }

    // Switch policy in storage
    await this.storage.setScanningPolicyData({
      policy: SCANNING_POLICY.SINGLE_ADDRESS,
    });

    // Load new addresses
    await this.reloadStorage();
  }
}

export default HathorWallet;

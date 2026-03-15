/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * This test validates that all types, interfaces, enums, and utilities
 * are properly exported from the library's public API (src/lib.ts).
 *
 * If a type is added to any of the source type files but not re-exported
 * from lib.ts, these tests will catch it at compile time (tsc) since
 * the import will fail.
 */

import {
  // ============================================================
  // Core types from src/types.ts
  // ============================================================

  // Enums
  TokenVersion,
  HistorySyncMode,
  WalletState,
  TxHistoryProcessingStatus,
  WalletType,
  WALLET_FLAGS,
  SCANNING_POLICY,
  AuthorityType,

  // Type aliases
  type OutputValueType,
  type EcdsaTxSign,
  type HistorySyncFunction,
  type UtxoSelectionAlgorithm,
  type AddressScanPolicy,
  type AddressScanPolicyData,

  // Interfaces
  type ILogger,
  type ITxSignatureData,
  type IInputSignature,
  type IAddressInfo,
  type IAddressMetadata,
  type IAddressMetadataAsRecord,
  type ITokenData,
  type ITokenMetadata,
  type IBalance,
  type ITokenBalance,
  type IAuthoritiesBalance,
  type IHistoryTx,
  type IHistoryInput,
  type IHistoryOutput,
  type IHistoryOutputDecoded,
  type IHistoryNanoContractAction,
  type IHistoryNanoContractContext,
  type IHistoryNanoContractActionWithdrawal,
  type IHistoryNanoContractActionDeposit,
  type IHistoryNanoContractActionGrantAuthority,
  type IHistoryNanoContractActionAcquireAuthority,
  type IFeeEntry,
  type IDataOutputData,
  type IDataOutputAddress,
  type IDataOutputCreateToken,
  type IDataOutputOptionals,
  type IDataOutput,
  type IDataOutputWithToken,
  type IDataInput,
  type IDataTx,
  type IUtxoId,
  type IUtxo,
  type ILockedUtxo,
  type IWalletAccessData,
  type IGapLimitAddressScanPolicy,
  type IIndexLimitAddressScanPolicy,
  type IScanPolicyLoadAddresses,
  type IWalletData,
  type IEncryptedData,
  type IMultisigData,
  type IUtxoFilterOptions,
  type IUtxoSelectionOptions,
  type IFillTxOptions,
  type ApiVersion,
  type IStore,
  type IStorage,
  type AddressIndexValidateResponse,
  type HistoryIndexValidateResponse,
  type INcData,

  // Type guards
  isDataOutputData,
  isDataOutputAddress,
  isDataOutputCreateToken,
  isGapLimitScanPolicy,
  isIndexLimitScanPolicy,
  isAuthorityType,
  getDefaultLogger,

  // ============================================================
  // Nano contract types from src/nano_contracts/types.ts
  // ============================================================
  NanoContractVertexType,
  NanoContractActionType,
  NanoContractHeaderActionType,
  ActionTypeToActionHeaderType,
  INanoContractActionSchema,
  type IArgumentField,
  type IParsedArgument,
  type NanoContractActionHeader,
  type NanoContractAction,
  type MethodArgInfo,
  type NanoContractBlueprintInformationAPIResponse,
  type NanoContractHistoryAPIResponse,
  type NanoContractStateAPIResponse,
  type NanoContractStateAPIParameters,
  type BufferROExtract,
  type NanoContractBuilderCreateTokenOptions,
  type CreateNanoTxData,
  type CreateNanoTxOptions,
  type NanoContractBlueprintSourceCodeAPIResponse,
  type BlueprintListItem,
  type NanoContractBlueprintListAPIResponse,
  type NanoContractCreationListItem,
  type NanoContractCreationListAPIResponse,
  type NanoContractLogsAPIResponse,

  // ============================================================
  // Model types from src/models/types.ts
  // ============================================================
  type HistoryTransactionOutput,
  type HistoryTransactionInput,
  type HistoryTransaction,
  type Balance,
  type TokenBalance,
  type AuthorityBalance,
  type Authority,
  type AtomicSwapProposal,

  // ============================================================
  // Wallet types from src/wallet/types.ts
  // ============================================================
  ConnectionState,
  OutputType,
  type CreateTokenOptionsInput,
  type GetAddressesObject,
  type GetBalanceObject,
  type TokenInfo,
  type WalletBalance,
  type AuthoritiesBalance,
  type WalletAuthority,
  type GetHistoryObject,
  type AddressInfoObject,
  type GetAddressDetailsObject,
  type WalletStatusResponseData,
  type WalletStatus,
  type IHathorWallet,
  type ISendTransaction,
  type OutputRequestObj,
  type DataScriptOutputRequestObj,
  type WsTransaction,
  type WsTxInput,
  type WsTxOutput,
  type FullNodeTx,
  type FullNodeTxResponse,
  type FullNodeMeta,
  type FullNodeVersionData,
  type FullNodeToken,
  type FullNodeInput,
  type FullNodeOutput,
  type FullNodeDecodedInput,
  type FullNodeDecodedOutput,
  type FullNodeTxConfirmationDataResponse,
  type TxOutput,
  type TxInput,
  type DecodedOutput,
  type Utxo,
  type TokenMap,
  type WalletAddressMap,
  type TransactionFullObject,

  // ============================================================
  // Fullnode wallet types from src/new/types.ts
  // ============================================================
  type HathorWalletConstructorParams,
  type UtxoOptions,
  type GetAvailableUtxosOptions,
  type GetUtxosForAmountOptions,
  type GetAuthorityOptions,
  type MintTokensOptions,
  type MeltTokensOptions,
  type FullnodeDelegateAuthorityOptions,
  type FullnodeDestroyAuthorityOptions,
  type WalletStartOptions,
  type WalletStopOptions,
  type WalletWebSocketData,
  type FullnodeCreateNanoTxData,
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

  // ============================================================
  // Template types from src/template/transaction/types.ts
  // ============================================================
  type TxInstance,
  type IGetUtxosOptions,
  type IGetUtxoResponse,
  type IWalletBalanceData,
  type IWalletTokenDetails,
  type ITxTemplateInterpreter,

  // ============================================================
  // Header types from src/headers/types.ts
  // ============================================================
  VertexHeaderId,
  getVertexHeaderIdBuffer,
  getVertexHeaderIdFromBuffer,

  // ============================================================
  // Utility namespaces
  // ============================================================
  addressUtils,
  cryptoUtils,
  bufferUtils,
  numberUtils,
  scriptsUtils,
  tokensUtils,
  walletUtils,
  helpersUtils,
  transactionUtils,
  bigIntUtils,
  nanoUtils,

  // ============================================================
  // Classes
  // ============================================================
  HathorWallet,
  Connection,
  Storage,
  MemoryStore,
  Network,
  Transaction,
  Input,
  Output,
  Address,
  P2PKH,
  P2SH,
  P2SHSignature,
  ScriptData,
  CreateTokenTransaction,
  SendTransaction,
  FeeHeader,
  Fee,
  PartialTx,
  PartialTxInputData,
  PartialTxProposal,
  NanoContractTransactionParser,
  TransactionTemplate,
  TransactionTemplateBuilder,
  WalletTxTemplateInterpreter,
} from '../src/lib';

// ============================================================
// Test: Enums have correct values
// ============================================================

describe('exported enums', () => {
  it('should export TokenVersion with correct values', () => {
    expect(TokenVersion.NATIVE).toBe(0);
    expect(TokenVersion.DEPOSIT).toBe(1);
    expect(TokenVersion.FEE).toBe(2);
  });

  it('should export WalletState with correct values', () => {
    expect(WalletState.CLOSED).toBe(0);
    expect(WalletState.CONNECTING).toBe(1);
    expect(WalletState.SYNCING).toBe(2);
    expect(WalletState.READY).toBe(3);
    expect(WalletState.ERROR).toBe(4);
    expect(WalletState.PROCESSING).toBe(5);
  });

  it('should export HistorySyncMode with correct values', () => {
    expect(HistorySyncMode.POLLING_HTTP_API).toBe('polling-http-api');
    expect(HistorySyncMode.MANUAL_STREAM_WS).toBe('manual-stream-ws');
    expect(HistorySyncMode.XPUB_STREAM_WS).toBe('xpub-stream-ws');
  });

  it('should export WalletType with correct values', () => {
    expect(WalletType.P2PKH).toBe('p2pkh');
    expect(WalletType.MULTISIG).toBe('multisig');
  });

  it('should export TxHistoryProcessingStatus with correct values', () => {
    expect(TxHistoryProcessingStatus.PROCESSING).toBe('processing');
    expect(TxHistoryProcessingStatus.FINISHED).toBe('finished');
  });

  it('should export WALLET_FLAGS with correct values', () => {
    expect(WALLET_FLAGS.READONLY).toBe(0b00000001);
    expect(WALLET_FLAGS.HARDWARE).toBe(0b00000010);
  });

  it('should export SCANNING_POLICY with correct values', () => {
    expect(SCANNING_POLICY.GAP_LIMIT).toBe('gap-limit');
    expect(SCANNING_POLICY.INDEX_LIMIT).toBe('index-limit');
  });

  it('should export AuthorityType with correct values', () => {
    expect(AuthorityType.MINT).toBe('mint');
    expect(AuthorityType.MELT).toBe('melt');
  });

  it('should export NanoContractVertexType with correct values', () => {
    expect(NanoContractVertexType.TRANSACTION).toBe('transaction');
    expect(NanoContractVertexType.CREATE_TOKEN_TRANSACTION).toBe('createTokenTransaction');
  });

  it('should export NanoContractActionType with correct values', () => {
    expect(NanoContractActionType.DEPOSIT).toBe('deposit');
    expect(NanoContractActionType.WITHDRAWAL).toBe('withdrawal');
    expect(NanoContractActionType.GRANT_AUTHORITY).toBe('grant_authority');
    expect(NanoContractActionType.ACQUIRE_AUTHORITY).toBe('acquire_authority');
  });

  it('should export NanoContractHeaderActionType with correct values', () => {
    expect(NanoContractHeaderActionType.DEPOSIT).toBe(1);
    expect(NanoContractHeaderActionType.WITHDRAWAL).toBe(2);
    expect(NanoContractHeaderActionType.GRANT_AUTHORITY).toBe(3);
    expect(NanoContractHeaderActionType.ACQUIRE_AUTHORITY).toBe(4);
  });

  it('should export ConnectionState with correct values', () => {
    expect(ConnectionState.CLOSED).toBe(0);
    expect(ConnectionState.CONNECTING).toBe(1);
    expect(ConnectionState.CONNECTED).toBe(2);
  });

  it('should export OutputType with correct values', () => {
    expect(OutputType.P2PKH).toBe('p2pkh');
    expect(OutputType.P2SH).toBe('p2sh');
    expect(OutputType.DATA).toBe('data');
  });
});

// ============================================================
// Test: Type guard functions work correctly
// ============================================================

describe('exported type guards', () => {
  it('should export isAuthorityType', () => {
    expect(isAuthorityType('mint')).toBe(true);
    expect(isAuthorityType('melt')).toBe(true);
    expect(isAuthorityType('invalid')).toBe(false);
    expect(isAuthorityType(undefined)).toBe(false);
  });

  it('should export isGapLimitScanPolicy', () => {
    const gapPolicy: IGapLimitAddressScanPolicy = {
      policy: SCANNING_POLICY.GAP_LIMIT,
      gapLimit: 20,
    };
    const indexPolicy: IIndexLimitAddressScanPolicy = {
      policy: SCANNING_POLICY.INDEX_LIMIT,
      startIndex: 0,
      endIndex: 10,
    };
    expect(isGapLimitScanPolicy(gapPolicy)).toBe(true);
    expect(isGapLimitScanPolicy(indexPolicy)).toBe(false);
  });

  it('should export isIndexLimitScanPolicy', () => {
    const indexPolicy: IIndexLimitAddressScanPolicy = {
      policy: SCANNING_POLICY.INDEX_LIMIT,
      startIndex: 0,
      endIndex: 10,
    };
    expect(isIndexLimitScanPolicy(indexPolicy)).toBe(true);
  });

  it('should export getDefaultLogger', () => {
    const logger = getDefaultLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});

// ============================================================
// Test: Utility namespaces are properly exported
// ============================================================

describe('exported utility namespaces', () => {
  it('should export addressUtils', () => {
    expect(addressUtils).toBeDefined();
    expect(typeof addressUtils.getAddressType).toBe('function');
  });

  it('should export cryptoUtils', () => {
    expect(cryptoUtils).toBeDefined();
    expect(typeof cryptoUtils.encryptData).toBe('function');
    expect(typeof cryptoUtils.decryptData).toBe('function');
  });

  it('should export bufferUtils', () => {
    expect(bufferUtils).toBeDefined();
    expect(typeof bufferUtils.hexToBuffer).toBe('function');
    expect(typeof bufferUtils.bufferToHex).toBe('function');
  });

  it('should export numberUtils', () => {
    expect(numberUtils).toBeDefined();
    expect(typeof numberUtils.prettyValue).toBe('function');
  });

  it('should export scriptsUtils', () => {
    expect(scriptsUtils).toBeDefined();
    expect(typeof scriptsUtils.parseP2PKH).toBe('function');
    expect(typeof scriptsUtils.parseP2SH).toBe('function');
  });

  it('should export bigIntUtils', () => {
    expect(bigIntUtils).toBeDefined();
    expect(bigIntUtils.JSONBigInt).toBeDefined();
  });

  it('should export nanoUtils', () => {
    expect(nanoUtils).toBeDefined();
  });
});

// ============================================================
// Test: Classes are properly exported
// ============================================================

describe('exported classes', () => {
  it('should export core model classes', () => {
    expect(Transaction).toBeDefined();
    expect(Input).toBeDefined();
    expect(Output).toBeDefined();
    expect(Address).toBeDefined();
    expect(Network).toBeDefined();
    expect(CreateTokenTransaction).toBeDefined();
  });

  it('should export script classes', () => {
    expect(P2PKH).toBeDefined();
    expect(P2SH).toBeDefined();
    expect(P2SHSignature).toBeDefined();
    expect(ScriptData).toBeDefined();
  });

  it('should export wallet classes', () => {
    expect(HathorWallet).toBeDefined();
    expect(Connection).toBeDefined();
    expect(SendTransaction).toBeDefined();
    expect(Storage).toBeDefined();
    expect(MemoryStore).toBeDefined();
  });

  it('should export fee classes', () => {
    expect(FeeHeader).toBeDefined();
    expect(Fee).toBeDefined();
  });

  it('should export partial transaction classes', () => {
    expect(PartialTx).toBeDefined();
    expect(PartialTxInputData).toBeDefined();
    expect(PartialTxProposal).toBeDefined();
  });

  it('should export nano contract parser', () => {
    expect(NanoContractTransactionParser).toBeDefined();
  });

  it('should export transaction template classes', () => {
    expect(TransactionTemplate).toBeDefined();
    expect(TransactionTemplateBuilder).toBeDefined();
    expect(WalletTxTemplateInterpreter).toBeDefined();
  });
});

// ============================================================
// Test: Nano contract schemas are properly exported
// ============================================================

describe('exported nano contract schemas', () => {
  it('should export ActionTypeToActionHeaderType mapping', () => {
    expect(ActionTypeToActionHeaderType[NanoContractActionType.DEPOSIT]).toBe(
      NanoContractHeaderActionType.DEPOSIT
    );
    expect(ActionTypeToActionHeaderType[NanoContractActionType.WITHDRAWAL]).toBe(
      NanoContractHeaderActionType.WITHDRAWAL
    );
  });

  it('should export INanoContractActionSchema for validation', () => {
    expect(INanoContractActionSchema).toBeDefined();
    const result = INanoContractActionSchema.safeParse({
      type: 'deposit',
      token: '00',
      amount: 100n,
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================
// Test: Header types are properly exported
// ============================================================

describe('exported header utilities', () => {
  it('should export getVertexHeaderIdBuffer', () => {
    expect(typeof getVertexHeaderIdBuffer).toBe('function');
  });

  it('should export getVertexHeaderIdFromBuffer', () => {
    expect(typeof getVertexHeaderIdFromBuffer).toBe('function');
  });
});

// ============================================================
// Test: Type-only imports compile correctly (compile-time validation)
//
// These tests use type assertions to verify that the types are
// structurally correct. If any type is not exported, this file
// will fail to compile.
// ============================================================

describe('type-only exports compile correctly', () => {
  it('should allow constructing IAddressInfo', () => {
    const addr: IAddressInfo = {
      base58: 'WYBwT3xLpDnHNtYZiU5WfQhWbHyJMBrATq',
      bip32AddressIndex: 0,
    };
    expect(addr.base58).toBeDefined();
  });

  it('should allow constructing ITokenData', () => {
    const token: ITokenData = {
      uid: '00',
      name: 'Hathor',
      symbol: 'HTR',
    };
    expect(token.uid).toBe('00');
  });

  it('should allow constructing IBalance', () => {
    const balance: IBalance = {
      tokens: { locked: 0n, unlocked: 100n },
      authorities: {
        mint: { locked: 0n, unlocked: 0n },
        melt: { locked: 0n, unlocked: 0n },
      },
    };
    expect(balance.tokens.unlocked).toBe(100n);
  });

  it('should allow constructing IUtxo', () => {
    const utxo: IUtxo = {
      txId: 'abc123',
      index: 0,
      token: '00',
      address: 'WYBwT3xLpDnHNtYZiU5WfQhWbHyJMBrATq',
      value: 100n,
      authorities: 0n,
      timelock: null,
      type: 0,
      height: null,
    };
    expect(utxo.txId).toBe('abc123');
  });

  it('should allow constructing IWalletData', () => {
    const data: IWalletData = {
      lastLoadedAddressIndex: 10,
      lastUsedAddressIndex: 5,
      currentAddressIndex: 6,
      bestBlockHeight: 100,
      scanPolicyData: {
        policy: SCANNING_POLICY.GAP_LIMIT,
        gapLimit: 20,
      },
    };
    expect(data.bestBlockHeight).toBe(100);
  });

  it('should allow constructing INcData', () => {
    const ncData: INcData = {
      ncId: 'nc-123',
      address: 'WYBwT3xLpDnHNtYZiU5WfQhWbHyJMBrATq',
      blueprintId: 'bp-456',
      blueprintName: 'TestBlueprint',
    };
    expect(ncData.ncId).toBe('nc-123');
  });

  it('should allow constructing wallet-specific types', () => {
    const tokenInfo: TokenInfo = {
      id: '00',
      name: 'Hathor',
      symbol: 'HTR',
      version: TokenVersion.NATIVE,
    };
    expect(tokenInfo.id).toBe('00');

    const walletBalance: WalletBalance = {
      unlocked: 100n,
      locked: 0n,
    };
    expect(walletBalance.unlocked).toBe(100n);
  });

  it('should allow constructing fullnode wallet types', () => {
    const params: Partial<HathorWalletConstructorParams> = {
      seed: 'test seed phrase',
    };
    expect(params.seed).toBeDefined();

    const mintOpts: MintTokensOptions = {
      pinCode: '1234',
      createAnotherMint: true,
    };
    expect(mintOpts.pinCode).toBe('1234');
  });

  it('should allow constructing fullnode-specific types', () => {
    const opts: FullnodeDelegateAuthorityOptions = {
      createAnother: true,
      pinCode: '1234',
    };
    expect(opts.createAnother).toBe(true);
  });

  it('should allow constructing FullNodeTx type', () => {
    const tx: Partial<FullNodeTx> = {
      hash: 'abc123',
      version: 1,
      timestamp: 1234567890,
    };
    expect(tx.hash).toBe('abc123');
  });

  it('should allow constructing nano contract API response types', () => {
    const stateParams: NanoContractStateAPIParameters = {
      id: 'nc-123',
      fields: ['balance'],
      balances: ['00'],
      calls: [],
    };
    expect(stateParams.id).toBe('nc-123');
  });
});

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hathor Wallet Library is a JavaScript/TypeScript library used by Hathor Wallet for interacting with the Hathor Network blockchain. It handles wallet operations, transaction management, blockchain synchronization, and nano contracts.

## Build and Development Commands

### Building
```bash
npm run build       # Transpile TypeScript and generate type definitions
npm run tsc         # Run TypeScript compiler only
```

The build process uses Babel to transpile `.ts` and `.js` files from `src/` to `lib/`, then runs TypeScript to generate type declarations. Output goes to `lib/` directory.

### Testing
```bash
npm test                    # Run unit tests with coverage
npm run test:watch          # Run tests in watch mode

# Integration tests (requires Docker)
npm run test_integration    # Full integration test suite
npm run test_network_up     # Start Docker test environment
npm run test_network_integration  # Run integration tests
npm run test_network_down   # Stop Docker test environment

# Run specific integration test
SPECIFIC_INTEGRATION_TEST_FILE=<filename> npm run test_network_integration
```

Integration tests use a Docker-based Hathor network defined in `__tests__/integration/configuration/docker-compose.yml`.

### Code Quality
```bash
npm run lint            # Run ESLint
npm run lint:fix        # Auto-fix linting issues
npm run format          # Format code with Prettier
npm run format:check    # Check formatting
```

## Architecture

### Wallet Types

The library supports two distinct wallet architectures:

1. **Full Node Wallet (`HathorWallet` in `src/new/wallet.js`)**:
   - Direct connection to Hathor full nodes
   - Manages transaction history locally via `Storage` class
   - Uses `Connection` class for full node WebSocket communication
   - High test coverage requirements (92% statements, 85% branches)

2. **Wallet Service Wallet (`HathorWalletServiceWallet` in `src/wallet/wallet.ts`)**:
   - Connects to Hathor Wallet Service (centralized backend)
   - Uses `WalletServiceConnection` for WebSocket communication
   - Lighter weight, delegates history management to service

### Core Components

**Connection Layer** (`src/connection.ts`, `src/wallet/connection.ts`)
- Base connection management with states: CLOSED, CONNECTING, CONNECTED
- WebSocket handling in `src/websocket/`
- Separate connection classes for full node vs wallet service

**Storage** (`src/storage/`)
- `Storage` class: Main storage abstraction implementing `IStorage` interface
- `MemoryStore`: In-memory implementation of `IStore` interface
- Storage must be initialized before use via `hathorLib.storage.setStore(storageFactory)`
- Manages: addresses, transactions, UTXOs, token metadata, balances

**Transaction Models** (`src/models/`)
- `Transaction`, `CreateTokenTransaction`: Transaction types
- `Input`, `Output`: Transaction components
- `Address`, `P2PKH`, `P2SH`, `P2SHSignature`: Address and script models
- `PartialTx`: Partial transaction support for multi-party transactions

**APIs** (`src/api/`)
- `walletApi`: Full node wallet API
- `txApi`: Transaction API
- `metadataApi`, `featuresApi`: Metadata and feature detection
- `walletServiceAxios`: Wallet service HTTP API
- Axios-based with schema validation using Zod

**Nano Contracts** (`src/nano_contracts/`)
- Smart contract support for Hathor Network
- Field types in `fields/`: address, amount, bool, bytes, int, str, timestamp, token, etc.
- Encoding utilities in `fields/encoding/`: LEB128, sized bytes, UTF-8
- `NanoContractTransactionParser`: Parse nano contract transactions
- `NanoContractTransactionBuilder`: Build nano contract transactions
- `OnChainBlueprint`: On-chain blueprint handling

**Transaction Templates** (`src/template/transaction/`)
- `TransactionTemplate`: Template-based transaction creation
- `TransactionTemplateBuilder`: Build transaction templates
- `WalletTxTemplateInterpreter`: Execute templates with wallet context
- Template execution with instructions, context, and variable setting

**Synchronization** (`src/sync/`)
- `GLL`: Graph-based synchronization algorithm
- Multiple sync modes: polling HTTP API, manual WebSocket stream, xpub stream

**Utilities** (`src/utils/`)
- `address`: Address derivation (P2PKH, P2SH) and validation
- `crypto`: Cryptographic operations, signing, encryption
- `transaction`: Transaction building and validation
- `wallet`: Wallet utilities and helpers
- `tokens`: Token operations
- `scripts`: Bitcoin-style script handling
- `buffer`, `bigint`: Data type utilities

### Key Patterns

**Wallet Lifecycle States**:
- CLOSED → CONNECTING → SYNCING → READY
- Subscribe to 'state' events to track state changes
- Events: 'new-tx', 'update-tx', 'more-addresses-loaded'

**Storage Pattern**:
- Client must provide storage implementation
- Storage factory pattern for initialization
- Supports custom storage backends (localStorage, IndexedDB, etc.)

**Address Scanning**:
- GAP_LIMIT: 20 addresses can be generated without transactions
- Address scanning policies in `types.ts`: INDEX_LIMIT, GAP_LIMIT
- BIP44 derivation path: m/44'/280'/0'/0/index (280 = Hathor BIP44 code)

**Multi-signature Support**:
- P2SH addresses with multisig scripts
- Separate derivation path for P2SH vs P2PKH

## Type System

- TypeScript with Babel transpilation
- Type definitions generated in `lib/` alongside transpiled code
- `noImplicitAny: false` for gradual migration
- Main type definitions in `src/types.ts`, `src/wallet/types.ts`, `src/models/types.ts`
- Zod schemas for API validation in `src/api/schemas/`

## Testing Notes

- Unit tests in `__tests__/` mirror `src/` structure
- Mock helpers in `__tests__/__mock_helpers__/`
- Fixtures in `__tests__/__fixtures__/`
- Integration tests require Docker and use precalculated wallets
- Coverage thresholds enforced: 48% lines, 40% branches globally
- Critical wallet class has higher thresholds (90%+)

## Configuration

- `config.ts`: Network configuration (mainnet, testnet)
- Environment-specific settings via `config` object
- Constants in `constants.ts`: decimal places, gap limit, BIP44 code, etc.

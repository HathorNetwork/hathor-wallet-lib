/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  IStorage,
  IHistoryTx,
  IAddressInfo,
  IAddressMetadata,
  OutputValueType,
  IUtxo,
} from '../types';
import Transaction from '../models/transaction';
import Input from '../models/input';
import HathorWalletServiceWallet from './wallet';
import { FullNodeTxResponse } from './types';
import transactionUtils from '../utils/transaction';
import tokensUtils from '../utils/tokens';
import { JSONBigInt } from '../utils/bigint';
import { TOKEN_MELT_MASK, CREATE_TOKEN_TX_VERSION } from '../constants';

/**
 * Storage proxy that implements missing storage methods for wallet service
 * by delegating to wallet service API calls.
 *
 * This proxy enables nano contract transaction signing by providing:
 * - getAddressInfo: Maps addresses to BIP32 indices
 * - getTx: Fetches transaction data from full node API
 * - getTxSignatures: Delegates to transaction signing utilities
 * - getCurrentAddress: Gets current address from wallet service
 * - getTokenDepositPercentage: Returns token deposit percentage for mint transactions
 * - getChangeAddress: Gets change address for transactions
 * - isTokenRegistered: Checks if token is registered in wallet
 * - getRegisteredTokens: Returns all registered tokens as async generator
 * - config.getNetwork: Returns wallet network object for address validation
 */
export class WalletServiceStorageProxy {
  private wallet: HathorWalletServiceWallet;

  private originalStorage: IStorage;

  constructor(wallet: HathorWalletServiceWallet, originalStorage: IStorage) {
    this.wallet = wallet;
    this.originalStorage = originalStorage;
  }

  /**
   * Creates a proxy that wraps the original storage with additional methods
   * needed for nano contract transaction signing.
   */
  createProxy(): IStorage {
    return new Proxy(this.originalStorage, {
      get: this.proxyHandler.bind(this),
    });
  }

  /**
   * Get the wallet-service compatible UTXO selection algorithm
   * This can be passed to token utilities that accept custom UTXO selection
   */
  getUtxoSelectionAlgorithm() {
    return this.walletServiceUtxoSelection.bind(this);
  }

  /**
   * Wallet-service compatible version of prepareCreateTokenData
   * This uses our custom UTXO selection algorithm instead of the default bestUtxoSelection
   */
  async prepareCreateTokenData(
    address: string,
    name: string,
    symbol: string,
    mintAmount: OutputValueType,
    storage: IStorage,
    options: {
      changeAddress?: string | null;
      createMint?: boolean;
      mintAuthorityAddress?: string | null;
      createMelt?: boolean;
      meltAuthorityAddress?: string | null;
      data?: string[] | null;
      isCreateNFT?: boolean;
      skipDepositFee?: boolean;
    } = {}
  ) {
    // Use the original prepareCreateTokenData but with custom utxoSelection

    const mintOptions = {
      createAnotherMint: options.createMint ?? true,
      mintAuthorityAddress: options.mintAuthorityAddress,
      changeAddress: options.changeAddress,
      unshiftData: options.isCreateNFT,
      data: options.data,
      skipDepositFee: options.skipDepositFee ?? false,
      utxoSelection: this.walletServiceUtxoSelection.bind(this), // Use wallet-service compatible selection
    };

    const txData = await tokensUtils.prepareMintTxData(address, mintAmount, storage, mintOptions);

    if (options.createMelt !== false) {
      const newAddress = options.meltAuthorityAddress || (await storage.getCurrentAddress());
      
      const meltAuthorityOutput = {
        type: 'melt',
        address: newAddress,
        value: TOKEN_MELT_MASK,
        timelock: null,
        authorities: 2n,
      } as const;
      
      if (
        options.data !== null &&
        options.data &&
        options.data.length !== 0 &&
        !options.isCreateNFT
      ) {
        txData.outputs.splice(-options.data.length, 0, meltAuthorityOutput);
      } else {
        txData.outputs.push(meltAuthorityOutput);
      }
    }

    // Set create token tx version value and metadata (matching original implementation)
    txData.version = CREATE_TOKEN_TX_VERSION;
    txData.name = name;
    txData.symbol = symbol;
    
    return txData;
  }

  /**
   * Proxy handler that intercepts property access on the storage object.
   *
   * @param target - The original IStorage object being proxied
   * @param prop - The property name being accessed (can be string or Symbol for JS property keys)
   * @param receiver - The proxy itself (not the target), used to maintain correct 'this' context
   * @returns The intercepted method or the original property value
   */
  private proxyHandler(target: IStorage, prop: string | symbol, receiver: IStorage): unknown {
    if (prop === 'getAddressInfo') {
      return this.getAddressInfo.bind(this);
    }

    if (prop === 'getTxSignatures') {
      return this.getTxSignatures.bind(this, receiver);
    }

    if (prop === 'getTx') {
      return this.getTx.bind(this);
    }

    if (prop === 'getSpentTxs') {
      return this.getSpentTxs.bind(this);
    }

    if (prop === 'getCurrentAddress') {
      return this.getCurrentAddress.bind(this);
    }

    if (prop === 'getChangeAddress') {
      return this.getChangeAddress.bind(this);
    }

    if (prop === 'config') {
      return {
        getNetwork: () => this.wallet.getNetworkObject(),
      };
    }

    // For all other properties, use the original behavior
    const value = Reflect.get(target, prop, receiver);

    // Bind methods to maintain correct 'this' context
    if (typeof value === 'function') {
      return value.bind(target);
    }

    return value;
  }

  /**
   * Get address information including BIP32 index
   */
  private async getAddressInfo(
    address: string
  ): Promise<(IAddressInfo & IAddressMetadata & { seqnum: number }) | null> {
    const addressDetails = await this.wallet.getAddressDetails(address);

    if (!addressDetails) {
      return null;
    }

    return {
      bip32AddressIndex: addressDetails.index,
      base58: addressDetails.address,
      seqnum: addressDetails.seqnum,
      numTransactions: addressDetails.transactions,
      // TODO: This balance is not used by any of the nano contract methods
      // but in order to be 100% compatible with the old facade method, we need
      // to implement an API to fetch the balance for all tokens given an address
      balance: new Map(),
    };
  }

  /**
   * Get transaction signatures using the transaction utility
   */
  // eslint-disable-next-line class-methods-use-this
  private async getTxSignatures(receiver: IStorage, tx: Transaction, pinCode: string) {
    const result = await transactionUtils.getSignatureForTx(tx, receiver, pinCode);
    return result;
  }

  /**
   * Get spent transactions for input signing
   * This is an async generator that yields transaction data for each input
   */
  private async *getSpentTxs(inputs: Input[]) {
    // Cache to avoid fetching the same transaction multiple times
    const txCache = new Map<string, IHistoryTx | null>();

    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index];

      // Check if we've already fetched this transaction
      let tx = txCache.get(input.hash);
      if (tx === undefined) {
        // Not in cache, fetch it
        tx = await this.getTx(input.hash);
        txCache.set(input.hash, tx);
      }

      if (tx) {
        yield { tx, input, index };
      }
    }
  }

  /**
   * Get transaction data by fetching from full node and converting format
   */
  private async getTx(txId: string) {
    try {
      const fullTxResponse = await this.wallet.getFullTxById(txId);
      const result = this.convertFullNodeToHistoryTx(fullTxResponse);
      return result;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get current address from wallet service
   * Uses the wallet's getCurrentAddress method which fetches from the API
   */
  private async getCurrentAddress(markAsUsed?: boolean): Promise<string> {
    try {
      const currentAddress = await this.wallet.getCurrentAddress({ markAsUsed });

      return currentAddress.address; // Return just the address string for utils compatibility
    } catch (error) {
      throw new Error('Current address is not loaded');
    }
  }

  /**
   * Convert FullNodeTxResponse to IHistoryTx format
   * This bridges the gap between full node API format and wallet storage format
   */
  // eslint-disable-next-line class-methods-use-this
  private convertFullNodeToHistoryTx(fullTxResponse: FullNodeTxResponse): IHistoryTx {
    const { tx, meta } = fullTxResponse;

    return {
      tx_id: tx.hash,
      signalBits: 0, // Default value since fullnode tx doesn't include signal bits
      version: tx.version,
      weight: tx.weight,
      timestamp: tx.timestamp,
      is_voided: meta.voided_by.length > 0,
      nonce: Number.parseInt(tx.nonce ?? '0', 10),
      inputs: tx.inputs.map(input => ({
        ...input,
        decoded: {
          ...input.decoded,
          type: input.decoded.type ?? undefined,
        },
      })) as IHistoryTx['inputs'],
      outputs: tx.outputs.map(output => ({
        ...output,
        decoded: {
          ...output.decoded,
          type: output.decoded.type ?? undefined,
        },
      })) as IHistoryTx['outputs'],
      parents: tx.parents,
      tokens: tx.tokens.map(token => token.uid),
      height: meta.height,
      first_block: meta.first_block,
      token_name: tx.token_name ?? undefined,
      token_symbol: tx.token_symbol ?? undefined,
    };
  }

  /**
   * Get change address for transactions
   * If specific change address provided, use it; otherwise get a new address from wallet
   */
  private async getChangeAddress(options: { changeAddress?: string | null } = {}): Promise<string> {
    if (options.changeAddress && typeof options.changeAddress === 'string' && options.changeAddress.trim() !== '') {
      try {
        if (!(await this.wallet.isAddressMine(options.changeAddress))) {
          throw new Error('Change address is not from the wallet');
        }
        return options.changeAddress;
      } catch (error) {
        // If there's an error checking the address, fall back to getting a new address
        console.warn('Error checking if address is mine:', error);
        // Fall through to get a new address
      }
    }

    // Get a new address from the wallet for change
    const currentAddr = await this.wallet.getCurrentAddress({ markAsUsed: true });
    return currentAddr.address;
  }

  /**
   * Wallet-service compatible UTXO selection algorithm
   * This replaces bestUtxoSelection which requires storage.selectUtxos
   */
  private async walletServiceUtxoSelection(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    storage: IStorage, // Not used, we use wallet directly  
    token: string,
    amount: bigint
  ) {
    const { utxos } = await this.wallet.getUtxosForAmount(amount, {
      tokenId: token,
    });

    // Convert wallet service Utxo to IUtxo format
    const convertedUtxos: IUtxo[] = utxos.map(utxo => ({
      txId: utxo.txId,
      index: utxo.index,
      token: utxo.tokenId, // Convert tokenId to token
      address: utxo.address,
      value: utxo.value,
      authorities: utxo.authorities,
      timelock: utxo.timelock,
      type: 1, // Default tx version for UTXOs (not critical for UTXO selection)
      height: null, // Height not available from wallet service UTXO, but not critical for selection
    }));

    const totalAmount = convertedUtxos.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);

    return {
      utxos: convertedUtxos,
      amount: totalAmount,
      available: totalAmount,
    };
  }
}

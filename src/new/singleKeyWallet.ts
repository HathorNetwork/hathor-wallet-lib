/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import bitcore from 'bitcore-lib';
import { AddressError } from '../errors';
import { SCANNING_POLICY, WalletAddressMode } from '../types';
import { signMessage } from '../utils/crypto';
import HathorWallet from './wallet';
import { SingleKeyWalletConstructorParams } from './types';

/**
 * A single-key wallet backed by a raw secp256k1 private key (no BIP32 HD tree).
 *
 * Intended for Web3Auth / social-login onboarding where the auth provider
 * returns a single private key with no chain code. The wallet has exactly one
 * address and delegates transaction signing to an external signer callback
 * registered via {@link setExternalTxSigningMethod}.
 *
 * Extends {@link HathorWallet} and overrides HD-specific methods that are
 * meaningless or dangerous for single-key wallets.
 */
class SingleKeyWallet extends HathorWallet {
  constructor({
    connection,
    storage,
    privateKey,
    publicKey,
    address,
    tokenUid,
    pinCode,
    password = null,
    debug = false,
    beforeReloadCallback = null,
    logger = null,
  }: SingleKeyWalletConstructorParams) {
    super({
      connection,
      storage,
      privateKey,
      publicKey,
      preCalculatedAddresses: [address],
      scanPolicy: { policy: SCANNING_POLICY.SINGLE_ADDRESS },
      tokenUid,
      pinCode,
      password,
      debug,
      beforeReloadCallback,
      logger,
    });
  }

  // ---------------------------------------------------------------------------
  // Task 2: Unsupported HD / multisig methods — always throw
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line class-methods-use-this
  async setGapLimit(_value: number): Promise<void> {
    throw new Error('setGapLimit is not supported for single-key wallets.');
  }

  // eslint-disable-next-line class-methods-use-this
  async indexLimitLoadMore(_count: number): Promise<number> {
    throw new Error('indexLimitLoadMore is not supported for single-key wallets.');
  }

  // eslint-disable-next-line class-methods-use-this
  async indexLimitSetEndIndex(_endIndex: number): Promise<void> {
    throw new Error('indexLimitSetEndIndex is not supported for single-key wallets.');
  }

  // eslint-disable-next-line class-methods-use-this
  async enableMultiAddressMode(): Promise<void> {
    throw new Error('enableMultiAddressMode is not supported for single-key wallets.');
  }

  // eslint-disable-next-line class-methods-use-this
  async getMultisigData(): Promise<never> {
    throw new Error('getMultisigData is not supported for single-key wallets.');
  }

  // eslint-disable-next-line class-methods-use-this
  async getAllSignatures(_txHex: string, _pin: string): Promise<never> {
    throw new Error('getAllSignatures is not supported for single-key wallets.');
  }

  // eslint-disable-next-line class-methods-use-this
  async assemblePartialTransaction(_txHex: string, _signatures: string[]): Promise<never> {
    throw new Error('assemblePartialTransaction is not supported for single-key wallets.');
  }

  // ---------------------------------------------------------------------------
  // Task 3: Single-key behavior overrides
  // ---------------------------------------------------------------------------

  async getNextAddress(): Promise<{ address: string; index: number | null; addressPath: string }> {
    return this.getCurrentAddress();
  }

  async getAddressAtIndex(index: number): Promise<string> {
    if (index !== 0) {
      throw new AddressError('Single-key wallets only support address index 0.');
    }
    return super.getAddressAtIndex(0);
  }

  async getCurrentAddress(_options?: {
    markAsUsed?: boolean;
  }): Promise<{ address: string; index: number | null; addressPath: string }> {
    const address = await super.getAddressAtIndex(0);
    return { address, index: 0, addressPath: '' };
  }

  // eslint-disable-next-line class-methods-use-this
  async getAddressPathForIndex(index: number): Promise<string> {
    if (index !== 0) {
      throw new AddressError('Single-key wallets only support address index 0.');
    }
    return '';
  }

  // eslint-disable-next-line class-methods-use-this
  async getAddressMode(): Promise<WalletAddressMode> {
    return WalletAddressMode.SINGLE;
  }

  // eslint-disable-next-line class-methods-use-this
  async hasTxOutsideFirstAddress(): Promise<boolean> {
    return false;
  }

  // eslint-disable-next-line class-methods-use-this
  async enableSingleAddressMode(): Promise<void> {
    // Already in single-address mode by construction — no-op.
  }

  clearSensitiveData(): void {
    super.clearSensitiveData();
    this.privateKey = undefined;
  }

  // ---------------------------------------------------------------------------
  // Task 4: Key derivation overrides
  // ---------------------------------------------------------------------------

  async getAddressPrivKey(pinCode: string, addressIndex: number): Promise<unknown> {
    if (addressIndex !== 0) {
      throw new AddressError('Single-key wallets only support address index 0.');
    }
    const rawPrivHex = await this.storage.getSingleKeyPrivateKey(pinCode);
    return new bitcore.PrivateKey(rawPrivHex);
  }

  async getPrivateKeyFromAddress(
    address: string,
    options?: { pinCode?: string | null }
  ): Promise<unknown> {
    const pin = options?.pinCode ?? this.pinCode;
    if (!pin) {
      throw new Error('Pin is required.');
    }

    const addrInfo = await this.storage.getAddressInfo(address);
    if (!addrInfo) {
      throw new AddressError('Address does not belong to the wallet.');
    }
    if (addrInfo.bip32AddressIndex !== 0) {
      throw new AddressError('Single-key wallets only support address index 0.');
    }

    const rawPrivHex = await this.storage.getSingleKeyPrivateKey(pin);
    return new bitcore.PrivateKey(rawPrivHex);
  }

  async signMessageWithAddress(message: string, index: number, pinCode: string): Promise<string> {
    const key = await this.getAddressPrivKey(pinCode, index);
    return signMessage(message, key as bitcore.PrivateKey);
  }
}

export default SingleKeyWallet;

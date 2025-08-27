/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import NanoContractTransactionBuilder from '../nano_contracts/builder';
import { WalletServiceStorageProxy } from './walletServiceStorageProxy';
import HathorWalletServiceWallet from './wallet';

/**
 * Extended nano contract builder that uses wallet-service compatible token creation
 * This builder replaces the token creation logic to use custom UTXO selection
 * that works with wallet-service instead of requiring storage.selectUtxos()
 */
export class WalletServiceNanoContractBuilder extends NanoContractTransactionBuilder {
  private storageProxy?: WalletServiceStorageProxy;

  /**
   * Override the build method to use wallet-service compatible logic
   */
  async build() {
    if (!this.wallet) {
      throw new Error('Wallet must be set before building transaction');
    }

    // Create storage proxy for wallet-service compatibility
    this.storageProxy = new WalletServiceStorageProxy(
      this.wallet as HathorWalletServiceWallet,
      this.wallet.storage
    );

    if (this.createTokenOptions) {
      return this.buildTokenCreationWithWalletService();
    }

    return super.build();
  }

  /**
   * Build token creation transaction using wallet-service compatible methods
   */
  private async buildTokenCreationWithWalletService() {
    const { inputs, outputs, tokens } = await this.buildInputsOutputs();
    const transaction = await this.buildTransactionWithWalletService(inputs, outputs, tokens);
    return transaction;
  }

  /**
   * Build transaction with wallet-service support
   * This mimics the original buildTransaction but uses our storage proxy
   */
  private async buildTransactionWithWalletService(inputs: any[], outputs: any[], tokens: string[]) {
    if (this.createTokenOptions === null) {
      throw new Error(
        'Create token options cannot be null when creating a create token transaction.'
      );
    }

    // Use our custom prepareCreateTokenData with wallet-service UTXO selection
    const data = await this.storageProxy!.prepareCreateTokenData(
      this.createTokenOptions.mintAddress,
      this.createTokenOptions.name,
      this.createTokenOptions.symbol,
      this.createTokenOptions.amount,
      this.wallet!.storage,
      {
        changeAddress: this.createTokenOptions.changeAddress,
        createMint: this.createTokenOptions.createMint,
        mintAuthorityAddress: this.createTokenOptions.mintAuthorityAddress,
        createMelt: this.createTokenOptions.createMelt,
        meltAuthorityAddress: this.createTokenOptions.meltAuthorityAddress,
        data: this.createTokenOptions.data,
        isCreateNFT: this.createTokenOptions.isCreateNFT,
        skipDepositFee:
          this.createTokenOptions.contractPaysTokenDeposit || this.tokenFeeAddedInDeposit,
      }
    );

    // Concatenate nano actions with token creation data (matching original)
    data.inputs = data.inputs.concat(inputs);
    data.outputs = data.outputs.concat(outputs);
    data.tokens = Array.from(new Set([...data.tokens, ...tokens]));

    // Import transactionUtils dynamically to avoid circular imports
    const transactionUtils = await import('../utils/transaction');

    return transactionUtils.default.createTransactionFromData(
      data,
      this.wallet!.getNetworkObject()
    );
  }
}

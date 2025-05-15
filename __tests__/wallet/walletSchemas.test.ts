import {
  addressesResponseSchema,
  checkAddressesMineResponseSchema,
  newAddressesResponseSchema,
  tokenDetailsResponseSchema,
  balanceResponseSchema,
  txProposalCreateResponseSchema,
  txProposalUpdateResponseSchema,
  fullNodeVersionDataSchema,
  fullNodeTxResponseSchema,
  fullNodeTxConfirmationDataResponseSchema,
  walletStatusResponseSchema,
  tokensResponseSchema,
  historyResponseSchema,
  txOutputResponseSchema,
  authTokenResponseSchema,
  txByIdResponseSchema,
  wsTransactionSchema,
} from '../../src/wallet/api/schemas/walletApi';

// Test variables
const addr1 = 'HNJ6craHLHMyqE1eXvwmxbR1LruHCKqLqR';
const addr2 = 'HNJ6craHLHMyqE1eXvwmxbR1LruHCKqLqS';
const path1 = "m/44'/280'/0'/0/0";
const path2 = "m/44'/280'/0'/0/1";
const info1 = 'info1';
const token1 = '0000034e42c9f2a7a7ab720e2f34bc6767d0198bfdba9334fe61f033b6c3ec16';
const tx1 = '0000034e42c9f2a7a7ab720e2f34bc6767d0198bfdba9334fe61f033b6c3ec17';
const wallet1 = 'wallet1';
const xpub1 = 'xpub1';
const proposal1 = 'proposal1';

describe('Wallet API Schemas', () => {
  describe('addressesResponseSchema', () => {
    it('should validate valid addresses response', () => {
      const validData = {
        success: true,
        addresses: [
          { address: addr1, index: 0, transactions: 5 },
          { address: addr2, index: 1, transactions: 3 },
        ],
      };
      expect(() => addressesResponseSchema.parse(validData)).not.toThrow();
    });

    it('should reject invalid addresses response', () => {
      const invalidData = {
        success: true,
        addresses: [
          { address: addr1, index: '0', transactions: 5 }, // index should be number
        ],
      };
      expect(() => addressesResponseSchema.parse(invalidData)).toThrow();
    });
  });

  describe('checkAddressesMineResponseSchema', () => {
    it('should validate valid check addresses mine response', () => {
      const validData = {
        success: true,
        addresses: {
          [addr1]: true,
          [addr2]: false,
        },
      };
      expect(() => checkAddressesMineResponseSchema.parse(validData)).not.toThrow();
    });

    it('should reject invalid check addresses mine response', () => {
      const invalidData = {
        success: true,
        addresses: {
          [addr1]: 'true', // should be boolean
        },
      };
      expect(() => checkAddressesMineResponseSchema.parse(invalidData)).toThrow();
    });
  });

  describe('newAddressesResponseSchema', () => {
    it('should validate valid new addresses response', () => {
      const validData = {
        success: true,
        addresses: [
          { address: addr1, index: 0, addressPath: path1, info: info1 },
          { address: addr2, index: 1, addressPath: path2 },
        ],
      };
      expect(() => newAddressesResponseSchema.parse(validData)).not.toThrow();
    });

    it('should reject invalid new addresses response', () => {
      const invalidData = {
        success: true,
        addresses: [
          { address: addr1, index: '0', addressPath: path1 }, // index should be number
        ],
      };
      expect(() => newAddressesResponseSchema.parse(invalidData)).toThrow();
    });

    it('should validate various valid BIP44 paths', () => {
      const validPaths = [
        "m/44'/280'/0'/0/0", // Standard path
        "m/44'/280'/0'/0/1", // Different index
        "m/44'/280'/0'/0/999", // Large index
        "m/44'/280'/1'/0/0", // Different account
        "m/44'/280'/0'/1/0", // Different change
      ];

      for (const path of validPaths) {
        const data = {
          success: true,
          addresses: [{ address: addr1, index: 0, addressPath: path }],
        };
        expect(() => newAddressesResponseSchema.parse(data)).not.toThrow();
      }
    });

    it('should reject various invalid BIP44 paths', () => {
      const invalidPaths = [
        "n/44'/280'/0'/0/0", // Wrong starting letter
        "/44'/280'/0'/0/0", // Missing 'm'
        "m44'/280'/0'/0/0", // Missing first slash
        "m//44'/280'/0'/0/0", // Double slash
        "m/44'/280'/0'/0/a", // Non-numeric character
        "m/44'/280'/0'/0/0/", // Trailing slash
        "m/44'/280'/0'/0/0//", // Double trailing slash
        "m/44'/280'/0'/0/0x", // Hex number
        "m/44'/280'/0'/0/ ", // Space in path
        " m/44'/280'/0'/0/0", // Leading space
        "m/44'/280'/0'/0/0 ", // Trailing space
        "m/44'/280'/0'/0/'", // Quote without number
        "m/44'/280'/0'/0/''", // Double quote
      ];

      for (const path of invalidPaths) {
        const data = {
          success: true,
          addresses: [{ address: addr1, index: 0, addressPath: path }],
        };
        expect(() => newAddressesResponseSchema.parse(data)).toThrow();
      }
    });

    it('should validate multiple addresses with different paths', () => {
      const data = {
        success: true,
        addresses: [
          { address: addr1, index: 0, addressPath: "m/44'/280'/0'/0/0" },
          { address: addr2, index: 1, addressPath: "m/44'/280'/0'/0/1" },
          { address: addr1, index: 2, addressPath: "m/44'/280'/1'/0/0" },
          { address: addr2, index: 3, addressPath: "m/44'/280'/0'/1/0" },
        ],
      };
      expect(() => newAddressesResponseSchema.parse(data)).not.toThrow();
    });
  });

  describe('tokenDetailsResponseSchema', () => {
    it('should validate valid token details response', () => {
      const validData = {
        success: true,
        details: {
          tokenInfo: {
            id: token1,
            name: 'Token 1',
            symbol: 'T1',
          },
          totalSupply: '1000',
          totalTransactions: 5,
          authorities: {
            mint: true,
            melt: false,
          },
        },
      };
      expect(() => tokenDetailsResponseSchema.parse(validData)).not.toThrow();
    });

    it('should reject invalid token details response', () => {
      const invalidData = {
        success: true,
        details: {
          tokenInfo: {
            id: token1,
            name: 'Token 1',
            symbol: 'T1',
          },
          totalSupply: 'invalid', // should be a valid number string
          totalTransactions: 5,
          authorities: {
            mint: true,
            melt: false,
          },
        },
      };
      expect(() => tokenDetailsResponseSchema.parse(invalidData)).toThrow();
    });
  });

  describe('balanceResponseSchema', () => {
    it('should validate valid balance response', () => {
      const validData = {
        success: true,
        balances: [
          {
            token: {
              id: token1,
              name: 'Token 1',
              symbol: 'T1',
            },
            balance: {
              unlocked: '100',
              locked: '50',
            },
            tokenAuthorities: {
              unlocked: {
                mint: true,
                melt: false,
              },
              locked: {
                mint: false,
                melt: true,
              },
            },
            transactions: 5,
            lockExpires: null,
          },
        ],
      };
      expect(() => balanceResponseSchema.parse(validData)).not.toThrow();
    });

    it('should reject invalid balance response', () => {
      const invalidData = {
        success: true,
        balances: [
          {
            token: {
              id: token1,
              name: 'Token 1',
              symbol: 'T1',
            },
            balance: true, // should be a number or number string
            tokenAuthorities: {
              unlocked: {
                mint: true,
                melt: false,
              },
              locked: {
                mint: false,
                melt: true,
              },
            },
            transactions: 5,
            lockExpires: null,
          },
        ],
      };
      expect(() => balanceResponseSchema.parse(invalidData)).toThrow();
    });
  });

  describe('txProposalCreateResponseSchema', () => {
    it('should validate valid tx proposal create response', () => {
      const validData = {
        success: true,
        txProposalId: proposal1,
        inputs: [{ txId: tx1, index: 0, addressPath: path1 }],
      };
      expect(() => txProposalCreateResponseSchema.parse(validData)).not.toThrow();
    });

    it('should reject invalid tx proposal create response', () => {
      const invalidData = {
        success: true,
        txProposalId: proposal1,
        inputs: [
          { txId: tx1, index: '0', addressPath: path1 }, // index should be number
        ],
      };
      expect(() => txProposalCreateResponseSchema.parse(invalidData)).toThrow();
    });
  });

  describe('txProposalUpdateResponseSchema', () => {
    it('should validate valid tx proposal update response', () => {
      const validData = {
        success: true,
        txProposalId: proposal1,
        txHex: '0x1234',
      };
      expect(() => txProposalUpdateResponseSchema.parse(validData)).not.toThrow();
    });

    it('should reject invalid tx proposal update response', () => {
      const invalidData = {
        success: true,
        txProposalId: proposal1,
        txHex: 1234, // should be string
      };
      expect(() => txProposalUpdateResponseSchema.parse(invalidData)).toThrow();
    });
  });

  describe('fullNodeVersionDataSchema', () => {
    it('should validate valid full node version data', () => {
      const validData = {
        timestamp: 1234567890,
        version: '1.0.0',
        network: 'mainnet',
        minWeight: 1,
        minTxWeight: 1,
        minTxWeightCoefficient: 1,
        minTxWeightK: 1,
        tokenDepositPercentage: 1,
        rewardSpendMinBlocks: 1,
        maxNumberInputs: 1,
        maxNumberOutputs: 1,
      };
      expect(() => fullNodeVersionDataSchema.parse(validData)).not.toThrow();
    });

    it('should allow additional fields due to passthrough', () => {
      const validDataWithExtra = {
        timestamp: 1234567890,
        version: '1.0.0',
        network: 'mainnet',
        minWeight: 1,
        minTxWeight: 1,
        minTxWeightCoefficient: 1,
        minTxWeightK: 1,
        tokenDepositPercentage: 1,
        rewardSpendMinBlocks: 1,
        maxNumberInputs: 1,
        maxNumberOutputs: 1,
        // Additional fields that should be allowed
        newFeatureFlag: true,
        customSetting: 'value',
        extraNumber: 42,
        complexObject: {
          nested: true,
          data: [1, 2, 3],
        },
      };
      expect(() => fullNodeVersionDataSchema.parse(validDataWithExtra)).not.toThrow();
    });

    it('should reject invalid full node version data', () => {
      const invalidData = {
        timestamp: '1234567890', // should be number
        version: '1.0.0',
        network: 'mainnet',
        minWeight: 1,
        minTxWeight: 1,
        minTxWeightCoefficient: 1,
        minTxWeightK: 1,
        tokenDepositPercentage: 1,
        rewardSpendMinBlocks: 1,
        maxNumberInputs: 1,
        maxNumberOutputs: 1,
      };
      expect(() => fullNodeVersionDataSchema.parse(invalidData)).toThrow();
    });
  });

  describe('fullNodeTxResponseSchema', () => {
    it('should validate valid full node tx response', () => {
      const validData = {
        success: true,
        tx: {
          hash: tx1,
          nonce: '1',
          timestamp: 1234567890,
          version: 1,
          weight: 1,
          parents: ['parent1'],
          inputs: [
            {
              value: '100',
              token_data: 0,
              script: 'script1',
              decoded: {
                type: 'p2pkh',
                address: addr1,
                timelock: null,
                value: '100',
                token_data: 0,
              },
              tx_id: tx1,
              index: 0,
              token: token1,
              spent_by: null,
            },
          ],
          outputs: [
            {
              value: '100',
              token_data: 0,
              script: 'script1',
              decoded: {
                type: 'p2pkh',
                address: addr1,
                timelock: null,
                value: '100',
                token_data: 0,
              },
              token: token1,
              spent_by: null,
              address: addr1,
              authorities: '0',
              timelock: null,
            },
          ],
          tokens: [
            {
              uid: token1,
              name: 'Token 1',
              symbol: 'T1',
              amount: '1000',
            },
          ],
          token_name: 'Token 1',
          token_symbol: 'T1',
          raw: 'raw1',
        },
        meta: {
          hash: tx1,
          spent_outputs: [[0, ['tx2']]],
          received_by: ['peer1'],
          children: ['tx2'],
          conflict_with: [],
          voided_by: [],
          twins: [],
          accumulated_weight: 1,
          score: 1,
          height: 1,
          validation: 'valid',
          first_block: 'block1',
          first_block_height: 1,
          received_timestamp: 1234567890,
          is_voided: false,
          verification_status: 'valid',
        },
      };
      expect(() => fullNodeTxResponseSchema.parse(validData)).not.toThrow();
    });

    it('should reject invalid full node tx response', () => {
      const invalidData = {
        success: true,
        tx: {
          hash: tx1,
          nonce: '1',
          timestamp: '1234567890', // should be number
          version: 1,
          weight: 1,
          parents: ['parent1'],
          inputs: [],
          outputs: [],
          tokens: [],
          raw: 'raw1',
        },
        meta: {
          hash: tx1,
          spent_outputs: [[0, ['tx2']]],
          received_by: ['peer1'],
          children: ['tx2'],
          conflict_with: [],
          voided_by: [],
          twins: [],
          accumulated_weight: 1,
          score: 1,
          height: 1,
        },
      };
      expect(() => fullNodeTxResponseSchema.parse(invalidData)).toThrow();
    });
  });

  describe('fullNodeTxConfirmationDataResponseSchema', () => {
    it('should validate valid full node tx confirmation data response', () => {
      const validData = {
        success: true,
        accumulated_weight: 1,
        accumulated_bigger: true,
        stop_value: 1,
        confirmation_level: 1,
      };
      expect(() => fullNodeTxConfirmationDataResponseSchema.parse(validData)).not.toThrow();
    });

    it('should reject invalid full node tx confirmation data response', () => {
      const invalidData = {
        success: true,
        accumulated_weight: '1', // should be number
        accumulated_bigger: true,
        stop_value: 1,
        confirmation_level: 1,
      };
      expect(() => fullNodeTxConfirmationDataResponseSchema.parse(invalidData)).toThrow();
    });
  });

  describe('walletStatusResponseSchema', () => {
    it('should validate valid wallet status response', () => {
      const validData = {
        success: true,
        status: {
          walletId: wallet1,
          xpubkey: xpub1,
          status: 'ready',
          maxGap: 1,
          createdAt: 1234567890,
          readyAt: 1234567891,
        },
        error: 'error1',
      };
      expect(() => walletStatusResponseSchema.parse(validData)).not.toThrow();
    });

    it('should reject invalid wallet status response', () => {
      const invalidData = {
        success: true,
        status: {
          walletId: wallet1,
          xpubkey: xpub1,
          status: 'ready',
          maxGap: '1', // should be number
          createdAt: 1234567890,
          readyAt: 1234567891,
        },
      };
      expect(() => walletStatusResponseSchema.parse(invalidData)).toThrow();
    });
  });

  describe('tokensResponseSchema', () => {
    it('should validate valid tokens response', () => {
      const validData = {
        success: true,
        tokens: ['token1', 'token2'],
      };
      expect(() => tokensResponseSchema.parse(validData)).not.toThrow();
    });

    it('should reject invalid tokens response', () => {
      const invalidData = {
        success: true,
        tokens: [1, 'token2'], // should be strings
      };
      expect(() => tokensResponseSchema.parse(invalidData)).toThrow();
    });
  });

  describe('historyResponseSchema', () => {
    it('should validate valid history response', () => {
      const validData = {
        success: true,
        history: [
          {
            txId: tx1,
            balance: '100',
            timestamp: 1234567890,
            voided: 0,
            version: 1,
          },
        ],
      };
      expect(() => historyResponseSchema.parse(validData)).not.toThrow();
    });

    it('should reject invalid history response', () => {
      const invalidData = {
        success: true,
        history: [
          {
            txId: tx1,
            balance: 'invalid', // should be a valid number string
            timestamp: 1234567890,
            voided: 0,
            version: 1,
          },
        ],
      };
      expect(() => historyResponseSchema.parse(invalidData)).toThrow();
    });
  });

  describe('txOutputResponseSchema', () => {
    it('should validate valid tx output response', () => {
      const validData = {
        success: true,
        txOutputs: [
          {
            txId: tx1,
            index: 0,
            tokenId: token1,
            address: addr1,
            value: '100',
            authorities: '0',
            timelock: null,
            heightlock: null,
            locked: false,
            addressPath: path1,
          },
        ],
      };
      expect(() => txOutputResponseSchema.parse(validData)).not.toThrow();
    });

    it('should reject invalid tx output response', () => {
      const invalidData = {
        success: true,
        txOutputs: [
          {
            txId: tx1,
            index: '0', // should be number
            tokenId: token1,
            address: addr1,
            value: '100',
            authorities: '0',
            timelock: null,
            heightlock: null,
            locked: false,
            addressPath: path1,
          },
        ],
      };
      expect(() => txOutputResponseSchema.parse(invalidData)).toThrow();
    });
  });

  describe('authTokenResponseSchema', () => {
    it('should validate valid JWT token response', () => {
      const validData = {
        success: true,
        token:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      };
      expect(() => authTokenResponseSchema.parse(validData)).not.toThrow();
    });

    it('should reject invalid JWT token response', () => {
      const invalidData = {
        success: true,
        token: 'invalid.token', // Not a valid JWT format
      };
      expect(() => authTokenResponseSchema.parse(invalidData)).toThrow('Invalid JWT token format');
    });

    it('should reject response without token', () => {
      const invalidData = {
        success: true,
      };
      expect(() => authTokenResponseSchema.parse(invalidData)).toThrow();
    });

    it('should reject response with non-string token', () => {
      const invalidData = {
        success: true,
        token: 12345, // Token should be a string
      };
      expect(() => authTokenResponseSchema.parse(invalidData)).toThrow();
    });
  });

  describe('txByIdResponseSchema', () => {
    it('should validate valid tx by id response with height present', () => {
      const validData = {
        success: true,
        txTokens: [
          {
            txId: tx1,
            timestamp: 1234567890,
            version: 1,
            voided: false,
            height: 1, // height is present and a number
            weight: 1,
            balance: 100n,
            tokenId: token1,
            tokenName: 'Token 1',
            tokenSymbol: 'T1',
          },
        ],
      };
      expect(() => txByIdResponseSchema.parse(validData)).not.toThrow();
    });

    it('should validate valid tx by id response with height null', () => {
      const validData = {
        success: true,
        txTokens: [
          {
            txId: tx1,
            timestamp: 1234567890,
            version: 1,
            voided: false,
            height: null, // height is present and null
            weight: 1,
            balance: 100n,
            tokenId: token1,
            tokenName: 'Token 1',
            tokenSymbol: 'T1',
          },
        ],
      };
      expect(() => txByIdResponseSchema.parse(validData)).not.toThrow();
    });

    it('should validate valid tx by id response with height omitted', () => {
      const validData = {
        success: true,
        txTokens: [
          {
            txId: tx1,
            timestamp: 1234567890,
            version: 1,
            voided: false,
            // height is omitted (optional)
            weight: 1,
            balance: 100n,
            tokenId: token1,
            tokenName: 'Token 1',
            tokenSymbol: 'T1',
          },
        ],
      };
      expect(() => txByIdResponseSchema.parse(validData)).not.toThrow();
    });

    it('should reject invalid tx by id response with invalid height type', () => {
      const invalidData = {
        success: true,
        txTokens: [
          {
            txId: tx1,
            timestamp: 1234567890,
            version: 1,
            voided: false,
            height: '1', // height should be number or null, not string
            weight: 1,
            balance: 283n,
            tokenId: token1,
            tokenName: 'Token 1',
            tokenSymbol: 'T1',
          },
        ],
      };
      expect(() => txByIdResponseSchema.parse(invalidData)).toThrow();
    });

    it('should reject invalid tx by id response due to other fields', () => {
      // Keep a test for general invalidity unrelated to height
      const invalidData = {
        success: true,
        txTokens: [
          {
            txId: tx1,
            timestamp: '1234567890', // should be number
            version: 1,
            voided: false,
            height: 1,
            weight: 1,
            balance: 283n,
            tokenId: token1,
            walletId: wallet1,
            tokenName: 'Token 1',
            tokenSymbol: 'T1',
          },
        ],
      };
      expect(() => txByIdResponseSchema.parse(invalidData)).toThrow();
    });
  });

  describe('wsTransactionSchema', () => {
    const validWsTxData = {
      tx_id: '00000e0e193894909fc85dad8a778a8e7904de30362f53b4839e93cc315648e6',
      nonce: 16488190,
      timestamp: 1745940424,
      version: 2,
      voided: false,
      weight: 17.43270481128759,
      parents: [
        '000000003a90c27be4093663ef1e1eb1564aa5462f282d86fc062add717b059a',
        '0000762414270482d75b7c759d1b8bc7341a884084004042fb70eafe11a01eb6',
      ],
      inputs: [
        {
          tx_id: '0000762414270482d75b7c759d1b8bc7341a884084004042fb70eafe11a01eb6',
          index: 0,
          value: 1n, // Use BigInt notation
          token_data: 0,
          script: {
            type: 'Buffer',
            data: [
              118, 169, 20, 107, 97, 132, 123, 120, 0, 1, 243, 13, 222, 197, 107, 73, 138, 22, 138,
              241, 2, 209, 72, 136, 172,
            ],
          },
          token: '00',
          decoded: {
            type: 'P2PKH',
            address: 'HGJuWWGgRQ2roCfcmt5MCBJZx3yMYRz8dq',
            timelock: null,
          },
        },
      ],
      outputs: [
        {
          value: 100n, // Use BigInt notation
          token_data: 1,
          script: {
            type: 'Buffer',
            data: [
              118, 169, 20, 69, 227, 122, 171, 130, 223, 106, 158, 121, 173, 64, 26, 133, 156, 27,
              199, 10, 82, 191, 81, 136, 172,
            ],
          },
          decodedScript: null,
          token: '00000e0e193894909fc85dad8a778a8e7904de30362f53b4839e93cc315648e6',
          locked: false,
          index: 0,
          decoded: {
            type: 'P2PKH',
            address: 'HCtfX7Pz98ihXjPKCEugFHduVeuHgSXRcy',
            timelock: null,
          },
        },
      ],
      height: 0,
      token_name: 'Test',
      token_symbol: 'TST',
      signal_bits: 0,
    };

    it('should validate valid websocket transaction', () => {
      expect(() => wsTransactionSchema.parse(validWsTxData)).not.toThrow();
    });

    it('should validate websocket transaction with null height', () => {
      const dataWithNullHeight = {
        ...validWsTxData,
        height: null,
      };
      expect(() => wsTransactionSchema.parse(dataWithNullHeight)).not.toThrow();
    });

    it('should validate websocket transaction with omitted height', () => {
      const { height: _height, ...dataWithoutHeight } = validWsTxData;
      expect(() => wsTransactionSchema.parse(dataWithoutHeight)).not.toThrow();
    });

    it('should reject invalid websocket transaction (bad input structure)', () => {
      const invalidData = {
        ...validWsTxData,
        inputs: [
          {
            // Missing many required fields from wsTxInputSchema
            address: addr1,
            timelock: null,
            type: 'P2PKH',
          },
        ],
      };
      expect(() => wsTransactionSchema.parse(invalidData)).toThrow();
    });

    it('should reject invalid websocket transaction (bad output structure)', () => {
      const invalidData = {
        ...validWsTxData,
        outputs: [
          {
            // Missing many required fields from wsTxOutputSchema
            address: addr2,
            timelock: null,
            type: 'P2PKH',
          },
        ],
      };
      expect(() => wsTransactionSchema.parse(invalidData)).toThrow();
    });

    it('should reject invalid websocket transaction (bad nonce type)', () => {
      const invalidData = {
        ...validWsTxData,
        nonce: '16488190', // Nonce should be number
      };
      expect(() => wsTransactionSchema.parse(invalidData)).toThrow();
    });

    it('should reject invalid websocket transaction (invalid token id in output)', () => {
      const invalidData = {
        ...validWsTxData,
        outputs: [
          {
            ...validWsTxData.outputs[0],
            token: 'invalid-token-id', // Invalid token ID format
          },
        ],
      };
      expect(() => wsTransactionSchema.parse(invalidData)).toThrow();
    });
  });
});

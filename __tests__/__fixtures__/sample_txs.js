export const nftCreationTx = {
  tx_id: '0025a6488045d7466639ead179a7f6beb188320f41cdb6df3a971db2ee86dbc3',
  version: 2,
  weight: 8.000001,
  timestamp: 1656543561,
  is_voided: false,
  inputs: [
    {
      value: 100,
      token_data: 0,
      script: 'dqkUaf+xVJ8uAPML/AzwuSB+2W9/M7qIrA==',
      decoded: {
        type: 'P2PKH',
        address: 'WYLW8ujPemSuLJwbeNvvH6y7nakaJ6cEwT',
        timelock: null,
      },
      token: '00',
      tx_id: '00d749e2ca22edcb231696caaf9df77f489058bd20b6dd26237be24ec918153a',
      index: 1,
    },
  ],
  outputs: [
    {
      value: 1,
      token_data: 0,
      // Decoded script: 5ipfs://QmPCSXNDyPdhU9oQFpxFsNN3nTjg9ZoqESKY5n9Gp1XSJc
      script: 'NWlwZnM6Ly9RbVBDU1hORHlQZGhVOW9RRnB4RnNOTjNuVGpnOVpvcUVTS1k1bjlHcDFYU0pjrA==',
      decoded: {},
      token: '00',
      spent_by: null,
      selected_as_input: false,
    },
    {
      value: 98,
      token_data: 0,
      script: 'dqkUQcQx/3rV1s5VZXqZPc1dkQbPo6eIrA==',
      decoded: {
        type: 'P2PKH',
        address: 'WUfmqHWQZWn7aodAFadwmSDfh2QaUUgCRJ',
        timelock: null,
      },
      token: '00',
      spent_by: null,
      selected_as_input: false,
    },
    {
      value: 1,
      token_data: 1,
      script: 'dqkUQcQx/3rV1s5VZXqZPc1dkQbPo6eIrA==',
      decoded: {
        type: 'P2PKH',
        address: 'WUfmqHWQZWn7aodAFadwmSDfh2QaUUgCRJ',
        timelock: null,
      },
      token: '0025a6488045d7466639ead179a7f6beb188320f41cdb6df3a971db2ee86dbc3',
      spent_by: null,
      selected_as_input: false,
    },
    {
      value: 1,
      token_data: 129,
      script: 'dqkU1YP+t130UoYD+3ys9MYt1zkWeY6IrA==',
      decoded: {
        type: 'P2PKH',
        address: 'Wi8zvxdXHjaUVAoCJf52t3WovTZYcU9aX6',
        timelock: null,
      },
      token: '0025a6488045d7466639ead179a7f6beb188320f41cdb6df3a971db2ee86dbc3',
      spent_by: null,
      selected_as_input: false,
    },
    {
      value: 2,
      token_data: 129,
      script: 'dqkULlcsARvA+pQS8qytBr6Ryjc/SLeIrA==',
      decoded: {
        type: 'P2PKH',
        address: 'WSu4PZVu6cvi3aejtG8w7bomVmg77DtqYt',
        timelock: null,
      },
      token: '0025a6488045d7466639ead179a7f6beb188320f41cdb6df3a971db2ee86dbc3',
      spent_by: null,
      selected_as_input: false,
    },
  ],
  parents: [
    '00d749e2ca22edcb231696caaf9df77f489058bd20b6dd26237be24ec918153a',
    '004829631be87e5835ff7ec3112f1ab28b59fd96b27c67395e3901555b26bd7e',
  ],
  token_name: 'New NFT',
  token_symbol: 'NNFT',
  tokens: [],
};

export const SampleTx = {
  hash: '00002d36afd5826ed6cab8efbc4de3419facfd5fb79afa812f3adaa5ec69eadd',
  version: 1,
  weight: 17.10059579555697,
  timestamp: 1661630043,
  is_voided: false,
  parents: [
    '000005303f099333c036a0f4242ea7f902a16fe9e56c1d9291ebc8d1f4e4a58b',
    '00000e13e779c60dff3685f8017e2e63a819dba2650c87359db5c0300ed06bc1'
  ],
  inputs: [
    {
      value: 10,
      token_data: 0,
      token: '00',
      script: 'dqkUI3QgCrwQsFYF+OZpRkir842xyJaIrA==',
      decoded: {
        type: 'P2PKH',
        address: 'H9kb9aNd5r2UDgjKJVYJ4Jc3DF3L8ve5Pp',
        timelock: null,
      },
      tx_id: '00001070597c712fa0fcf7e289849d88f0fdd2bc9a948404c885f3e21b8eac4a',
      index: 1
    },
    {
      value: 20,
      token_data: 1,
      token: '0025a6488045d7466639ead179a7f6beb188320f41cdb6df3a971db2ee86dbc3',
      script: 'dqkULlcsARvA+pQS8qytBr6Ryjc/SLeIrA==',
      decoded: {
        type: 'P2PKH',
        address: 'WSu4PZVu6cvi3aejtG8w7bomVmg77DtqYt',
        timelock: null,
      },
      tx_id: '00001070597c712fa0fcf7e289849d88f0fdd2bc9a948404c885f3e21b8eac4a',
      index: 1
    },
  ],
  outputs: [
    {
      value: 2,
      token_data: 0,
      token: '00',
      script: 'dqkULlcsARvA+pQS8qytBr6Ryjc/SLeIrA==',
      decoded: {
        type: 'P2PKH',
        address: 'WSu4PZVu6cvi3aejtG8w7bomVmg77DtqYt',
        timelock: null,
      },
      spent_by: null,
    },
    {
      value: 10,
      token_data: 0,
      token: '00',
      script: 'dqkU1YP+t130UoYD+3ys9MYt1zkWeY6IrA==',
      decoded: {
        type: 'P2PKH',
        address: 'Wi8zvxdXHjaUVAoCJf52t3WovTZYcU9aX6',
        timelock: null,
      },
      spent_by: null,
    }
  ],
};
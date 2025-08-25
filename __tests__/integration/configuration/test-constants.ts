/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @type {Record<string,{walletId:string,words:string,addresses:string[]}>}
 */
export const WALLET_CONSTANTS = {
  genesis: {
    walletId: 'genesiswallet',
    words:
      'avocado spot town typical traffic vault danger century property shallow divorce festival spend attack anchor afford rotate green audit adjust fade wagon depart level',
    addresses: [
      'WPhehTyNHTPz954CskfuSgLEfuKXbXeK3f',
      'WY1URKUnqCTyiixW1Dw29vmeG99hNN4EW6', // Genesis funds, index 1
      'WRTFYzhTHkfYwub8EWVtAcUgbdUpsYMBpb',
      'WhpJeUtBLrDHbKDoMC9ffMxwHqvsrNzTFV',
      'WeBBm1LfKBH3V5rEL5DAHtjjDiAws3Z83m',
      'WWTNERwV3dcvWjCbR4rizMuEqPbFjZsd3C',
      'WR4EQB8wZUzsVnqhodBBbtYsvKxrr9puG7',
      'WjJZoqV3AbRfgBWNfjAyVYTydFuWNPgspW',
      'Wh2FHvahkwvt29saUz7jnhuDh3WDHuc2ZY',
      'Wg5bXXQpRE5DWwsGDNfHsKyisJPVotxhhS',
      'WiodAJyH67sSTGgpRPXWsVGEfGESN7ykEt',
      'WNpFPr1EDwBgtTqYUNTbKTRpbGj6vdNgdL',
      'WVPeyNm4pWjJJixjj1DsRc4ceYd75xCyxq',
      'WcZotwyy1FnFYuA8D2LqrUBSNEFcPr3T7a',
      'Wki6BdLTCzS4ZoQSY1QgfgzQdgT9R3txEb',
      'Wgk7UPN4zZZdMbsCNMSosRwsvHtMoWf8S6',
      'Wmqn3sanBexFaNk3nDtdb4SnHxB5MRzr7m',
      'Wbh9FrUF85FWUh7xgpqf9gjH7D2f3Py4kc',
      'WWGKeK7yJcKqvxMj2C8TFFJLooqq8Kc65z',
      'WRenJ9f6yqrYRzBUwqbBFAxAY7JzwryKut',
      'WQozCB8X2FFM9QtEMoPjo6xERVTkiBw8Mj',
      'Wds8d4vy691GwVDdzKrw1LpnvBR283VTci',
    ],
  },
  miner: {
    walletId: 'miner-wallet',
    words:
      'scare more mobile text erupt flush paper snack despair goddess route solar keep search result author bounce pulp shine next butter unknown frozen trap',
    addresses: [
      'WTjhJXzQJETVx7BVXdyZmvk396DRRsubdw', // Miner rewards address
      'Wdf7xQtKDNefhd6KTS68Vna1u4wUAyHjLQ',
      'WaQf5igKpbdNyxTBzc3Nv8a8n4DRkcbpmX',
      'WYzcaxpK4x8XjZKkvcpb5CXKuEsfAsD3vD',
      'WjfMPKn7prjXUdzp7dFAxuDGreSTArnScE',
      'WVE1uwNor9Haitx2qGu9SB4uv4wVwGAWDP',
      'WbDaM4VGcWMBXPihJrViiYDphM7WoGDMWQ',
      'WgPiV4KvwaeKeRxj434ZjkvakX23hBhLyd',
      'We1t89h3YJuj9eU1SGfNwamk9FRBv3GhgD',
      'WeDLxQhv4vs4K8HVy4FUPBWSsN49rNYGKd',
      'WetZFhUkFqfv73k7AzcQm95vnRHCRzH7vQ',
      'WNgP5CEqhW4yMLjARi7JVMh9iapnUcTQtG',
      'WUr1RDAZVLY7w6M5M416uXLxpFekcXz1WH',
      'WexLCpMTBdgAbhH8Br2sCn6SPu44CZWSpK',
      'WWUdwEecrcFTdaFz1ZkeL1ZzyRg4YsvnY7',
      'WmpwqZg1KCQvBMxaE6BLgFrSv2AZS1FCw5',
      'WfiWuwxqcJMPSfjpDhqtRfW3sDg78hg34y',
      'Wh781JkXsumkTZKMKZmV4BjV8Nnjevkxkk',
      'Wb6792ceTDSJdySvQm7tikrNva4FRuVsUX',
      'WYZigDNfJ6x5T7VfVrgd1CtkKGfoBRRbyr',
      'WWGWrrUqpbP4ekx4zoNtBsrhCSEspxpDyA',
      'WgWfrJqAgS3RwzXMMz8fywidQAUx6a5smc',
    ],
  },
  multisig: {
    addresses: [
      'wgyUgNjqZ18uYr4YfE2ALW6tP5hd8MumH5',
      'wbe2eJdyZVimA7nJjmBQnKYJSXmpnpMKgG',
      'wQQWdSZwp2CEGKsTvvbJ7i8HfHuV2i5QVQ',
      'wfrtq9cMe1YfixVgSKXQNQ5hjsmR4hpjP6',
      'wQG7itjdtZBsNTk9TG4f1HrehyQiAEMN18',
      'wfgSqHUHPtmj2GDy8YfasbPPcFh8L1GPMA',
      'wgZbCEMHHnhftCAwj7CRBmfi5TgBhfMZbk',
      'wdz9NeMac7jyVeP2WK4BJWsM1zpd9tgsBb',
      'wPs7WaRCqwC89uHycLbctDGmWPgH9oZvjp',
      'wWJJxvr6oSk7WZdE9rpSRMoE6ZqJ3i8VDc',
      'wbuDJtmM7vg8at2h5o3pTCHE4SASEFYusr',
      'wPNkywbiw8UHbRQkD3nZ3EHMQsjyTamh9u',
      'wQBNidXXYpE943BgydUNtarAwNzk612Yip',
      'wh2eCGzUK9rLThr5D6tyCfckHpBjS97ERA',
      'wZvajxVp3LabcZiY3XPrivrXiSS6wphRu7',
      'wgPbL1WzbrEntepHRC92UX6mA2EmaqfDqt',
      'wbdx4g3rucX3WHmZRXjPEKtRfZ7XSnCGKf',
      'wiKTnqSN11ukuCWEXRVrRTTPo2mw4fGue3',
      'wQ4aQP4YqJqfwshLggR2w1Gg3UFhhKhVKs',
      'wca2xk9S2MVn2UrKh78UScdwXz3xrTp8Ky',
      'wcUZ6J7t2B1s8bqRYiyuZAftcdCGRSiiau',
      'wV1S8wNka7SxLQbzDRP7NMKuCXfZCWgHhN',
    ],
  },
  ocb: {
    seed: 'bicycle dice amused car lock outdoor auto during nest accident soon sauce slot enact hand they member source job forward vibrant lab catch coach', // The wallet that can sign on chain blueprint txs with its address at index 0
  },
};

export const TOKEN_DATA = {
  HTR: 0,
  TOKEN: 1,
};

export const FULLNODE_NETWORK_NAME = 'nano-testnet-bravo';
export const NETWORK_NAME = 'testnet';
export const FULLNODE_URL = 'http://localhost:8083/v1a/';
export const TX_MINING_URL = 'http://localhost:8035/';

export const TX_TIMEOUT_DEFAULT = 5000;
export const DEBUG_LOGGING = true;

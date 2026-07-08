/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { IPrecalculatedShieldedAddress } from '../../../src/types';

/**
 * Pre-calculated shielded address pairs for the FIXED integration-test seeds
 * (genesis, miner, ocb and the five multisig wallets from test-constants /
 * wallet-precalculation.helper), 22 indexes each — mirroring the legacy
 * pre-calculated address window.
 *
 * Purpose: shielded address derivation is pure-JS EC math that jest's vm
 * sandbox slows down ~40-58x, so deriving live at every wallet start dominates
 * integration runtime. Injecting these at wallet construction (via the
 * preCalculatedShieldedAddresses param) makes loadAddresses skip the
 * derivation, exactly like the legacy preCalculatedAddresses always did.
 *
 * DRIFT-PROOF: a unit test (shieldedPrecalcFixtures.test.ts) re-derives these
 * live from the same seeds and asserts equality — if derivation logic or the
 * seeds ever change, that test fails and the fixtures must be regenerated:
 * build the lib (npm run build), then for each seed call
 * generateAccessDataFromSeed(words, { pin, password, networkName: 'testnet' })
 * and deriveShieldedAddress(scanXpubkey, spendXpubkey, i, 'testnet') for
 * i in 0..21, collecting { bip32AddressIndex, shieldedBase58: base58,
 * spendBase58: spendAddress, scanPubkey, spendPubkey }.
 *
 * Keyed by the wallet's seed words so helpers can resolve fixtures for any
 * fixed-seed wallet without inferring intent.
 */
export const PRECALCULATED_SHIELDED_ADDRESSES: Record<string, IPrecalculatedShieldedAddress[]> = {
  'avocado spot town typical traffic vault danger century property shallow divorce festival spend attack anchor afford rotate green audit adjust fade wagon depart level':
    [
      {
        bip32AddressIndex: 0,
        shieldedBase58:
          'K3MdUaNxQZhGX85hiNLzkgk2LMrqVURqb3VGYTZ14TTaXW8p5hYdnN9sDj696GrNjq1yq5kYfWCa6DU9qJUkeefmBrWVF2xiD',
        spendBase58: 'WQs23BwegXjHJgQ7mxRroEZDzutdudwrFK',
        scanPubkey: '0330d50ea368a5d39a7429a4cbf77e2bfa73359650b57328c1a0a847439511cacb',
        spendPubkey: '038ab7b584dcdf2003924afbbf8124ad0dea843a88d2ea2bc43aca690f5718c568',
      },
      {
        bip32AddressIndex: 1,
        shieldedBase58:
          'K3Le8Xqro6RV7ubGFQXkfPRGvrY1b8LiRxtSWap6wZn57cb6eTU8MoVmoWvuWxWvMt3d1153gVYpUVcCfffCirVCJgp7jPWhu',
        spendBase58: 'WdgawdwpazumdmR54veZvCK6vDZvAeV4Ua',
        scanPubkey: '02cd861f49e7ca7230d52065417f95293ce28bd2a3038ee35ea7ea023f9917e543',
        spendPubkey: '03f9a7ed019d5f0093e85ddcef015bce2e3d091615898bf2e42d20794b5a81bc9f',
      },
      {
        bip32AddressIndex: 2,
        shieldedBase58:
          'K3LrNqoFoxUA8WP9YYR2JZxiPTpRtf3ddKeJSontAJ7UBnjXkARL22bhqKrJqDQfgzaV5HcRCMoF45HXCUmqs7mpHn6DaCNFM',
        spendBase58: 'WdDhHn8sCKgLL7FtJFGjZzYLtqnNYLYM68',
        scanPubkey: '02e2bb7113e31dbb44683fb3c35630c8d2eb9a82fd9daa4a2f8c415645593cd5a7',
        spendPubkey: '033e725e61f622691e5b547a224a8a9c238427e086d45d8a92928bf6d41ec42cc1',
      },
      {
        bip32AddressIndex: 3,
        shieldedBase58:
          'K3N9xkerBW6Moh973zNH1Tw5n35kpL9DdWte1msgUqDvs912P2NNbgTLxi7wJGYr64sEmqXTsFLf57bKYKWKehKyGbiGaWnWK',
        spendBase58: 'Wmx5U3Qg3gpDwTAjSicr5cidmwjW7Msb2X',
        scanPubkey: '0365a04a033ce7b8d0161343c1eecfb376bc6e8826d77d697738f3416d8b275a44',
        spendPubkey: '0268d2727f3f9213f4d392addb1847972b77556459f7884f151cbef2f3fdf7313c',
      },
      {
        bip32AddressIndex: 4,
        shieldedBase58:
          'K3P8cV9NQtj4fkdT52ss73W9qKrtjYTB9PqsmHua4mS4yuGzPUMxwq2oQ5b5MKL4TGW5DT7jqK42pC9vRxNxtG1ACA8UbgTVN',
        spendBase58: 'WZrxsrLce3VEme9paNpWdcnSdyGBXE8jq7',
        scanPubkey: '03c7bb1a2b52ff68a78b7260ba9a7c549f26b9793fb4f046ab1ca44648c6692ae9',
        spendPubkey: '02a6589d2207caf093de9ca71f1feb2ccddd045b464f8a7cd314a39f6649089679',
      },
      {
        bip32AddressIndex: 5,
        shieldedBase58:
          'K3MN1KnUQcz9b84qDfVMxZBr4x32iVmcDguQFUaBNYFA8EgwFJM9kADPXCioexftWgBxEZt1T7Dvq866GFDQ28Te6mTUj9rhB',
        spendBase58: 'WUw6byZCARqx4nZLbTyga5dEw2Q8p7WK1k',
        scanPubkey: '03160ad3fe0a916bca569c69888b931bc3642904a567cb48d28d051b7ed9b71785',
        spendPubkey: '0331c0be114b24a776941b8e15745df5d2a8f8eff0b16e4efaf6da588ede1ed9eb',
      },
      {
        bip32AddressIndex: 6,
        shieldedBase58:
          'K3PRvLaVeXMq5gVs5JmhuCm2QKLiJMSfkzcPMWCK9YQXfZbcgyMiRAENjpKfTuRyfKjiFMBmxAMUNFrkbDNkXJk6oFVTQifmM',
        spendBase58: 'WiPK8xkacCGA9qag8mNGUqoiUdVk3Z56sE',
        scanPubkey: '03e5b424ccdf5d7ebc5767301b701b80f91853b02a1b6bee30ce92ae86c417bf25',
        spendPubkey: '029792b9d0ee77bfff8c4410049f9cbdb581b7b74fbf7f7876d47f06de646ae861',
      },
      {
        bip32AddressIndex: 7,
        shieldedBase58:
          'K3P7cZfkdnRLNJiViYt9QmCyJRUHd621oWQAnJmzp7bUvwXpYpkC75fY55RTMF8AiXFcB82uVbid6EKN1YwH1Zx9nXcLvyAMg',
        spendBase58: 'WgzosAv4v4yg7XYJuPpgXu5EeXCJubQ4Y2',
        scanPubkey: '03c6005ead129e9ad9fbc52d17c299a8f5c568044c6b6ef0e5e8685590392ae4e6',
        spendPubkey: '026a586accc8aa7c3ff81be40a7fa12198b22a293a11f8701542f5da50a44d807a',
      },
      {
        bip32AddressIndex: 8,
        shieldedBase58:
          'K3Pc8hbZngiiZj912YmFfHnqRTqypKFPHhQiQ3n6XMVQTnJ1oYikWXN1Tp9DGgtFdpkgdgrzaVxW38jmWnphhvGAMzz38cQtz',
        spendBase58: 'WQjSzaxYPZSQkDz6WizW2QWjcqrMpuPEcs',
        scanPubkey: '03f763ec2fc122b0298e5b9219c77738264e7f3c7d4d273b5a20512143bee41141',
        spendPubkey: '029c29a8b55f6b2c8cf2c3bb200c62a91aa7b43032ece079b6319d7978d1e4e1c1',
      },
      {
        bip32AddressIndex: 9,
        shieldedBase58:
          'K3PA4d2oP6jPKoZEvPPNUwbJbTiv8BPieeq6MGTJLXM1EL1dgmACzZxohcctuWGyn6vS9EMmSGeixvUCWYd2wPcTHwHHqawX9',
        spendBase58: 'WbiPz36uCQvB3qR39Aj4UaFgUHe2JtnGiz',
        scanPubkey: '03ca3e342319fba71c2d78503d8afa471aa8bad1ddfed823e4b2d942b7b1cdb1f2',
        spendPubkey: '0251ec5d82dc22700dfa2ff459d084f5fd60eb7461f3b3e5c7cf34c94adcde3c01',
      },
      {
        bip32AddressIndex: 10,
        shieldedBase58:
          'K3Ju64G38sf5y9gKWB2gzY9gocgKsd6uTjL32gY4koDqzVYXVQzNEWMDn5kuJwwHLUupBvVDGKxC684GiWTmkyQ7LfCr5Hou8',
        spendBase58: 'WaDspsMxso2fNa54m1tLQRV2KrXYfVeBpd',
        scanPubkey: '021e8b0389dbfbe9b24a0d2997cb24a2db8cf54361d42bfac950ba36dedefe8b7f',
        spendPubkey: '03a17455b6d36e4aa05ebe8ddd2cbc025646e0a630c06c7dc25f177d73c86d1cd0',
      },
      {
        bip32AddressIndex: 11,
        shieldedBase58:
          'K3KyZAKtaLa7QPEjXHwVGchovZZfGL7e6iHbPWghm2aimAQ7jYcGzaL1WuoS45wqxGU3vzFT4K4h3FTe5EsiXViK7As8QXCXg',
        spendBase58: 'Wk7wDmf8PbBCiMd5q1MYRit6eh2eqDkkP5',
        scanPubkey: '028ab88fe406b142350d4091bf05886d0b33b7aa5a0fa4a84a4e332becb0a17d35',
        spendPubkey: '0349127ce3533374a8faf317652733cd39eee95fd411b04d8b343eb09c6c28d6ba',
      },
      {
        bip32AddressIndex: 12,
        shieldedBase58:
          'K3N2pDNYBLxC4EPdbB9x9NZxE9CarCQtu4BVX4qfEP3eHV2DBoacLariE35RzhLEsh9QFu7rq8nt7a1NxhBfdFHQdUpPpZJ35',
        spendBase58: 'Wh7Y4xwAhsa33zppyqdZfCGzAe9ULtYKVC',
        scanPubkey: '03593fb7c73652b81539ac8d42ec0b90d1682ea32dba51b87b36a984bd705e217f',
        spendPubkey: '02e3a7fa23be58088b44576e979ae1e4d815abf6fcffe9a4a11395c246c7f09120',
      },
      {
        bip32AddressIndex: 13,
        shieldedBase58:
          'K3JoiWB1sSMQNhVCk5eKAB8NdNutNucQBLHAoGP5HicuyBhTLeYyDcvNS1shv4d3DaDxeDwavihE1MEtxghhyTDs9htXjAdPw',
        spendBase58: 'We3hvwFqaycYS1pebECfc9NxrWV42eq2ko',
        scanPubkey: '02153da079d126ac90f559ceabde57cef1d85af6ed00eb7ce4255b59ccbdaf9396',
        spendPubkey: '03ca729d8186a71d9228e155c0289c8478726e2ebd1f82a89d03163c1795562901',
      },
      {
        bip32AddressIndex: 14,
        shieldedBase58:
          'K3MuvFDCpGTCgTChoX34Mv97n1YGcUrj7hhcRrP1brSjqDTnmyaRRMDDKmhkTzkd7Gu8gVuETKGv4EAcKubabkKbMnw8D88Ga',
        spendBase58: 'WYf2YUsYFX5XTASesnvLSYgFbjMxFPYCXY',
        scanPubkey: '034d4e859462c542e039ab5c5f8825f1ac1368ca75c353e92f99151b2f5491824c',
        spendPubkey: '0357c9b11f0a8fc8651fdc4d18a989b7538553642980307a687b1b01b195c0e107',
      },
      {
        bip32AddressIndex: 15,
        shieldedBase58:
          'K3N6QpJSvjX2MyXb6AqfJUHcRBsaJ2wybWGUBiWfXPaGX7d6axu1HqLeVskCouKQemAgPL5LAoNn13ZQgP9kXmRrifTfjMXxe',
        spendBase58: 'WTqbaMoTVeAGAPRSYPvhnw4DYo7Z2hHc3W',
        scanPubkey: '035f7a3068cc30d5234948d4b7daaab24bac51e4ad994c2a796673dd52266c3ab6',
        spendPubkey: '0312fbae54379d71fe2e346b211d6d7f6e56ee47428cd51848c5ac6398d9bfeec9',
      },
      {
        bip32AddressIndex: 16,
        shieldedBase58:
          'K3NsHVMQN6rE4S8nW4HpR9ewiTn2NidH4oFePj1Xkfye8V21R8eCUVheySVxmKUkeF48wZv4JSU6imC8VLmQd4uqhBJ55iaWg',
        spendBase58: 'WcQFCc3qtoARXPunM7fpoxsx6xaca9cLQg',
        scanPubkey: '03ad2ff8fcb78bca5fef3604567c394e2dbf0670d3a71d73626a1ecdceeb436588',
        spendPubkey: '03b07e67516d90aa131ad0548d3cfbace2bd63d0d2608085d3e59a89dcfd0ef3a8',
      },
      {
        bip32AddressIndex: 17,
        shieldedBase58:
          'K3L4SFxbuno1dCapX4ZwfBsquQ1amaasjN6rZv7JbGPvGa7k8P7PMhSG8GBQe1JZznQgDLp88P443T2geyUBCF9zEceiVXiPn',
        spendBase58: 'WSM9bGL8crWWecu9q5id7GnBh7Cg3oPMd1',
        scanPubkey: '02932c712f321f059e9d8efbdbceb59f78b38ce29c15fecf13d63c24e1670bb28c',
        spendPubkey: '0243265e57948e6780f1fa89827374df733ed2b9a7d231c89b3ddaef3734349956',
      },
      {
        bip32AddressIndex: 18,
        shieldedBase58:
          'K3KEJHhZWQbRHoru4gB7HPmDsxpWnCitKhMJFdZH32fiGWhTy35rkReZGt6QehtWyeRKwycYXi22hPK5VXHoawwuPPr92Uz5a',
        spendBase58: 'WUxwxZu6LShseGTeQVPvxV1znCaKFLLerL',
        scanPubkey: '023fcfc049c55b176367c8e1412f799a7c65a275cc8ead8d190b63749908df26eb',
        spendPubkey: '038985fb184cf9c76fcc5c157f41c781762ffe89da78f8f91f5dab7db43bfbf91d',
      },
      {
        bip32AddressIndex: 19,
        shieldedBase58:
          'K3MiZUJnhuFdVq9MhBmu4vC7SvHgaru14yPbu2H2wwPpXuWRi8QDzhCD8WYdtj3zj76ZcoE4SDjTKebu55RX66yG4vwgGYZsJ',
        spendBase58: 'WQ5tRvjXJETDvMYg4TgPMd1HvXsNAURzxo',
        scanPubkey: '0339a31e2bab0b0a47aa489c7b9e98ebead8d63ed441b0e6dbaef8c189b6edb3cd',
        spendPubkey: '0290eb0867db3bc643dbfb47514804a0e70c6fa82a5bd188b3a5c60c374412cb56',
      },
      {
        bip32AddressIndex: 20,
        shieldedBase58:
          'K3N9D1fDdKhNHAFtrPrEWmbV7JboSsDcMAxfRMJL8gdutbVaSswZ6Bi9t3ULH2tMeJBg9QQQ1pZNCUqSorohpi8CLWRMb13PQ',
        spendBase58: 'WgzkMqoX8VRYXsPjZ3ezEkCBrgvT3vEKpf',
        scanPubkey: '036451f2d1d6da5d8d3f4216e350554352c66496132e72d7dd7c2924b7c3db80c7',
        spendPubkey: '03a3383226865d0c1498c49f620a00db7fca580934bb9222af5cf471ccfff82f77',
      },
      {
        bip32AddressIndex: 21,
        shieldedBase58:
          'K3NFvSuSQeVjtgWFYpg1qRbp2qtM79gsUcV16GhYjT6k6Yenm3XwpVt9ungahnjSfqYN5Dtxynwh6reAmoMTaWt5FQMvjLSVt',
        spendBase58: 'WiRaPabTrCdoEbBgLkk4oRigEE6rejN3Kz',
        scanPubkey: '036ff2a2665285339ee346e4666dd20e1bffc3eb0591b9563612a85f9de6afe5fd',
        spendPubkey: '039c5f75f02e5ddc5614192026467fcbc0e83bf4c585e151708afa59a9267fb57e',
      },
    ],
  'scare more mobile text erupt flush paper snack despair goddess route solar keep search result author bounce pulp shine next butter unknown frozen trap':
    [
      {
        bip32AddressIndex: 0,
        shieldedBase58:
          'K3MekrHcudTQtMuwPV7VY4NJYdk9Fgif6uV3Cj2iiW47VfMssSpKfNqLQpTRj91NAUkoXEGtu2j5rNL213tXTYvd8XzSw51aF',
        spendBase58: 'WcN8U7tmYpTHw1VATpJc25SdHKS2DmWX5b',
        scanPubkey: '03330cc79d91bb8e8c8618e90e31b4adc6cc047c4ddca404a10b49c83689552477',
        spendPubkey: '02a43d455a2b1be31f7b78cd24c4fdef7bdab45842e2e73f61e0a6d24df9f737a8',
      },
      {
        bip32AddressIndex: 1,
        shieldedBase58:
          'K3Lc8NbCnF9XyqQYk5BGayCG9nya7js7GHu9Mh7KjxrrqYc8J9YdQmbaTqiZnqWK8AuywB18BB3g52uU8WizhZnfbF9EY3aA7',
        spendBase58: 'WayDihjrBnE5eKGy6HzpJRQyTehgf7UXx2',
        scanPubkey: '02ca0e3ee5e45c78b52109966b8e9d6163b240b7a8ce9e87da1e5a6a6c28c28887',
        spendPubkey: '038682b08aa3658f9a84c84a789b56dddb9a13eb3d7bfc5c550b3802db23a0a36a',
      },
      {
        bip32AddressIndex: 2,
        shieldedBase58:
          'K3Mpcny5Qk2vDUtnBRLst2n9KTxdVyu6GgbypYsngkaD1vNQFkRY9qa6cxLYeFT69CF9nrZ182VroVWDz2vpYvQr7FpyY9Unz',
        spendBase58: 'WjVMLbaiq8Pi4QiNFsVc2REBsu6ho1sixr',
        scanPubkey: '0344207aafae45885fef53ecf5fdbbd73f158a43778c910b5b81edcec36e013233',
        spendPubkey: '030e7e27ad0028dcc697f436e6e5f217d67e2e63c122f4e95553e3da213f236ddb',
      },
      {
        bip32AddressIndex: 3,
        shieldedBase58:
          'K3N2FCnLYYLGQTW5LMqZQspC7vV4UdHyMCRTBAqMaY9qCYKpL8NAGrhS8ThPnUpyomsj1fLtZdMokcQ8uCWbQW5o4cW4fRfP8',
        spendBase58: 'WRsUt72bZJ9LuqL7kFkaGnWdQ7kFH5AvrF',
        scanPubkey: '03584366c8cc887c4d7bc36e09ab52946e9846a73d8ec5e5bb4a3d2dea8cc094da',
        spendPubkey: '03b5e4437ed428caf0c70ee01755aba6037e9f3d563790beb2b57e2dfa280620a9',
      },
      {
        bip32AddressIndex: 4,
        shieldedBase58:
          'K3LzW6syB73ky6q3JVqH68wgAXGcwBXWySZNcoDz1pjPhQ8o3m3QgMuN4odJdZ73UBGhy2bUXPwrNQENBfZjCExqpcPauetDK',
        spendBase58: 'WcGfB843Qzh24bu6w9jB2YKZS7mDvUoW89',
        scanPubkey: '02f0cd902002878558575e7f53b67a54cf36cfc01cb0e084984df11014d38ba2cb',
        spendPubkey: '03d8f6ec8278a589518a285c2259f0c88334db0820636c77a19ec53286e2f1fde5',
      },
      {
        bip32AddressIndex: 5,
        shieldedBase58:
          'K3PKniUkcDzX7zRXnPVQHbhHysMVEQP34QQagR76rotHvZf9NUJfbtR9SDijpsHibu1sk1qpK7JMv747Cfn8jtmaPJmBJjBvB',
        spendBase58: 'WRyzAG72imaTkVJasvuHJ2DKY7xZuN6ZHH',
        scanPubkey: '03db15e8e72173e83ded595f455d76e34475e20c7a1b8df016192bd9013d654a4c',
        spendPubkey: '033e1ba698787901d3edf42482f29a9e7b2d519826d2190f1765186b6ee76ab462',
      },
      {
        bip32AddressIndex: 6,
        shieldedBase58:
          'K3MHtSUM4ff5216oxymtdzypEsF2FzLCBKJV48PSnM4PXPtArwb7dZQry5ckwR9Ru5U2svGqXxCeajHK18zvDofUaexdXcPwC',
        spendBase58: 'We9TQPwW2xAv6bunJQzr6BaRYKBGYsc1ju',
        scanPubkey: '030ee8e3d2d980462bf2f20c6ffe4141a476c6e5d419f0a3ea14310d1d57d325b1',
        spendPubkey: '03fac867d99c852caf745394826739c70dd34809eec5fc1fd1c81dd2955ae0b7e6',
      },
      {
        bip32AddressIndex: 7,
        shieldedBase58:
          'K3MarxkN1YuxCBLfVrCPUBjkHcQsiw6hhwyR7YRa7bcADZcEUQZbsw7yqjAon7QqjDsRQWMcgmftzn7WGCKHbfeHN88oUyF8r',
        spendBase58: 'WTonumNXwtWcZEVrdaoG7oJfuoevdGok3G',
        scanPubkey: '032c4e2db278bc7b20bb646f906d94c55508344e8e8036453381e6310fea6c89cf',
        spendPubkey: '03b0cce3c6085fc107fb4f1f6d9b7f25c754f6545cd03a0e0ca6a4242d6ca6ba8f',
      },
      {
        bip32AddressIndex: 8,
        shieldedBase58:
          'K3Mvw8SWXeHPwNy4cK7Wf8gYTERUgGxcacmQuZDGBucD5LJpXoYFALB5oUZqU4KUenuQupJL11RX87MuLs2w5jHesK7FfBZ2E',
        spendBase58: 'WWVQFEXN5VpBXwfnaybab2awhpZBkm1RTK',
        scanPubkey: '034f109a08c5bd04fea7495c49ff1939a689244fb5c705d492cbbef4ab4b227299',
        spendPubkey: '03548751978ea48321c506a59c7dd75e75f6c4673a056468b41a74085b55a791cb',
      },
      {
        bip32AddressIndex: 9,
        shieldedBase58:
          'K3MLRWEWX7WRar9H4Wsbh35tQx1RqNgi4SvFUVhPuqdDzyCzLG9yejxgnJNVeWXtj7kTug6ehxXiHjxuSQjVqGo32QSVNSUdS',
        spendBase58: 'WT9Q7yLBsA7PgsZURc8mK1oDD6jn1CUsK3',
        scanPubkey: '03134cfe8898a0651032be61b8bb85847da6c2aadac9cda8281bd3d06850d61174',
        spendPubkey: '02698c472087b45e853c21a208223e1b259ab03d8fd218f03c0dae20e021a261e0',
      },
      {
        bip32AddressIndex: 10,
        shieldedBase58:
          'K3PcnkZ1m6VxfZGsp8G7tvNf8FoSNmo5PsyJU7Vi1F19UC9Fi76Mr8jRZa5rfvkMriz3BoukNpAZcQ61BBgFNaa5vRatRkvyT',
        spendBase58: 'WfdAJA7xC3NhmVaK9GiikUuakzBR1X16XD',
        scanPubkey: '03f886c4d1205c62e39879ce9c05ab62989e8c879e61bcec503fdc2d44d131541b',
        spendPubkey: '0292b671a5c5c8a17b603ab68a615f6c643dab1de08b9f120e0676bad05009492c',
      },
      {
        bip32AddressIndex: 11,
        shieldedBase58:
          'K3Nro4YEuvLU3zy5yUketcNuLD8MnGTAnz4qpQE4uKA3e4aLk4QHWdFWZdEUo8a6zFiLjhJ4mDHA14VCshrXSs4qcZQLpSYQL',
        spendBase58: 'WT3mAX3huhUpLMFg6edDrEe3F1nYhWRKAf',
        scanPubkey: '03ac56ae8ffe31936d5918c85698b722de1026af92ce5661e1cea4758e13e0a540',
        spendPubkey: '02e9181c9a557bc424cc79bf2472ad133c6314483449fc72c2e2b271c3f6657728',
      },
      {
        bip32AddressIndex: 12,
        shieldedBase58:
          'K3LwVkw1ZzxJMocS89KnJBCbghwefN2GPhePhMdMVC9fNt7nr3FLzqFYKG5BH6EfPAvGu1PprRZthFsjtG5mdiLbLF9ACwUMc',
        spendBase58: 'WSz7myUeWyYT61HSBa6VWMZ1wP5u5z7xq9',
        scanPubkey: '02eb98f2cd92374a1c89eb147c4d390763a9eae87ca3ae3245f6e21466b0d611c6',
        spendPubkey: '02575df5e3eb4d9f6e2ec4ff55a0d468adbd257c06d5e6ee765c12913b305bfe4a',
      },
      {
        bip32AddressIndex: 13,
        shieldedBase58:
          'K3MgTZtpbHo4J4bJ8y8SAYG92gHtmCmU1jGM43owCLv3k9RYCcFh5BczizEpBcBLcXJVxgnZXJWjBpUkZ27cPkQmP7gVdfXDg',
        spendBase58: 'WSKkb1GKQ77yPffEjSShwzXAeQErQD6aNf',
        scanPubkey: '0335ff55dbc122ad53ee72dc2c1835c8d9a1050589fab84900e028b2f928c09396',
        spendPubkey: '02799ddd302568e5ab42b15d26911f267906b1ffefa0ebc04573bf00671be0f10d',
      },
      {
        bip32AddressIndex: 14,
        shieldedBase58:
          'K3Lp92rD5wzsS1qkqKLKhBFVWRoKidW6cVwjX1Dpg3Ngb3x79WJUaNpcTZK85vX5gj3dZM9AQsW45wRdTYzM8ASeBkFb8DYSs',
        spendBase58: 'Wcg16DMqnWbSM3pH5tHx6baWSQ4HCBmed4',
        scanPubkey: '02dedb3b06a4204726e0bdd83603c00ce96e55f4cf0e43d6dab180e9463b2f6155',
        spendPubkey: '03c12b31ffe9c229be4445c6a15792b05573ec2364575fa81dfe4236775b21a322',
      },
      {
        bip32AddressIndex: 15,
        shieldedBase58:
          'K3Nwy6XHNSc9ggbCZL3jEa6hLBNnCFEfPgqKyFSCgSpoKJtYxsVYs4LW5TrP4XFB6BW8baobsyjaUmYTfBYzrQwz2raEPDqPF',
        spendBase58: 'WSMy8VncZwShoBJe43dNgRoRsukwiA5M18',
        scanPubkey: '03b54c05a9aad57450d97dae764c45182516970f2c836ee645830d6baac9873974',
        spendPubkey: '0330dd56b8740ac1b75e300676c26599f1b019b81c26f564829188b99c9e58d7ce',
      },
      {
        bip32AddressIndex: 16,
        shieldedBase58:
          'K3PGVNmCuFgDr7ji3EkNfoEgWSYxp2NuvmccWGccf8uNghzYFJNapdcBvnHQdqQfh7t7WU25owvQQqy8nPw5NuR9n5AMFuMq8',
        spendBase58: 'WhQ3GWgKzfb9HE8QKv8pL71i5QhUSoYrDL',
        scanPubkey: '03d55f6273b2b3ca2762cee187cd0f367a08d86f2976954ff1863db94a774513d2',
        spendPubkey: '022f7c2d174d107f077535747e2feaf68c285e01f132c78414ebd2bd87e5f5cf33',
      },
      {
        bip32AddressIndex: 17,
        shieldedBase58:
          'K3MUjddWs1js4aexwD9ac1oReu6U2PFA14ffqqcp8MCCf9HtSo1wpwURCSr9taGHMdMSg93CCFwdprQgSvSNkCjGWjv6hY4S4',
        spendBase58: 'WgcuiuJAxWU8LSih8JaExZdZhf9DCervbX',
        scanPubkey: '0321b22eb0a9032150a8b3ad5f636de96b8ea81d7d989c52565b86ce22f5d387b4',
        spendPubkey: '0396f5cb88392431a2a4d2a145d67b1d0ebe12e1f67eb8ae65a369b9f27bf7d6dc',
      },
      {
        bip32AddressIndex: 18,
        shieldedBase58:
          'K3NdZyt7yZFUSXYQzUMcSVGaQSWHK1gxJoHsmvLzKnJSAoKPMobRUYuqsFRZ6HDa3SZLqZ8oZ2VMdp9tQr35CL58cgP3rzui1',
        spendBase58: 'WRY3efn93RfS4nQzvtvW5BB5UEqPA3g6WX',
        scanPubkey: '03956f6e0d820932c5145b07dceb7ed2b768ec4562e00086be6b20ee1a4e67deeb',
        spendPubkey: '0390f7f9bbb84dc545f0eec9e20d9c26aa26bec54319f0dc496fd835d2370921da',
      },
      {
        bip32AddressIndex: 19,
        shieldedBase58:
          'K3KrtT8zbUr9xAFjCUNZP1rQvUMibUgvHJqBPUp5ucDjkpEvzTCsgVUdvha47tvssVGhp5GNpYG1jFqGhEo7oty6aY11grPfY',
        spendBase58: 'WPC4KffVxiQhvQnB3y8VwRjYqmGDXFsk5L',
        scanPubkey: '027f2cb4bae7bb60ec0542a219da9c0781658821a64b76c194732c18b28f645488',
        spendPubkey: '034c1a67c3c2d2d534a83fe41063626add1a30b18e5b106384030334fceedcb072',
      },
      {
        bip32AddressIndex: 20,
        shieldedBase58:
          'K3L7jhHCa2m7bor1GSdchd5TtP5EmnZZF3W6LGfxrjFH4tx9Z8wYHrvLtTrrVLgASr964GoszbnbMaD8eXhTA39iY8SKVPu2Z',
        spendBase58: 'WQVc9U8mYLsp1YZK6WbRKpDoWwpe2MwxoV',
        scanPubkey: '0298e3b4b5b745e4cea00d4e2998b02c2828b776f8aeb562063f54895432969101',
        spendPubkey: '03d257f30d460de6bd2f1c2dc08dea9dcaac0d4372418fc157f849f7ecdb57a973',
      },
      {
        bip32AddressIndex: 21,
        shieldedBase58:
          'K3NhWizvL6qSFGByaSNxTsRkvdn5LN7Wjzw9DwgbGAP3w7RHTYMVVsZmdb7BTWMwoMvYA3WTBUaE3kGQMEKzykfZnewh37g45',
        spendBase58: 'WaYmvxg1XRsDnJTYkvSghmhUhXA9c9qb3K',
        scanPubkey: '039c43da20e437e1850ad35a2f9d904cbd7b5bccc06ba20068cb063d6bcab0ae60',
        spendPubkey: '03f80b43f96067f49df3b7be350a7025b3182509a02ac6e79349add2f935363f3b',
      },
    ],
  'bicycle dice amused car lock outdoor auto during nest accident soon sauce slot enact hand they member source job forward vibrant lab catch coach':
    [
      {
        bip32AddressIndex: 0,
        shieldedBase58:
          'K3JpL2NkxxZQsPwfiLaJzcHpFuX811G3Y5LvgaT9a2csQTxMMsfLa4Mb7AgrYtfN6cmY9MKbN3sWW7sHyppH5gGZzqDaE6daG',
        spendBase58: 'WQMjsabkp47yZhR4wUkmN7Ro6CnBmFaod9',
        scanPubkey: '02164d220b9db657eebb7a80dbe5ca0890e5435e8b52be5034f2f8559d901f7336',
        spendPubkey: '033d270645ebbaa4bc4e1c4d5dd3d08a6e1d601a701e96e50e093d9fe868a518e6',
      },
      {
        bip32AddressIndex: 1,
        shieldedBase58:
          'K3L42psuhDhh3ZTdhiqnY9SVowRStNLnzrMuoRkZWhmhPY4eqmChuMBaHPozhXmP6XL2wyHkbDFVK3XvjDGszB5WKsQYMEjgy',
        spendBase58: 'WivTUwNc3CmLHXKznbBoGcsYvA4QENqDxJ',
        scanPubkey: '02927955876d14b5112782178b9ddd509a56c57e0f0e303e9288616fd9ec6828aa',
        spendPubkey: '02da1f6e35a3235efb3eb1b0db0c410d87e8cf00a8c7516c5423ce1badacbcb5d3',
      },
      {
        bip32AddressIndex: 2,
        shieldedBase58:
          'K3JuG8ZYe4bDR4cn9wUJN5BYRuBVNAr9FGoJ8bp7Hc9jDLwcAi5Q7qonKhgd6Vjaff7yDuU2uHAB3dmkSFhGcS6TuoWRRJ3Wb',
        spendBase58: 'Wkjmgs4GptFD2ZZ2t5DcotJwCZhsSvYVqs',
        scanPubkey: '021ed804472b5205d7754e044291c79b300a0418827d9b726fff15b588f2010bf1',
        spendPubkey: '02f87e6b9fbcc96ee2f6533c0ec411b1680a3f0b3ebbfb82bf4fdd017354407b96',
      },
      {
        bip32AddressIndex: 3,
        shieldedBase58:
          'K3K43QopMDMemFh6SfnzpmVU6z3vX6GFTptJMdHeenTciZLiECxffGZFjmSEQrqG6Y9BCaUhk1iY9FRcgBqHLZhcoMDAmqwD7',
        spendBase58: 'WXaVpArJ8b7dQVyv5QurnpGBRz4d4Na2D1',
        scanPubkey: '022e0cbf86765103e4c55de8d751b4acf63e55a3e2c5584d606d32e2b9d286a17e',
        spendPubkey: '02e731ea8175d7bb64cfeb626c330538f041946bd404c7e668ec1bffff78285f2d',
      },
      {
        bip32AddressIndex: 4,
        shieldedBase58:
          'K3LSwMx3EecK7PcSpRi9cMW21bVFQm9i5VKA4x3pQtBJkgjjPeDE5CJZJzaSfE2m6Z1Kruj61kuQJSvCBa9V2Q7pqbwnYAf2G',
        spendBase58: 'WdqdAeZsFjhmBjJv2CnoHaJuX9pwRVCFCi',
        scanPubkey: '02ba241fe01d01c611db5ffa3cfe8eb0c250a92987eec4496a555a9b75df62cfc7',
        spendPubkey: '035b70824c081a9576510c85403a6806d5ce8bfb3d2d965dde2cd131740357ee52',
      },
      {
        bip32AddressIndex: 5,
        shieldedBase58:
          'K3LV9UeCurw6jD2ssCyqJ1G8A1NFS19smN69kGVEZZEWg1S6ei6oTLuFy73MmSmMcM9RZQqpo1QJNGj3csJ7kMC7Yx976VHSE',
        spendBase58: 'WYs28NAKRfpNzwsdoeyDaFKer1VVL8ckgs',
        scanPubkey: '02bdf7630564b2c4b5ac8efa80994853c6a983d900282d84f83ae18f24e4b8d5de',
        spendPubkey: '02bd2b9be7da005e8dc2bae295c441e2749fa00da80d68630842dd3a2b3f671efa',
      },
      {
        bip32AddressIndex: 6,
        shieldedBase58:
          'K3Lo6xwKePzZ5FkAvJ5Nz13AH2e8cQbGG6Wa615WiwyVB9PovvD4omjfMXLUF26LNhQ7BkEgEiUaRagEVEKtKA3zf9r6p94p4',
        spendBase58: 'WWkHUreauJwUxUa9JjwQVRskapeX8oasDn',
        scanPubkey: '02dd10196a1f2ea3d7443ae9955387ca7397e6dc9557af3ed14b0684da808785f8',
        spendPubkey: '02ab8cc97022955602a721931ccfd0050a6777ee7d2c6c57aa3faec296a5c4da19',
      },
      {
        bip32AddressIndex: 7,
        shieldedBase58:
          'K3KFaQ6yhuaNjGeJga4ynph7a8e4aQzyvkWHUp93NENHQdB2C6mzWTdg1ZRwhTNwM1AS4kdDR4xk4BJxPxNdANhigVV2dzoH8',
        spendBase58: 'WgFZzkfm65JYGFXNVUFbhuWR2QfhKPJ76o',
        scanPubkey: '024206389e36b3a71830037e36eef6ece18f88e2cfca50456c230eb89f8b4a464f',
        spendPubkey: '034b1e7d1ac8f57a068d88cfcb5dc35947ce8f0ebe8f893ef4bf94963b5ac094a0',
      },
      {
        bip32AddressIndex: 8,
        shieldedBase58:
          'K3MMVGCmNtizHfJk185VyrRDbGoEdzipD42yAgzYBAQkVeZj8c4YsJrWJgM8C8GwZYASCTz2Raj1o6juuHnZpPkjPBtzz6Vir',
        spendBase58: 'WgReEwSxqG5vThJGLmhne3XzcEgNp7g92C',
        scanPubkey: '0315250c5b01a6e6281c5a6977fafa8115cb0452dc8358693b1cdf2b932bfc5447',
        spendPubkey: '0272b1cdbed21ae9f464fdd682346e290aefd68b62594b8a0c37517fdca83ed9e1',
      },
      {
        bip32AddressIndex: 9,
        shieldedBase58:
          'K3MkRgjaAuvzdqoy5gJ7a4d1zduJtPTi3w9jJ53NrSUZZFqHhqQ4ZM5KsPFdKCxUDo1GSDNGgCjG813uXjWiazSZgmcmJrZga',
        spendBase58: 'Wj4z5WqBe7Ax6z9eTXmkJ7RqJfiiabnz3g',
        scanPubkey: '033cde439462a422c466383f2d902dfa34fe6b0cebafff393b9c8cf3a6190342c5',
        spendPubkey: '03df397cd4d3e6f5c19eda85087319a500b4ce8f944ed14ec6d42aeb14da1bceda',
      },
      {
        bip32AddressIndex: 10,
        shieldedBase58:
          'K3LsRN8G1PBdq8vdHuTYG1v7kPKFaMPDsZcbKtT94x7SjcGYqWVP6ZnJQg3spFNs6kBVkEVcuX4ZQgttJbTdqsF4tor5FYmoP',
        spendBase58: 'WbhSXoGKXRq1HDaxQzVXerkWnLC9HcHXfQ',
        scanPubkey: '02e48a0de2b93affb8d64dbb16e63d4e142333712528cddc51839d17ddf66c648c',
        spendPubkey: '020bf48d7dcd46c0d2970c9e7b0a9993b3573afff89d1ea86a4df434a3f0ecb3d1',
      },
      {
        bip32AddressIndex: 11,
        shieldedBase58:
          'K3LSM1JcfbBBhvb2XDats2KHCQcSFEupk8dTBmQtHtGqkKDxnK8QYsQiJ1R4MEVmCmkJw7pCJmfGoh2Kiv6J37JmjYa8bMXfT',
        spendBase58: 'WjWW5acu9bpH574PiWjFZqKH6uChwLema4',
        scanPubkey: '02b91d858050f26643cc85d3dd8450a4d21a7efcc1dea42774944a301be24f11f4',
        spendPubkey: '024fb16b336da12fcfd3286606f1ed33c9f1ca79e7452d92e4e254e85a4b6e257f',
      },
      {
        bip32AddressIndex: 12,
        shieldedBase58:
          'K3NpeiSJJ6zDUkTtgZDcqT9TERAAmPkrtg32jwJcFJ6C41DnxKS7Er3vpUfz5mnmJceTvoyHtWztMUSzssBeNA9sYDs2L9JRa',
        spendBase58: 'WR7aK4VZ9hGiGmLFWp8hyPMW6ZvbxXnav9',
        scanPubkey: '03a8a03a0bb50acd1a3df7adb82b6e0296a181991b73012a7f4bce1ec7772b9b52',
        spendPubkey: '03072951b3f6198a9c728c79a3850a1bdc26e7e06d602e90263aa41f4f81aa71e2',
      },
      {
        bip32AddressIndex: 13,
        shieldedBase58:
          'K3Mj5tgcXMRvE849VGethiMGrycvmjvk71EFNsKP67A32c5VVivCQ5ADkBDz6EMSKTsvApBASdPAwdDRpsdHFQ97Ed2jCtz5s',
        spendBase58: 'WWntLXtYa11vyY9BLZBmrWQwJrT3zwBtcN',
        scanPubkey: '033a8ba360afbb6f2312ab072541bafbb90672e63e1deba9dfe5fb6220d52c1903',
        spendPubkey: '0389a0e2b71e881960e922fe123da195d4f501375bfb8e052d1fe5706f0be3d450',
      },
      {
        bip32AddressIndex: 14,
        shieldedBase58:
          'K3PPJyhb3fEYsJeTHQQqYs6kjB187eraxwFGocE2h9DvXYM6vVVk77GJtQ3khCRkp2ZWfEVqhTj53wetQpuSdG3HtRzDdiU8R',
        spendBase58: 'WWSY1Rdh38Ek5z8k9BQ8YTVtwazuJY2Zqy',
        scanPubkey: '03e12f359783ebd8256bee2ac8282e82764165004c77faa549b74a65c8ddb6da33',
        spendPubkey: '038c33b9b44221ffcf1750e25acef26b647183a594b6e47694074d29e8ec47f4ad',
      },
      {
        bip32AddressIndex: 15,
        shieldedBase58:
          'K3KMArGW8pDn3Rh378THTCDck4tRGNTR1gNQwx6nBi2AjjMBEK72yPYx5miHphfUUJpDrbhNf4FkgRyV38bAyLjEEmhcM5vkm',
        spendBase58: 'WZEf9epYsa2V673zv8edGsjCYBdPfAsXjV',
        scanPubkey: '024bb631c3a7f360c2e1aaf668123c4f6160f6e46ae50949fe23e8438cff42fc63',
        spendPubkey: '02f13a3804fa9018b38b783fe07d5c64a8a5e604a6f8b37b9261697431ad7ea88c',
      },
      {
        bip32AddressIndex: 16,
        shieldedBase58:
          'K3MSvnDZ8onaVW9nRbcuoBeRV41oPXszSaJqGo53jjY65f9vssrnA6kF2FZGMwfL5zDMXi5aR2E4GaFXWSGmfPb942MYd9hYq',
        spendBase58: 'Wi3n7f5e3hfV37AXhZoDoJZd8rfyGw2xHZ',
        scanPubkey: '031e90bc861ead987079ddbb49105495ec438ac32a516480ac07abf696de337e61',
        spendPubkey: '027c31dffb7de960eb31115dbb6360317837cdeaedea9f3706a762ab13c9a3ac0b',
      },
      {
        bip32AddressIndex: 17,
        shieldedBase58:
          'K3K4FgMYT7GM7Ru9dXbognHUwktnenqVYo85fxEECGzXDEEuZ8sCQWNtsnVjENe6tw854rWNReiQto3wuaLUc5UMpENV5R1gp',
        spendBase58: 'WhTDY8A5zkbavPokDMPUBtHdJ7h3PYL59s',
        scanPubkey: '022e6a852a614873980445c0c3f2a0fa96800502d7ca4e5ea179514f25f1e988af',
        spendPubkey: '02cb81de8fe613db1f8005e0778770b406b632014a1fb78ebf1989469d3a4f8b63',
      },
      {
        bip32AddressIndex: 18,
        shieldedBase58:
          'K3NfGgkpi7dkXxePCWcTjYLwM28gPkxyj5hG4TwX3Vpu9CEfSQXWYQAFmQVPNfpHgV96jrxiDyxT7GZ1UaD71fK4rpiqpAzjw',
        spendBase58: 'WQQpynRAX7r2UeAqji7qSfgmspMtdZs23L',
        scanPubkey: '039861e3932da26d63bc53528e44f141e506fc16cf35d6f17af941cd4334510c10',
        spendPubkey: '03011bf69e61feb1581b3b6c259fe131eb927e70207bf95518858ffff59b73ec0b',
      },
      {
        bip32AddressIndex: 19,
        shieldedBase58:
          'K3NsNou8BYbcyL7rMyyCpxGbJaMw6CkkrrX146q576KAojhVs89pyHFWTcpiJwjCiuPW5Qn3nHhSXRUwqZ7C8AqgAKXLUX4iZ',
        spendBase58: 'WmG5Lt5QmNJWNS5pWVr2d5AanarPpFDf4s',
        scanPubkey: '03ad58a2831aa02644cc4e9f545dfc1225e1a401199177baaed271ec00d1dcb317',
        spendPubkey: '022866265770f614d20e67eee14eae66a22b0f7a4c9e8ca5a58f341f59716444ea',
      },
      {
        bip32AddressIndex: 20,
        shieldedBase58:
          'K3M3GpwWyXgzQSTPs1qy6aV1Vadg4kxBv57a7bi7JkpVRzMJsSVAJdTjLVGuyu11zRaZAM9j8FXaVHpgUQzvu1drY3fBoxeSN',
        spendBase58: 'Wm7TGQMLtSNPYeFd75127tKCjwHKAfiw3X',
        scanPubkey: '02f59a14d9e0169e26ec8b14092f53009d6171f3b50ad1fe481df26b420df1b7cf',
        spendPubkey: '033c21e7aa39ed114036805d42b121b36e6583e726f91ef26a172c1324f1cf7c28',
      },
      {
        bip32AddressIndex: 21,
        shieldedBase58:
          'K3JhPT6Mf6DDfmkBPZ8hyrBhnLMdDqr41H5pJyefcLSnMWeyTKejLTVvfoZ6ySapvUKU3HY3MRy8474xopqy3hUabkjEy9UA3',
        spendBase58: 'WRDf8uEaCzskSCTvb7yY5rdr3t3FEMKuKU',
        scanPubkey: '020a48056916a77c0b005ee23fef40a08752e2052811f7346dcc50fff3c8da8775',
        spendPubkey: '03101e15c82abc52609e00b81ff8126b57b65586d8e528acc4b0216013e5b50783',
      },
    ],
  'upon tennis increase embark dismiss diamond monitor face magnet jungle scout salute rural master shoulder cry juice jeans radar present close meat antenna mind':
    [
      {
        bip32AddressIndex: 0,
        shieldedBase58:
          'K3PB4sCEhVpvkxupsJXkCkv1TXFUCwugoDaa7F6JbShktmKf7zYHoHm6xfvUHqLoELoHqskyY6hW5hTQHqqvALMre2nX1gN8a',
        spendBase58: 'WmJAf2GLS7ysHKXwtimjawGn1awKmUTY7U',
        scanPubkey: '03cbfb66101f8fdffe4f7cd2bec03e74e30b304608f6b9b37d429054610c81a080',
        spendPubkey: '02c495a0c185174311a5c96aa758dfb5896b6c6613043cfc95df086902ae630f75',
      },
      {
        bip32AddressIndex: 1,
        shieldedBase58:
          'K3MmhRiuEJJEnxKdfd2WgwPexPrrRHxA4DoEgtxWLUqaU7s4SzHMwn2ahattxcVm16ii4YpC526bWCrkC6kmv7FggVFGZPq2A',
        spendBase58: 'WS9PjxKSjcC4FHgUKDcLctuaGPdZQ2hHUb',
        scanPubkey: '033f11e96a5800e8cf0307a81f268b2a773649d0ab0866b3bdda7a6ffdf2af388c',
        spendPubkey: '020958fd08723484ad6271eb631012e8c5385428c1ecb3fda885700e9a5997c589',
      },
      {
        bip32AddressIndex: 2,
        shieldedBase58:
          'K3L5HiDuve75c7z342v3C351qZjB6d1ZDKu21jh5NBthAuwQSquhdm2Q45UpuThvaq41DxH5wHXjDUapy9MoonzzVNVTHZgoj',
        spendBase58: 'WdZouPhth2fBgjGtgBGd4orz5yaaN1M7Nq',
        scanPubkey: '0294a670875178106efce5f6d8fc812a23ece7b2ceacc1d64c7b58a921c36ee219',
        spendPubkey: '0239214c87adc4f1c28784b16ed953de2b2975ea54b754b9c308cbd049133f2a02',
      },
      {
        bip32AddressIndex: 3,
        shieldedBase58:
          'K3LCNiLR16RrwNkBhu3r4KxyLF1KHF7pYEaDNtyZ5G6ZuSyD4zAY2hCqWSnXhmFzSre2GWS7ScmyjPVsdLwoKo1zS9B76eHRh',
        spendBase58: 'WbbKhzZj57ameAnC7is3Y1jK9VPyeE9nY1',
        scanPubkey: '02a0ebf8ebb43ca9070d0803b0670ad54ac7eb6bdf10a96b6d05f8768470e381f8',
        spendPubkey: '0389ff339539e1ebf473cb86a06f72f99aa6f1669d9fe9d7b4f62ad52ee3631883',
      },
      {
        bip32AddressIndex: 4,
        shieldedBase58:
          'K3PEnKp3wHvF18ZYpfk8xgoLfQrXqY66kxVfSS6usxDEKWKUvwy5xQ3qHwrCYmp6N2PwKYuveoX5FukRgVqtS32qkRitRx6ST',
        spendBase58: 'WiBLPhnwN6k1ta4qaC8PHdVmJtqsd3hbw7',
        scanPubkey: '03d26a479850bcb7238961fb5af1b0c8ccc58055942aebb3739d29f234a9f274a9',
        spendPubkey: '022b723c4827442f71887aac33515273488128f4a78358a87ea5ae2a3ce46e2b24',
      },
      {
        bip32AddressIndex: 5,
        shieldedBase58:
          'K3L1C9YoiurTrVkrtTxgWGkqvsRn3q1w8yM4HKeaFNNbpJxP1kpRDLDdyWyJqppNmCkDrd3g5RorYbqTq1zjhen5qR4eWdEPK',
        spendBase58: 'WdUtvkAXE74nHvBFhC9gNSy5chMbksqZ2N',
        scanPubkey: '028d8e99ecac4a8e1e634465ef81fcdbb78785649d439235458d6584589dc4d901',
        spendPubkey: '02581fece725f64dc3182832e5e34755d0411dc10726acd25d8d4917579eb26b1c',
      },
      {
        bip32AddressIndex: 6,
        shieldedBase58:
          'K3P6m9hFwN9mQAnGttCQ778QnQvJZepJ7AZ1uDeShopNT7YHcd48dC6gF7Tm2cPVicgiX5xgxocmmTseHSPP8fuWx14mTfESA',
        spendBase58: 'WSP2mjJPFAVE97uELrNkALswJvCH8ZpzXp',
        scanPubkey: '03c486ac9674792bb82697b6e575c4771abe109c0270b16598fb2603f751255c7a',
        spendPubkey: '02c780eefffffb7b7ad4d632ceccbd5c9292ef774a82b586162f428b77ef69643b',
      },
      {
        bip32AddressIndex: 7,
        shieldedBase58:
          'K3Mp37dbMmfpcaXqjL2vV6D7UD8Aqf1tJVt3W5ytgr5YiKDkyyro3h4ipVR5H9gVGeHHjWPTPQkXzmLSv4KFbD2DraQ8Gg2Dg',
        spendBase58: 'WXNFeQF9bM4xdhheorvA6zSu92FRfd3Bqb',
        scanPubkey: '03431f0e800902a9afc786b9cec89212fd437c1839867e1c8f727d8f9fbc743112',
        spendPubkey: '03d951f91f399263046ca06a79097f72a2afbdb44cc07db8ecd6de8c1037fb333f',
      },
      {
        bip32AddressIndex: 8,
        shieldedBase58:
          'K3P3hL9zGoct2MZzRVMb14gAG12YR6SJnP53sheCG5S3B1bKvVRQQy5WFzacyF7GVYs1et6Vc9c1pvZCRHx54qyPVghG14XnC',
        spendBase58: 'WaKHoNvZGuuLTzmppJAphdbUZi7DayL1Rh',
        scanPubkey: '03bf377e1eb3d7f68001579539a12293f3f4cbcc75a282e929c6951da28880f21c',
        spendPubkey: '0354f604260901c0859b045812e2cf2f6832895ece84142188e0c1950fb5e441e5',
      },
      {
        bip32AddressIndex: 9,
        shieldedBase58:
          'K3L4rkY6LAaFkuXn1bqTZEnHVYymY4kFsAYuBs6iNU33DcM2nMJZu6DVQ8KsUMaHvQBBja5S3MGPNueWDNcaUM2SoJ9yiva6t',
        spendBase58: 'WgWC7K1yTw8tE3DF6G17rLqLjZfTVbaZZ9',
        scanPubkey: '0293e7a78ff910e0119bc8a56260ff0f3ce4db4f820025b9ca98dc764b94176ca4',
        spendPubkey: '02764d79c9783432d2ab421459c68bf0e7f0db81d03730fde4e037b3e124daf9dc',
      },
      {
        bip32AddressIndex: 10,
        shieldedBase58:
          'K3NAabvD4JEKWCaPtSWHUEfXr75xswooJPmN841UuK7FM5PWqdhpfdUGJ3trEzdebWJresdhpd7L3odMT21CHsCD7yuWTrx66',
        spendBase58: 'WVZjUyGKn9xnaTSQCNGHyLdpejqwACZH5C',
        scanPubkey: '0366b24eb19efc5f9cdd8b10d1423a0dcce4b0386975c718c3b866d5e0443cf644',
        spendPubkey: '028f0d158de8273cba859401b0283e8c4902074edb9836de07d3b2d5a617b6f465',
      },
      {
        bip32AddressIndex: 11,
        shieldedBase58:
          'K3NUbiJPNQvaBEFJKiEjTvRmRL5MMiXxTBuLapJQrBfLDMDYxWrsK7az8FyUZh5xgt9qBtcxqwAdUwAqjmnsqTsEnCc3EzmDR',
        spendBase58: 'WSjQL2UNXZ9FbnJbnF8GumkiK22F3yTYCH',
        scanPubkey: '0385e6b4dabeeb2f4b43bbe785b78a9eca8c6032f51b24ed1b5cdb299806513f46',
        spendPubkey: '02e367810ed7b38e46612f6f708b8ed0415b8d13394341dac991c4fbded1bc6443',
      },
      {
        bip32AddressIndex: 12,
        shieldedBase58:
          'K3Kmk1F8wfodGQRR5xN9WEQ51RRrQJhVR24UxQ7EqQLZzK87fMYMxyD1MCkWsFwyygms9sjrLjxtKM1tb88HHeW4iV1mMHzce',
        spendBase58: 'WX7PxQpuHNXyaEnjrDDUsmyDeTjoVcyhSn',
        scanPubkey: '02764380794672a324cc64d56a3277ac06b239843223c4f93e94fbe2a18607926f',
        spendPubkey: '020a8b8f2a7230aeed71b4750127c1b6ee9b052541214bbde35cb04d2e717a2497',
      },
      {
        bip32AddressIndex: 13,
        shieldedBase58:
          'K3Myoon9aQaogcfWQANfPZzkzRiFDACmJ28CcyWLgs18EwqcRTAc8xWmLLsyvWczjXxuhNJY1VwSvXWcrvMPWq9yUdifqfLno',
        spendBase58: 'WfoMrFU6wyWnBRM7QZAqzwiQ8hYG8er51J',
        scanPubkey: '03540a9f78be8327f1eafe838a28b7b4bd690f3e5e054cfc712f65d0bff18d31e5',
        spendPubkey: '0231e8759097701cddb6528d07cbbab9c352596099407ab87323417170af058661',
      },
      {
        bip32AddressIndex: 14,
        shieldedBase58:
          'K3KktSVVswfCfHfnF7oVSAH2M311LgwrSAzSrH3AmTUbxpg6P138pgRzYwCgMoTRrwHYph2BfemRnjEuGz7RTrrzsdwYNh1Pf',
        spendBase58: 'WgEQddXozRK2esHCqik7A44oAWwTnAeyao',
        scanPubkey: '0274c8a63a5ded46c56461dda5628915922d2abfade03ecee762a54d80bb3000c6',
        spendPubkey: '03157277767afd8947a8ee55df30f8ee5b1a6855048eb0e9dd8678f0d156ed007e',
      },
      {
        bip32AddressIndex: 15,
        shieldedBase58:
          'K3P75jdxh2mWL1LJMSYFFQ4maLtw6iKcEda5up3Pd7XLT85bYh4S9wMesHmbugQQXunA9v5e6NLWCHgrskRJc91BsZe5a1j2P',
        spendBase58: 'WZ86TUx9UfFmcn4QozAfWzE2SrqXGrfcGZ',
        scanPubkey: '03c514bb6d601c062edbc2e431b1b95b5f723d2c6d02127dc1723e7c5a98e85217',
        spendPubkey: '036c6f1f23c8cd671502ae295f7a7ced374f490856ce1407898b346d7131100ee0',
      },
      {
        bip32AddressIndex: 16,
        shieldedBase58:
          'K3MPLGQhscF4gBmGqqqTvtdphA1hPkUjkCFNJvePfk3Qo82KRVUtYtGbHGXfxins7VDwbYPF2Ze6cZz5ivoEvYizyH8XMubDv',
        spendBase58: 'WZaVriB9m8YqSrggbsYxHuxQ8DkJ9xbRvh',
        scanPubkey: '031856f0af8818c8f48d0ad1f7c0d0c1d68bc8f2aa16c66d0ff55e730cd7033c27',
        spendPubkey: '0309496c5494b861a52056c76923b35ff693cb36d60c96271e893f3af442bbee48',
      },
      {
        bip32AddressIndex: 17,
        shieldedBase58:
          'K3NeRHJqWgEsJkHZba7nE8Dvg7gd7z6F68sm6Pdwq65Yi8pPVGwGtcXjkGQS6CVwBcXzPjC4vokHaGxKLKGeojiDSt49M19Cc',
        spendBase58: 'WfPbFkBYN9Fu5RPHa6guzrKJM9c6jRZB79',
        scanPubkey: '0396e8433b9351368262548f5dd0868305c72e97680a1073121596fb79e1eb32b9',
        spendPubkey: '039c0438ecac033e0f3783175597497e6c148ebfefbd4776786701cab4b52b3df0',
      },
      {
        bip32AddressIndex: 18,
        shieldedBase58:
          'K3LfcuKwy37Y2sQwUdP6fksEtKQvRPpDzgCKFLNAjd5YY2iWzfxWkw5yZ25PfeVxbk5mQm3ZjSiWQSfbmWEjCjikBnMj97Ktn',
        spendBase58: 'WUVAXRc1r7z8x5MDr1WGPhd3siqPnXMUB9',
        scanPubkey: '02d01a4d85af29a7aea8ebb961005a86e9efbc2bf1e2a82a0047164cd072355151',
        spendPubkey: '023c985840bc5e1367d95eaf2e2779d3d9411ee22573541aad72a83f224059568b',
      },
      {
        bip32AddressIndex: 19,
        shieldedBase58:
          'K3Ntn2C9vqivTNm3Szv1jM3uRoQUxhS6FTsf8KXBQpgRAnPhkRMKZgNf7D6EszZfDWfU4pbpXJMwwiHUEjMbdVHjrB3Zz5ZiW',
        spendBase58: 'WXGx4YfWnkR7T1Qe7dDtVomBoqbudS7xgR',
        scanPubkey: '03afc562dfe122a1be233da403d776546a0b63ca4dd9b062770b13864934b9fa15',
        spendPubkey: '0352ac8637659f2d2e05cfd30079e960535724001336eac28356f61c8c9265daf5',
      },
      {
        bip32AddressIndex: 20,
        shieldedBase58:
          'K3PFPBDDiXghuiNR4yJs8xbxuYzuoVkfqEQMiE6riRUzh5EdRxzzfse5HxZaFBz2hnH1egxNDQDeUqSL92JQH9RFSqjCi2ChU',
        spendBase58: 'Wgp5Q2na2jbociKqKB7u7JqQTQKw82ey1i',
        scanPubkey: '03d374ac0ec4e0e04e3f7030a6e20111c80cbc7bbe8bd73edffd92e47d1331b283',
        spendPubkey: '03818366f59b7452d62755f0216943937b730d4ac93045d08c456afd6a20b7bba0',
      },
      {
        bip32AddressIndex: 21,
        shieldedBase58:
          'K3K8Gd4NgAG9FdrmwcRJGJpZZLVRdLnjDr4iJXDP1ExnQYt7b56PC9SXthaoaDLGoeB9jFwJNjcsEfnkosZJCfWt9AanX4Jx2',
        spendBase58: 'WY5DUAdcdGE6QCiYhJ4Q5z45Bn8rFQcrE5',
        scanPubkey: '02355f0b30724cf1f83242671f614825a3c86d1e0dac7902814abc143721535a12',
        spendPubkey: '024ab2c5875ac785d209c563e762802526814a53da0af8b3daba4e97c43ae13145',
      },
    ],
  'sample garment fun depart various renew require surge service undo cinnamon squeeze hundred nasty gasp ridge surge defense relax turtle wet antique october occur':
    [
      {
        bip32AddressIndex: 0,
        shieldedBase58:
          'K3NMtDA9Ng1ekAU97K8u78uoBPrGDXPeBfMcPnbu1J6mi2ZBfTfwhSkA7s2i514A1hpVckqtbtbcXKffipYtRHPLWshaVUvBn',
        spendBase58: 'Wj3LQemZ66GvfrdjSyFUpthRYTGE2T2Ctk',
        scanPubkey: '037a4581cda7c03f5d582577e1aee4bee15bc93593d0995b3913e6265b94ea3004',
        spendPubkey: '02cb65a662bf8c8f8a7bd71a4b88e08d3c003e69e7ec1102bb4c5a680c4b0209e7',
      },
      {
        bip32AddressIndex: 1,
        shieldedBase58:
          'K3LjZSmZaDRaHSTVYihKjhXB6FtKwV28K3jwRVNjnV3rJpdyCeaPnjpP37uU4jn3bKNRizQRspQ1xyKFpCUGr2ExmjJ23wPWW',
        spendBase58: 'Wk4tRUBBHsbbnzj9wWGY3kHaNspPfmjsvH',
        scanPubkey: '02d6ed2fb1e97b855f21226b2f91f3fdb71ceb6871083e3feeb24bbfb316ca4f53',
        spendPubkey: '0247d00049cbd3585d7b531b3403cbd95e0b1f84755e00936cbd330bfb00bdf102',
      },
      {
        bip32AddressIndex: 2,
        shieldedBase58:
          'K3PWMy3rr1SCsaBH73EzTKEMwwRs4FMBEz5VkSwVbviuP9tF82yrjj9URitCB2jc3Cd7fDQYFtghKMM42zBQdC3v4tfc6YYVW',
        spendBase58: 'WdP5vGDfgaXqkDAEjVgcqbpMtHdh3qgRZs',
        scanPubkey: '03ed655abc5f7cc8b3be987807344aa934f6398f58dc65f79ef4aa013d8c90ab03',
        spendPubkey: '036dc29e92743c8c60c7bcd2e28a7ca81ce625513843b8423c82d91483d3f7d3b7',
      },
      {
        bip32AddressIndex: 3,
        shieldedBase58:
          'K3KfSKWJEARbw8zd8LoSi4Td5jsjSGRX2HBYjeFMnAUWyjFUcbWLThxQa6EHmqn21JsCjkn48KrKMh3yYuWjabnNZGtTG8qhS',
        spendBase58: 'Wbmw3qxbXKNi7mHg9BSD4THMWc9cWj6riq',
        scanPubkey: '026b585a2df2f5dbfcdff22bf0ab3ba04d3c33a053599df0f24a16a17f6acae894',
        spendPubkey: '02155257e2d67de05be0ac05be452d9054a23a3e6cff2207250fc52e7c517e0f8d',
      },
      {
        bip32AddressIndex: 4,
        shieldedBase58:
          'K3MJRKNh5ghLnep8UpRpEeKdGQDHCkNy8qFAEVZkWiGDciBRThPHxewc8gVTcZH17ixzavUPsYEdna1D7gwcYceAueJR9rPaQ',
        spendBase58: 'WXusBp84Xy5p3SwLfnqUmgeobkS4Tj9TDZ',
        scanPubkey: '030fd4e7f3d3f7f6c8d62909954c7e02d80f505bf5081cac683810aeaf30dc0cce',
        spendPubkey: '031a1d4c0925cfa0908c781853bf1a61cb51b25e49e8df0e35d36c223f94ad4c9f',
      },
      {
        bip32AddressIndex: 5,
        shieldedBase58:
          'K3Nn1watvPDCMjpdhshEFzYiRcSuEyCDkQDiEwdHTQYTnzTNgnubK3GtrXKEaUDH3wME2vgAbPFekGMTLi74X4dC565yyWR5J',
        spendBase58: 'WcYixFpgZMP8WyLVrU96hm9wCTAXQFudcz',
        scanPubkey: '03a4107d41e772e46b8fc369c2e319eaceb1708c8a220b274b138f42b0186e2c0f',
        spendPubkey: '026db54c20b9f8f6ad666b15d2b0c44c1a26292f24e2d0f0f82bc0c5fb55fb9441',
      },
      {
        bip32AddressIndex: 6,
        shieldedBase58:
          'K3LJEJ1GsSCBon9SKH7oaVkEijCMS4RxHv2YWY8ytaf9AsxvL8aEeqZH6kJU6V6CDHazy5zEZKWNcerbn8DEgKQUeMXmoSgRn',
        spendBase58: 'WRgPVaQuFZtT7xWcSSD73GTMRsJXJkcP2L',
        scanPubkey: '02ab0f96b3510aa9a6b95ec7af2214142b69efdea437e9081767edb1d78ed425b1',
        spendPubkey: '038cd7a77a48bf845a7de0c8cd3d0119fe9bc4d34f07b2add262b98ba6c6ba3629',
      },
      {
        bip32AddressIndex: 7,
        shieldedBase58:
          'K3LV9MpGNTPw7WAktJdzNCwBiYcLq1HKDCdq1sCc4qE6bcBuHgJDVefw6yEwy1XBG1zWhmic2Pv5VLG26qBpwBGiJ87mkUR3f',
        spendBase58: 'WX4WwbRF9WXt8uXaDDQLkzDsFrEVtpwXEd',
        scanPubkey: '02bdf67cb635ba9146aec395bff48ef548cc980e6c90ef4aa93020c5846cc5a543',
        spendPubkey: '033d07e1d61c12e86a98fed08526817cf8cc7c7b3755ff34d6351526c222097c9e',
      },
      {
        bip32AddressIndex: 8,
        shieldedBase58:
          'K3MmtFF9VhtQyjcLdt4UHNxEncR2BiBGztZmTGQxF2aTkT5sMzK9WAopc11AMNeBWC3W17ca4FNgkcA5wwNKF1m3pmQzHj1w6',
        spendBase58: 'WcgGSvQx9g2us8ryUnw7o4arCTmmoKK5mt',
        scanPubkey: '033f649c44058835b884161a6faed3f19b0d5da4dcae5f0e20c8e41d0fad30bca8',
        spendPubkey: '031eccad92ba20ae35db5155b466c7f92cae8f9efae5a8ff141384134971b14909',
      },
      {
        bip32AddressIndex: 9,
        shieldedBase58:
          'K3KrFyMNg7KRqWeYSPvvrxeG6a4P9sNs3R8hK7pzSojNoHZFoxkK5d4wcNLCF25BRKjxmMWqQtvg4YCFN9RwbrG6FJbmHj6B5',
        spendBase58: 'WiqRjsP3JzAAEnpFdZGf2BEe2tD86cwYx3',
        scanPubkey: '027e15dfe81b2e16363122ebc927dba0ee41a59d70f255600fe1aee1ca47a2c463',
        spendPubkey: '03c258b0b3f8effc3e8e8c6559da66e9680f027f867983fbfeca7018deccf6d735',
      },
      {
        bip32AddressIndex: 10,
        shieldedBase58:
          'K3Md4KqigDytv6wCY3a7Rcn6ez1P46Yjc2KZFXBPNmZVtGgCHWXoLaKbAskXDxe65DAQxzESBN1U2Z3ydcQwF8KkaG8aveiTH',
        spendBase58: 'WVaZnquyCkn38MKZoBYzbGrWptyvyvfxDN',
        scanPubkey: '03301bb1e47a0a7d58a4f127682b76bffd2256a3f483eec30fc58e0f34471f95bb',
        spendPubkey: '031f7d02bc15af4f6bd648cab0c674483ca56f3f70dfe336ed47dab9b59d852559',
      },
      {
        bip32AddressIndex: 11,
        shieldedBase58:
          'K3NVHaMkf3GqZd2f2ej7Hnx6QNKELtg5TJZvpJ99pEYf2b3UoFPSxD1RZ3NeXgtKXH2ZhQTTyDim1iPfevchP53Z2FyPGGrRZ',
        spendBase58: 'WjRV4xBf9QsKiwHq7LTA1R3CEYwCQ8r7oB',
        scanPubkey: '0387176756df91bd222a8429b4981ac0bc7b04c02c844d8b2f82c44bd62dd888d9',
        spendPubkey: '02eca81ae78993688538259e09d39d9b9347d6b68f5aedd57319f318d935930820',
      },
      {
        bip32AddressIndex: 12,
        shieldedBase58:
          'K3MfyFt3TCDqTh7HzcQTiWX6mMqFjNkubKobfSCwBfpxgg1YzD3XUdtbarZZD2RuT5iEjqEhQhyC53QKsr1dRg7u7BxK2Ngh8',
        spendBase58: 'WUfkQHDhM3PZskZd4bqJavPmZ6V85m38kG',
        scanPubkey: '033526f0d68ee33f6f7ff87c66fa168a1f5838549e7f672a28f14bbd72e0efac10',
        spendPubkey: '020c2ea9eefe58e8a9df63723f6eda25f887a4c19598ac96a0ca806e2971b2b5bb',
      },
      {
        bip32AddressIndex: 13,
        shieldedBase58:
          'K3NT1MB3qvZ8VgUXDjPbEvL1qVoD6DmtEVCPa1UdXbiswYDhpZ1rZgHjcHgTvv7As27TfRf7y3477zaPX669c2ARta8MQvkGc',
        spendBase58: 'WRxDWxcrwGYDrN5FgDvUUGe34RtJFHxjJy',
        scanPubkey: '038324b620e97e7b8954ffda11ae61054cdea44b23ab680ce6ab69e5dc5bd2362f',
        spendPubkey: '03b55ec060cd32a318bf142668c572f97efc6ae62abcff5dc265c4339d5bfa4715',
      },
      {
        bip32AddressIndex: 14,
        shieldedBase58:
          'K3NSVQjDegnPsjmDoP7ZstAYZZra1ijmbaxexapw87ozMaGnphSD5YG89ywoinhn1PhrdsMEVN4KvKprfFynteLJNVAG4Xv2S',
        spendBase58: 'WhKJs2yd34wgzEpFPNS8pQwpk2UtaoArXv',
        scanPubkey: '03823fdf3be9f6824fc2fcddca1cf0b275579a7bd1b0be83a6374e44932d3ca969',
        spendPubkey: '03463e3fca65ac643de7f32368313e5a6ed366425992186c875792eaa6e6ecfaf9',
      },
      {
        bip32AddressIndex: 15,
        shieldedBase58:
          'K3MdhYKrMH6QbxVMbnDQ8yiocnP85Eseep8CjrtPHcQvSH4rmaRG23y9ez927Cn5ic8e9G7CPrpKebok64mC6skbBVQ2umXXa',
        spendBase58: 'WmmhwTezRGbbcjyPjVbXbi6eiCZXRgtkEr',
        scanPubkey: '033138273ef75dbcd2c76776fe7d2ac0b1b44a6342611f8aed1108d8d54fce7699',
        spendPubkey: '0338942546a091386162319f0fd3f795280f0168bb12563788701c0d1d37789477',
      },
      {
        bip32AddressIndex: 16,
        shieldedBase58:
          'K3PHEGDyD6C4R8PHF4p214kmUd4uAWDx3vA9PmXqnKAqzWmLLb4xeFoTsSRBtVxuiDxaLRFrcgffCJ7Qrv275F4Annqmy5Dt8',
        spendBase58: 'WXtponc1DGFQdxsvq6NRykGWo2xG9dHCtT',
        scanPubkey: '03d6a73290ba03355c2fd1e093c78ff44c0c2d1f55f15cbb69586822f458805c2d',
        spendPubkey: '02bc0da11c46273c43c15f359ea28aa2256b98fca7e0a5dd343023fa7946ff6ffc',
      },
      {
        bip32AddressIndex: 17,
        shieldedBase58:
          'K3NQiXQqJSvsC2UmUvd97ku1h8ZXn49vhNJ77pr4ZcQqKu6QcLhcTU7B4vM98NN5K4wkrb8jd9WPLMXrd2KNSSWp6sMNRJvdW',
        spendBase58: 'WTtzY96a5g8iDagq3JCzJwpPDNSnM1FdBf',
        scanPubkey: '037f2d765b9351a42c74dc78624f6bea0576ddb71dfd44a0bba64193454b4fa350',
        spendPubkey: '023be2672be32d966fdcee8d6fafd1b9d3accd3ed717f52770b60c2ed0ddb8abd1',
      },
      {
        bip32AddressIndex: 18,
        shieldedBase58:
          'K3N9KVN9R6DLD3dLbGZ3g2PAZybhdBMBws5gSRegEs83eNXVUT98i397XA533kKuYYAkriBmEYt3DBC2Mwt3nkn7ZmiHYPLet',
        spendBase58: 'WgDJU4CfLvyhdizb9HJRpnLeC3S5hgP4NF',
        scanPubkey: '03648376187d0e6e89b75aa6bbf6b177f4850928682400390a2eed7a12d653b0ec',
        spendPubkey: '03d335bf7d5b7b7d1d99e3c61f14644c389b6eae22cf1ffe52e5f700abfd6433dd',
      },
      {
        bip32AddressIndex: 19,
        shieldedBase58:
          'K3LargQovPe2P7nTUMatRqpiNNqKkXLjxLU9ubp8VHD4NRfGxhPrVQHxJ1yM5PLwfk7Nf4JU3Y8tXqQsAaFLW5XWv4su8imYS',
        spendBase58: 'WWYxRtKbSeRECam4tTkv91kh96Jyx1e89g',
        scanPubkey: '02c7daf7d661d528c16b845bbd0f587315f4268a06ada128990f62843b0865a344',
        spendPubkey: '028f3a550884adaae8146628731d7da5dc44d3dadcf1bfdacec03ec80e2860b76a',
      },
      {
        bip32AddressIndex: 20,
        shieldedBase58:
          'K3Mytdf4iKDi2PXfQhJ39yU48bvGLrjnrQdnP7ExrEbetRqU22jM8HKKgTNzcDqF6PXvEa8Mg8FGZUzVhQ8ZuEzSRx2pv8rcz',
        spendBase58: 'WNmogmpfiVHzFHAFbRVYjJqYTBoW44JbFt',
        scanPubkey: '03542f81c81b90392e320eda49cc5f8c26058a93528cbac824888235e1826561e8',
        spendPubkey: '021d64d7422921e5126346b46873ff75a53bc4b8ad5ff431613edee3edbf7b8263',
      },
      {
        bip32AddressIndex: 21,
        shieldedBase58:
          'K3Kkj2sdPcV2NTrCpuqe3PjTACk451oXnWLGt8uHQk6HrzK2XjHRukFxgk3jrev2EY1aEutkJ8rG3NrK67mH9q8KZ14zpxTyQ',
        spendBase58: 'WmCEqbQHKCjYERJY9j3SJ5Di5Z3FRFxy97',
        scanPubkey: '027480be8f892ff8f2be1b220c908fdb670b4c3d9ac0208ce87b518c6d411e1578',
        spendPubkey: '02c7b6995798858a0e279d40f0cd7b3545b1025b5214bb29a248b44bf85a777c26',
      },
    ],
  'intact wool rigid diary mountain issue tiny ugly swing rib alone base fold satoshi drift poverty autumn mansion state globe plug ancient pudding hope':
    [
      {
        bip32AddressIndex: 0,
        shieldedBase58:
          'K3MVcvvif9WfjYSSiN62dxebdASXi7zp3gBa2jPx4bhKfaHLfWWpJk1uLUGNds1fKdc1thMvbVKw49d1ueKzscP6XDq8TiwMA',
        spendBase58: 'WfLP78twW1rpkY6cFD1smhMiGYMidM7TXu',
        scanPubkey: '03233a49057001db743494cba723bc5288ffadbadc65b9faedbecc9d35793863ca',
        spendPubkey: '038c1d9a93ae5744ed93671f019eb98f61c586f0f0562ed161a7ac521efdaa5a28',
      },
      {
        bip32AddressIndex: 1,
        shieldedBase58:
          'K3LGmcSYCbwZVh1KNnoBB1VdhGRmPHHpodiVanHnU7PRFF3H4FPSuZVY4YpVRJ1hw5ERaqi5HvK1XWYhYbZZtzpWQaoakwaR4',
        spendBase58: 'Wm6drGNrishPcfY7xhYF9McvEePX2LAMU5',
        scanPubkey: '02a8885003cdb09a263ed2ed1aed56c6582c45a8c3a970f7b468b1de7a01e8f424',
        spendPubkey: '03812fda35cd7e40b36202127692a9c43411d2afdd03e203c6105a7094ac0e2767',
      },
      {
        bip32AddressIndex: 2,
        shieldedBase58:
          'K3MduhXAiJKky8Pq1pnEEoabBbt6UMYh5aynpcyqFNEFjY9yigb8Pb57JMyQfaNMCfvUya6LotsWfCtMT2rN7i3C8hqU62FcZ',
        spendBase58: 'Wk4TWR4eeeufENc4oMwX5ydRR1atYAKNZg',
        scanPubkey: '033195169755092b3200e3f0bc7e0338ef75de2d70a6d1218444770305126c2e6d',
        spendPubkey: '02cc782bf7619b8bb2b4977b3d556fd4ad7edcc11d39d20c8f22b90a2e1f6422d6',
      },
      {
        bip32AddressIndex: 3,
        shieldedBase58:
          'K3MzJzJBw46MypvtP5LcS7gaRs7ptDpHsitrrA7gYXEvM41beHC21NdDAD8cGF6SndikmPkiP4HhhRVMAMDt92VdEqinpeu1u',
        spendBase58: 'WZuaBMS4vrA2mMDaMQxDW8MJ9vq9YyNAiP',
        scanPubkey: '0354e9ac60330da942fce6b9fdc34e24d1c8ea63def45029d8600a6a0700a9b19e',
        spendPubkey: '030460d2c102ed9995e061dac6f83fd122eaa5b6ca2b5f567336602ea3c146ffb2',
      },
      {
        bip32AddressIndex: 4,
        shieldedBase58:
          'K3NiearLygUAkTZ9fmiKZgGWenq2iG4FD3NP9Zk692sY185KcJwuUZYt9ybEfRXiuWcE5FhYRVg5kicdXEZ8G24pruUMhppJp',
        spendBase58: 'Wc3abFKzimr6Ph23C9xSCtxrv9b7tnGUBF',
        scanPubkey: '039e3b41715a987757d7945603e6b2c9d653d1ae05829328829f5406f398820b33',
        spendPubkey: '03b0b7cc2b3bcb03dc9168286bb88883c192bd9d58b1ee503f7651a12cf32965b0',
      },
      {
        bip32AddressIndex: 5,
        shieldedBase58:
          'K3NWb2i46uJCQVEWKk3pfvpfvwHQBN2vivEakukBA1exrcZnxBoiwe5eWJJj2eEHnKeJKH825UT8dTwwERjSX2ZMnd9XdyBWR',
        spendBase58: 'WaHifrDvUwEfzez4LbDqh3RdKUnnEAy6Jn',
        scanPubkey: '038958255cb2ad7d71cd24449e5a123f0f428b93d6299b3185344ce4506165a472',
        spendPubkey: '02e9100716bbd44134cd7df2da5d811e8e16dabdcd0d7f664ad0a7fe967617b683',
      },
      {
        bip32AddressIndex: 6,
        shieldedBase58:
          'K3KRtW1xFSTfzETHgXn5qb3LFv9mXxbYSrkeaURmt3ybyMsyCJbEt3jyRahYCGQkiCTzNpHTJdnPRNoXJUYfHcSPsTocwLmcf',
        spendBase58: 'WY4Wc4Ww9UndEjgrNKRZpSRTndiCmGAMps',
        scanPubkey: '0253e1def684de7170476c5f9350dff7fad0a03ce0974e3bf19539a1b30e170f5f',
        spendPubkey: '024ccb0928f7ee54e4cb31b21468f9655261ea3287b29358e6921f906f927e5659',
      },
      {
        bip32AddressIndex: 7,
        shieldedBase58:
          'K3NtMc4aaoCJt3dSjTVHv1kxcViFYFELViSCpN8yhBw289r8ddRtMzg6wd6pabK3TbcyFJVry7XPEEuJigPe1JBCY6bdgWB2U',
        spendBase58: 'WZSTtoGtRjqure3YN9fbG3ussxd5xgAmUd',
        scanPubkey: '03af0ac2850b219e20109d059e84f4159f1b6effc70cbc81e7d884135d15b415d9',
        spendPubkey: '031d589a179f3975fced7224bef1b790c8083853df896e67216000d9cd03123bc1',
      },
      {
        bip32AddressIndex: 8,
        shieldedBase58:
          'K3JcX5CFzR9qY6CNNAYwS25S4exxsAv4HmXnrkzpzdpB8piptQsd2nMUYQPqLbutPJfEtYjZztCqtkfD6WtVhhvZttS8E48Vc',
        spendBase58: 'WcdeVck7YakCAxi7KCQFCTb2dwBYELS7JN',
        scanPubkey: '0201d9a421e0f40df349cf26bf932459733c2f9ac8decb3aa6208caca22249e15c',
        spendPubkey: '0282fe60a5315cf5654b2d4959ded69d4a17dca21b1ba51aa9b82b1afe6b1eebf9',
      },
      {
        bip32AddressIndex: 9,
        shieldedBase58:
          'K3JzazktAV82HSxLCKakHBRfMa6rZkBJLrJo9WLVt86Q9CkGiXdWP9HdvVyvqghVEpLU6FxSTqQVSxo2D3fZVZkmKvfDnzV7o',
        spendBase58: 'WhP9YtRcRzyWar4MhsRokfK8SymCzbcb7p',
        scanPubkey: '022810dc00a6fe2ad3e0513783efb9b6de1d049d10f66914c7be24bc110963364e',
        spendPubkey: '02f72300d3e6c415224fc7c8ba104588cb484caa44b58a58346fbcfe2ae1dae2bb',
      },
      {
        bip32AddressIndex: 10,
        shieldedBase58:
          'K3JmvGWhyuKYdEbWJtpd5De6ntpCdDaRAZaxTT6nRuAhf6WiGr5iwrD9EpxqLSgrnRRqeqfso6Q1fg78D8aR7WGUQ7jc7xcri',
        spendBase58: 'WR9PTvtMNWtcMc6GX2SwazK2SUQjF8fiM9',
        scanPubkey: '021220e4814caf2f9623d087833ff9355235405acca5113bfd80eeabb1c61b972d',
        spendPubkey: '030a18da6dd2dbf3ce9188ac85cc53ba91deecd1be9159fd64eec19ba8c7a0ba63',
      },
      {
        bip32AddressIndex: 11,
        shieldedBase58:
          'K3Mn8jNZRSWwiKJPCFLx5544D436sPdC15Ay3ErSXBdYqYt2SDj4AWjV5uUadxrqRW8dmLmzdsQRrqwDyNDBbeXYEpvucrkdD',
        spendBase58: 'We9yM6MHEFjbefYBzqQ1AdKwtGKA6HBPCQ',
        scanPubkey: '033fd353de75f679798803b35710df6fc29afc86fcc4651b5c04e5aa45656f1d2b',
        spendPubkey: '030b132fe2edbd7215b63f14ae29044c19916fa3eaf997f6d2838aa9873e610ce3',
      },
      {
        bip32AddressIndex: 12,
        shieldedBase58:
          'K3PHz1kWvueFjrvXBNyKre1NMQdRqMuvq4xW3w3mY5JkxtFGwVpbQKfMZFDjM7X6keXosbvgE6Br1byNkvYBLhkw3dAoDptSe',
        spendBase58: 'WQodjicdaUHoP95rvsnKcoHLXYvN862Dd3',
        scanPubkey: '03d7f59bbde6d32a1bfb59bb1e51b01a0f7e456726cbfcd31ca942d68596806341',
        spendPubkey: '0356a3686f63c59247fb0ee4c1565d0a9cf4f4e851485469cbd9ef06f9f34453a1',
      },
      {
        bip32AddressIndex: 13,
        shieldedBase58:
          'K3P92uUbsfPa1L7Rckx6p6Xb1AuvrxdUTEvXkq1fpKHcxHLoPTqhbE6KwXdRtJYneUFdRyJA882UNzSfhdYGeHUgFyXUrAy8W',
        spendBase58: 'WeQ34JPVc8xote2H7z5YkFympi725SV18p',
        scanPubkey: '03c875c14e055945583703dd9daa19566fdfe61774c3edc92cf3a85868ea1403dc',
        spendPubkey: '034e24e8707691110e7091a5005b32bd1bba2b4362f890cc20499ed708eb8994d9',
      },
      {
        bip32AddressIndex: 14,
        shieldedBase58:
          'K3MaMvKqTs7PGuRykxBmTcVoR7LXtgjcSkt9cJ3US2vZjaeC4zgJVhg7Sw5t6xyyvT7vhBo2bnfkHP7gXMMoHTizCMGq5GPVB',
        spendBase58: 'Wej9ix2UEYPTD1oUFPMoe7ofHgjJriZfHf',
        scanPubkey: '032b7031e5fce3f9d35672352315501f6176b183b7b70dcff01fc5ebeab481a9e5',
        spendPubkey: '0211c252894531023e5154ec354b08ffdb232b4a3b3e7f1e838986910c7d2c3abb',
      },
      {
        bip32AddressIndex: 15,
        shieldedBase58:
          'K3NVarvQr4Bt53kNgZzJQdvccuQ5QMmxPu6xoVz6abtuMUrHd1WpvJQAWCbXtuhrMWgZtnwALbmz79oryyeBnkWMAswWhJCGn',
        spendBase58: 'Wg5EaJdNpbB6dQuxmiGQjVApJWu35Nri7r',
        scanPubkey: '03879b870ff9576ce399946fa9835566ddff6c24c6a8eb80e7fa558fcba75b4e14',
        spendPubkey: '0246c8158ca2553e84f7bc8bda10dc75e08b2ada81cf19fae2c04e1ffcf10fa35f',
      },
      {
        bip32AddressIndex: 16,
        shieldedBase58:
          'K3NDbdipabh6PVZdpR8MhY1i2CfqTyFn2tmENRxY5EzZEQoEdj5MgNE8gAtFPP3jq7t6WScDHrJpbSP3Bw6f5nVqmk6jWV1Ni',
        spendBase58: 'WjvMb5SXYCSYCEub4VcYgMaSzkoYqYZosH',
        scanPubkey: '036bec2ca6af3586677ad8370d8d5c6a34bd806a66aa9325f9a6df801f3219aa30',
        spendPubkey: '026da599e0150581ffb9bc5ee7505051956bfcc19451c63c62f730d7644d72940e',
      },
      {
        bip32AddressIndex: 17,
        shieldedBase58:
          'K3M3YydRprb7FQ5bFcdswL2SPuZ69yrJZMjUaimLDc5QvMyvYgcp7Ua6R1f7wypAqS3ti7WftXZBQ3qfsgDKAaSF3rrr4Rh5b',
        spendBase58: 'WPpw6ZZRjqy9tVr3E4ZuZKuy5pU7EQTGKA',
        scanPubkey: '02f61586225f50a4f4397fddcaeae5dffec643288359d04290cb187c4f5082e09d',
        spendPubkey: '038b18e3726fd3c48cb62d6c1c8a528f26b9fb84c66da9159517c6fe921060d6db',
      },
      {
        bip32AddressIndex: 18,
        shieldedBase58:
          'K3K4qLdk26W5ZhRBZRm8MSpGQonzVmkrBkRQBS3BLKVaSqpuVQzKB9uBvRjjS67mwiPpB9qokLtX6Czmh6iCimTEvpa89Leid',
        spendBase58: 'Wbdjp2JfqRUo1mzLuicicxSvhoTMAX9Gcs',
        scanPubkey: '022f6bcdb43e808dd8f1e79025d85efc94a302cfbb1773d5811bd22f4146408b2d',
        spendPubkey: '035a87248f1f0e9086469a3b6a200ee81beaa66ec86bd2380f77cbf5450c158d15',
      },
      {
        bip32AddressIndex: 19,
        shieldedBase58:
          'K3JignnXht5oERw1gak31HHfuSMi5yE3LG5ceG9u9r2aszdaKmZcHT8xyPsPadKqZbbtUKtfwGuAV9mnV7m65TqC7oq6ZiMvW',
        spendBase58: 'Wb8PYYhdh4uLjPyhbimJiagDQxVtK2hEHY',
        scanPubkey: '020c87e2d4f31d6d655692ee8635e2267153fe5e6ba40b1c9643b8dd8ff6d3fa85',
        spendPubkey: '03bccd4ba2967c5d4d91f8a7a9a9ea5627a2e704786781cc20059055b187c7775b',
      },
      {
        bip32AddressIndex: 20,
        shieldedBase58:
          'K3KQKHUh3ze3ZyiFKWt3Ltc5yfdMgjNnwJKnFpzmE4mctYe8VbYbSHkhWaxkxfV3hHcaNutHNMERTuZRv5dpz2MKtKCcfG7X5',
        spendBase58: 'WQgtACTymUUzg3XsCbxD868RmWmiHh3qgK',
        scanPubkey: '025128a6b751fdfef52f418d894938cf10fef02053dac74578eaf99e5b31a19e03',
        spendPubkey: '02a6176b0774278bfa6622ce1e6f19bfc730dc48a4aac6041e81eb0a58d91c3b36',
      },
      {
        bip32AddressIndex: 21,
        shieldedBase58:
          'K3LvkVCrE9WvbRYC9Q8B2A1XYyEtXxFRE7ybGF8EwG3i7AnZNzBGrqzNM9RVCQAuFS8TQc2MH84BosV154qX3PhvFApP9mHzB',
        spendBase58: 'WZt2JfiDL3XZvmHQBDdfuizyC7zZTh8c6j',
        scanPubkey: '02ea4e33838fd09931de86f928ec0cde3e7f7a7ea782c270f8e60d45216db5f9ce',
        spendPubkey: '03e554661d9a413c40f18e2e1b9fa4ac87f2a88bd683080499f3271134fb8a4942',
      },
    ],
  'monster opinion bracket aspect mask labor obvious hat matrix exact canoe race shift episode plastic debris dash sort motion juice leg mushroom maximum evidence':
    [
      {
        bip32AddressIndex: 0,
        shieldedBase58:
          'K3KWNyXaFApYJs3LWioK7eQq3aj3jnKBNPG2dWpe57a5aDJ5N2vmEP8rA13r33hAyJUNqK7ueuKs7NxqyVztsyRC2BML1zGQ2',
        spendBase58: 'WQZ5EJezJokrSuAZvLuu9ecD3fHRAnbxUt',
        scanPubkey: '025ba8d4db59308c8a4982b8268130507e54b8198d044bebe62e3bc711063ba9e2',
        spendPubkey: '024bbf730f3d6c461d00e5fa1a385799c6bb0fe83cb81c3a8c3f89b7e119532f82',
      },
      {
        bip32AddressIndex: 1,
        shieldedBase58:
          'K3MqEXBSdHZ14SFNV5pdXKd4CvRoJcFa6CJRwJQPd73UCS2mZNsjJMQkKhzJRC8S5mWKKFhor1tLMjjtGdA7mQmaDN3CVwbyG',
        spendBase58: 'Wh5nG67UDGeR9czShAj86dUT3wyaUkxaoj',
        scanPubkey: '03453191770e0df8f036af74c7440692c4d1d12a130130c9a1fa3a8f168ae0eee9',
        spendPubkey: '03485328333eee72145ef6c17d9d58a3e8f435eb21a96727e15201e150ede34c77',
      },
      {
        bip32AddressIndex: 2,
        shieldedBase58:
          'K3Nk8PnDirwv96z8CYVbWSkL8DyQKDCYnKJiwRAR9KxEV3Nre624twGUsjnRzMS1Zuz6HBsD8gizWXvpemnjZGSHmWf8vfEkz',
        spendBase58: 'WeR5TyepeUsuYjoHXfhs1bv4MnBrFpgVLd',
        scanPubkey: '03a0cb255890771db2904d327138bfe076ffc0506d39203076d7b099ed5d5a023e',
        spendPubkey: '030e2d0ec507f1a1477cf048c3d9ba95e6fc8bc2fa6dc4049fec1b7ccdf7d229fc',
      },
      {
        bip32AddressIndex: 3,
        shieldedBase58:
          'K3KJiLAQhZL5xneRb5NRdXvTPB3ubmk9HtEDrevcdanq9V3nQeD7pYiE2qQ8amGKrhqUbHCQt5Xmf5rd3jrT4jhSH7owCHo7v',
        spendBase58: 'WU8EvZMF4e6M7J5BNsBeAYLq7NKjjMVxd1',
        scanPubkey: '024774d6187a6a9bb3f4ca3200dcc41ba3ce91ff8ab9f4677312b0ff8456134b47',
        spendPubkey: '03d738ef3338bb3a951f93d31887dd9a759b9dac37bc9e60aae4534a0d4146ab62',
      },
      {
        bip32AddressIndex: 4,
        shieldedBase58:
          'K3NE6GwTX7uQ1tz6MSvDQhKwaHcMb4fpw4NJzqwux5jhFFf3vMGfV4bDMb2DpD8uZj5r7o9EXktXa27h8jYi7NFNqoedAvFyZ',
        spendBase58: 'WfDUrEk65Bph79STGtVyGX6AbXxJKrDUqL',
        scanPubkey: '036cc71993bbb7cb037c89c6d294f1a0b12bd67a0031b6776a43bc383de46db5bc',
        spendPubkey: '029e1ffb504c756d346a5b3320729e91c019a5d111332fa7145dbc5d450c05ee49',
      },
      {
        bip32AddressIndex: 5,
        shieldedBase58:
          'K3NBErPnhs2koRnVG954GinX5oAB47MWL92obGP7j7EzsKFniUqbuRvwxoGfs4BeQ9PHYvRgbMMPHpM4wkzSPRCN99SJraBmR',
        spendBase58: 'Wddh9vUnzaWRoizT1pfV49UbUbEBbWronj',
        scanPubkey: '0367d6abf613ad313facb5f23250d1ff23ee3115af5bcef47fba7ba671604acc79',
        spendPubkey: '03667c0d84c250c5e7b4fad5d8c0dc28e08de5f6b4419221698221444329e186d7',
      },
      {
        bip32AddressIndex: 6,
        shieldedBase58:
          'K3P3P8FntyZQEAD83sPZsiJ127LfY3gcrYK796biixtT5TaVG3MMs8SKosgzbcomjQoK1yS5GE4mVCwJvC8P39m2M5ZenJzdv',
        spendBase58: 'WiDHT6JMij2g5NprRdAyk7yPzcV7tvfV9U',
        scanPubkey: '03beac56f53975064b4d9b38caaddb087f757e7d5c0ca4ee2e292fbbfe951d5ea1',
        spendPubkey: '02a4b362ecf35c2faa1b6ef2a43937aefa23159c271d4ac7a76cb3e56579ed3947',
      },
      {
        bip32AddressIndex: 7,
        shieldedBase58:
          'K3KP78LGzZu1uwPYPmc5ehE5PajodfNvRwfDycujvC5bbSLhxt9t7JJzdYfXWbSEr2SMJKizT35iTGNbhQdfJxcohM3mttTrt',
        spendBase58: 'WSXwGefsF2NzhebWz6iF8zbduTsLuEi1yg',
        scanPubkey: '024f1064f18738875684cef4429a5c87a3acd7826f29abc95494728b9ff162c68c',
        spendPubkey: '02b6e5442bf5ce86657827467a0bc483125db7bf6735f0fa3e2c6b5a15a53acdce',
      },
      {
        bip32AddressIndex: 8,
        shieldedBase58:
          'K3Lh8xGUZqJfGDgizbmtsoxc6ZGc21tbBwzaFsvvGzQKBUoG5WaMsnhwbufFH1pKtMpoxA9PbjqRGJKckGEbq7RYL4VidRzsM',
        spendBase58: 'WjdnCytauQzcRc228oZuHdKcnEtd8AK2e4',
        scanPubkey: '02d2bb53a5d3d8fb2eb32726c15849d8601e0d2585bc1d928904e17f31d47f841d',
        spendPubkey: '0221036fa52c51485d1d127bc05a7fd5aa6169d7a493222c9fbe5bdd465a8fef27',
      },
      {
        bip32AddressIndex: 9,
        shieldedBase58:
          'K3NRL5Q5PYmfzFWdjmL3Rh6sRUzHFZ7dhhBoDynXrombbEHJaEMtuAyXpvnDXyLPK3vWUvRVGN5764RJbwTf4yfw281mAtbiD',
        spendBase58: 'WX4BpCkDrjNtKV9U7MBq53cU4spkqsPowu',
        scanPubkey: '03803d342176998b16b4cf1a7971cb22878bc28fe2680dcc6cab306e4e64c124a4',
        spendPubkey: '03cdd35ec8ebad97c2328a155ca5b3acda754fe505b7d71a32c3ab0811275ebca3',
      },
      {
        bip32AddressIndex: 10,
        shieldedBase58:
          'K3M9Xqmr8k9tcpaGRkqiCZFVt3GiHuyKik2krviwKZonxZtfmJK7Xk8S7wXKPeWfT71ytfEnmg5VC77TAUdsXUq7CvegNDK8s',
        spendBase58: 'WSUr9QWDo4XQ7nwy3Q4QgxhudgyFfrbj4v',
        scanPubkey: '030070d1109e3b23b9418f974883e5ca5fb2b9197a2ef431408384e7c76ddbe1c2',
        spendPubkey: '02b9b9ca6938f017e5ec9e72bfedceba0fefdf6fa62babad72ad3edc9c87929e7f',
      },
      {
        bip32AddressIndex: 11,
        shieldedBase58:
          'K3JkaaPgHetD7nbhYZZndAXcg3DBXCXnJ47T4ADWuHDWoAgqoCkvbh8Z2gu8gTKnRLR3VoYR3Vsh3ZW8sSyDZTy9N1RKWoqoB',
        spendBase58: 'WgCcdFbnLa3Y4kNJgeU8CuZi86v5ya6zgJ',
        scanPubkey: '020fcf0c5bfe74d1a123ed6cd3fb502288056fb35dc5d4305072429dfc5674f8f1',
        spendPubkey: '031e4498ffb19b77dd7e673a255378f4a673500d969c0cf04ac955dc246c15b8e2',
      },
      {
        bip32AddressIndex: 12,
        shieldedBase58:
          'K3P6vw53PAnrKHVAjTr85AKsLUpCtV7RRc9xPmHoLJnrWSyaRg2AptreNv36eEFY1mVG638ND2Dp3oo1B3XXRkaLR36D4uWai',
        spendBase58: 'WPY8RDKPk7xcnePWNVUeEvg39RwMh2LawE',
        scanPubkey: '03c4d17247cf6e210b17ce0ba2989e17bed2b8f5812a9dc78cbe710d4efafa8086',
        spendPubkey: '03538dce2cdb1d6120de414a416378544800bab9a1113be33d644792f117a05d61',
      },
      {
        bip32AddressIndex: 13,
        shieldedBase58:
          'K3Pe41k8A8ukrDoEmweGWaLXiXmmcJtLmHYAHME32PJwrrXSL7HX4P8ucj81DzAD1pVG87cFpzVShr9SNdi3HVBMiLKbm2cL2',
        spendBase58: 'WfsmRDSaT8dECbYYuKa2dpZ6Pk39AkK6XR',
        scanPubkey: '03fab6c0dcde427ae71c9ab788fd14c13fe9fccaa94e2246d43fe17caad6471da4',
        spendPubkey: '02fe96265e19f00484d740ca2508e1850b385357ddd0c8be20fe6cb5cdcec87107',
      },
      {
        bip32AddressIndex: 14,
        shieldedBase58:
          'K3MoFemUYhiemdni4KZyk6qPR9SxCQw9uWdYQJ1w3JhRe5VvYZy3Mgov18p7u98VGSwYdYHdh5FU888Qqmse6dVzHnFCUhkZD',
        spendBase58: 'Wh1irX53g1C9Tvmsf1LxuPdkSrx4bJNVWv',
        scanPubkey: '0341c38df3b74a617b679313a9aa63435800544643e24c8e44ce0df3f853ae5917',
        spendPubkey: '03542d58ff817fcf4a35b77c62997404aeafecfe355d180aff963836c120434d16',
      },
      {
        bip32AddressIndex: 15,
        shieldedBase58:
          'K3PeTatmXnM4EXQDBxCVPRqRhQybRZKgeRE41pF9qHjqskZgUVU7uX7Svzg1ZhvSnvucRk4K54zPXPTmkYBhX7Ayu8eqH2ix8',
        spendBase58: 'WgmfydybdU3g7tMVvmugGwzHQKn3PEZtNZ',
        scanPubkey: '03fb6aecb6ddc2e68c22e58bf93dc429b3100108b83eea8ee98d537a0d682d585d',
        spendPubkey: '032f20be0e2109afb326fbe7d87c508c2163f3ef03a77ebbde6cb30ef4c1843acf',
      },
      {
        bip32AddressIndex: 16,
        shieldedBase58:
          'K3KaPx2N4GDPuse7C69gMBtXSXsajnkH2qxCs9NKhRq1M63hX2Wrar7875uGv3sGBWtBcmjC8zhN7XYtkNKg4NJagRVDqCMQx',
        spendBase58: 'WffHKhxZ6feFBUF76Do6nVimSvka9oDctU',
        scanPubkey: '02629d9759c810276badb394d8d2f1835ab8d3a24ac8f5e918a30a11f66da112b9',
        spendPubkey: '031959ddeac408a4b90ff4d76c40fe6cd23a79d4924dd1cf843052973d0761464e',
      },
      {
        bip32AddressIndex: 17,
        shieldedBase58:
          'K3JofQunjtKhgk1Hx8LP4yvm2EHjjfWUY5gnV9hGcFPKtkFDko4Aer9UJxhwm4WatMNy15hRPHu11Y1gwrvGqAQ8PQYTD7GQw',
        spendBase58: 'WjEHNLDYDauek4MDYwbPvcBR9wTaQK7Vaj',
        scanPubkey: '02152600a6a3264fd4050b376a5d207156f83a3ec0e31e1fa9b5f3355c2fcfaff9',
        spendPubkey: '03b3bfb6b14d05fa489d3528cb8706aa9517e78684fe79e19283843539abd070ca',
      },
      {
        bip32AddressIndex: 18,
        shieldedBase58:
          'K3LyzyGqAx96d5Y8Y9w5KAsnVdxMKF5XWEfi8JkWER1bWV6KgVU8oFSm4QMRcextyNToM2aqTxgJWXQiaWpL6ZTfyjDpPDwZV',
        spendBase58: 'WeS5Lgq67oS2A8JbAwgbNsbMsKgXThSsua',
        scanPubkey: '02efeee577b877afe6dfb8cef414555d57efd4c1e7b1adb3c3107c2629d53e7e42',
        spendPubkey: '03b612af71c23cc5401298c5425d59a02687b1e96e2c506f4bf74d892f59753365',
      },
      {
        bip32AddressIndex: 19,
        shieldedBase58:
          'K3LwQt2cWtEYRaN5UGbtsuMfsDgjJcvx5XRzPn77yAxxC9XEceHezV1ePPS61gsoxTUtUXJmGxfXnQ3UQ1scFh8xqt9tBNXXt',
        spendBase58: 'WgsgozKv31ybiBYmeAoEGWo6EAuJt5P57s',
        scanPubkey: '02eb73aa6b69f2a32aab27a87a0baea5dfac03941693aea4ea65903a584f769b0a',
        spendPubkey: '0310bd8836727efca8aa155454f563aec3c01e4fb12d86fa35a7a20b1b0413d8cb',
      },
      {
        bip32AddressIndex: 20,
        shieldedBase58:
          'K3NXtt3mgEqdJGk2123feNTMrL5jkrvc5tJzXHbpMQyv9Epban9HxXRuaKm7WoQXe6jgevDCtvBdgBe5LXqConLojiwaJoHAP',
        spendBase58: 'WQTCGP9pshoZD4jhvwh8gpDcsT9SEx9Bqq',
        scanPubkey: '038b9beb00803d91c933eb51b83399259d248f84706c4378047c2d55af3e342fdc',
        spendPubkey: '038882d881abb0e6edcb1ecb65a6de15a36ae64cb99adc6eef881300e5ccd7f6df',
      },
      {
        bip32AddressIndex: 21,
        shieldedBase58:
          'K3Kph3ibUcvyB9xGywwuJ7YEf3aG9FhUy2MfhjJpcbVo7hnN1fbsM5APdNX9pjD9EK4fWDxrK9duy84c9g3wAT8FeKPNRdW3x',
        spendBase58: 'WeoNwuWkYfAvKR6G5ySJXC6Lszbatjauu2',
        scanPubkey: '027b5ee1fbdb7f4536131065ca53f122a190c840726bb5d4383a081e4363f401af',
        spendPubkey: '0219a461f6cb023957adbac84fc20e7aade4dc4e71a6b0cdc10eaea41465cd7bb2',
      },
    ],
  'tilt lab swear uncle prize favorite river myth assault transfer venue soap lady someone marine reject fork brain swallow notice glad salt sudden pottery':
    [
      {
        bip32AddressIndex: 0,
        shieldedBase58:
          'K3LZu64gkXFS2KcGyRSiU7ry1fgD9Usj8XtiggWNXBHjvsEHpR7ujFXP3zTEFZJinjubS6QbxiYy41xByRKxQ9npRSRLZi7j1',
        spendBase58: 'WR2zF22GNK9E2ZCAbzqhhjns9nYuBmtReP',
        scanPubkey: '02c6320b3b5e252de7b4c68a5b7853e87bc3341def4ea9750dd390e63650d4afef',
        spendPubkey: '02d5c8dc4428cb53e386ac4e8b5da8e14482850573ef7a20a95910c42650309321',
      },
      {
        bip32AddressIndex: 1,
        shieldedBase58:
          'K3LmSMr1A1qPPwKFgxwbaiVgnwn1jvxAidYMJep8PdpJ5o1HcPPDy4i3kmKihM2rEeZyTcLuZjdjh2kD59emQUtvuxEF8u2du',
        spendBase58: 'WXd6YmuBvMt7CXcikxZQuJsCPMu59C5d64',
        scanPubkey: '02da2db07f97ae42d9e9c20d759818a4387a2b12f5ba7339ee7668ef66fdb18fd3',
        spendPubkey: '0273def047c7656ce9e70610221e56144ae60d3b3e32ae45886fcc632625aeddce',
      },
      {
        bip32AddressIndex: 2,
        shieldedBase58:
          'K3Myeku1iXVafPHTT7pzC1nXxgczwSiAJi2wEpjnngPHZajLfMufFHdevZTsuwizCUXZJZoRczWg8dF5JQ5rfV8RyMZmX6w5f',
        spendBase58: 'WfvDnZa11aLbbNeEjxzHd5uNWCTJJjDx4Y',
        scanPubkey: '0353c57368468f44e6ef3da49afc8ab859a22ad0950fc7709b0fecd0c1b07d5c1c',
        spendPubkey: '02ea4877f8b1bd6bc4397377c964065b945298f9029a693e703aafd84b9746640e',
      },
      {
        bip32AddressIndex: 3,
        shieldedBase58:
          'K3MvqbnzvhkeL2vc1MztF95dAAbxwkRBBRxsbbrp1bgikwzubjdCuNoP4g1E75cMxPRiKyVGJfTFKGXwvdQK2CdzH4Pt4Hgc3',
        spendBase58: 'WXuNmR8FQJkAjvZv5DHw4zpKufguZeiYyY',
        scanPubkey: '034ee6584b7452da8f74781e0c7e9ceb72ebbe96c0e270b953781b79d5e1c7d2a9',
        spendPubkey: '0306b915144a9fb53b97e6214f3efad21cb9abe7fb0bd32405d9ec1dbcf4f53540',
      },
      {
        bip32AddressIndex: 4,
        shieldedBase58:
          'K3Kmrboof4WoEoX2j56hmYaWaMfRmAMmE1iuVAt5SSexVCPHPJaW4e5nLQWkcMywBSwoToUXzUbQbf5uyECyHGf8u9stcYcxy',
        spendBase58: 'WXfsQcFFTkA1F1zF5uTrLKYxMX4WGsudGD',
        scanPubkey: '027675eb1b19e0974161bdbc7b3e7dd291caf99910c1c30feb6da18edfc0d8853a',
        spendPubkey: '0223df5c99973d259fb666c3756ce2123e07985cba91c3be6c42c70a8e6b0aedfd',
      },
      {
        bip32AddressIndex: 5,
        shieldedBase58:
          'K3P4yWC6Yzvopw2nDYuKtx5QHqewdoitjMhqT6ZB6mqFD8o83BwxUnC1ERSVU9CTrNkAEuX2behBj1MZAerXDDZy6JDYKBTcA',
        spendBase58: 'WVY9hycrjR3Bi8dwZnbYVBARndJUJTNsFs',
        scanPubkey: '03c16e7100fdd86ccc2088c94dbfeee7b90dbf3dade6a19e52ddeb665b579898bc',
        spendPubkey: '02be020000698e93552277a4f058c6a2173720b90a06ef119259a9617dffde126e',
      },
      {
        bip32AddressIndex: 6,
        shieldedBase58:
          'K3K6TNBsvKN2LbGvh8qLHu358s5UnQ4WdJ4XpSZzM8rHqjNALymToiXed7fAFC9jCav2ZVGyE8sFNEk15g6LM99MnBuNVjdeq',
        spendBase58: 'WXrsHZJYxWdP8RfRdnEfZ3Ne1sGze1kFYM',
        scanPubkey: '02323a81a1aa25517afd9d48b140996e67788bad4414fa95d6bc66402239c65d91',
        spendPubkey: '03d81ff8d80b3f2ef36cc3fa663eece28e4108d4671b13e67bdabb3ed46857da95',
      },
      {
        bip32AddressIndex: 7,
        shieldedBase58:
          'K3N9nF3aLUF4pL3pzDkXGWXC3N8UCefvrwRVdPfpmpuZgKWqna5kdWswgHA85HvPwJumHwWqsUp1UxoUhMty1XsiDA7wTiDny',
        spendBase58: 'WVDgyWjtA3YSCR8oAQ4ybTDZmgQi8jWvxT',
        scanPubkey: '03654ff38236f4a6ad13d49e4c4e9610d178e29a67fde1fc65c96089da87ac9a4f',
        spendPubkey: '0209ec8bdcf9907203da2dd5cb81f155a1564d279a7e9532470e2b985867b4cdf1',
      },
      {
        bip32AddressIndex: 8,
        shieldedBase58:
          'K3KKu8WwcvxE6QnYCMWvw98Lg6PdGD6m2vu54afU6NQGQz72WWMU8jRhu7gVEPh48cg9WDYDPUzn1ukAUB4ZyMC7dKqxSrDBD',
        spendBase58: 'WZauH61Bw38DEgwTVWKSpnPLfNFUrJrAjs',
        scanPubkey: '024982b5ac9d4a656b7a0b2c7e3d95700f5f29fe7d91f3641ddf17664f30778eec',
        spendPubkey: '02750c7be1a75ee51e6cd0a73f4f1fa95cdb9088b017ac3aacd0698c30e1f6730e',
      },
      {
        bip32AddressIndex: 9,
        shieldedBase58:
          'K3Ns7U1pbSweXuApZTKataTQ6bCmT72dn1mDfR9veMzgXYKjozaNJnzTFVJeJ6UenN5SNLG2JhVg612HDTRqcEJCEdf6C5XEg',
        spendBase58: 'WVwCrUqDrUHkGXcjGJyhJhBVBLoWSSHwGm',
        scanPubkey: '03ace35c40d806491cfeec0f6057baf120f1627b815f0faf0b1947c2f0f9ed441a',
        spendPubkey: '0300873ab2d7910c4a47ccd524e404538d9be37bd07041cfe3eeb83d64c9b587a4',
      },
      {
        bip32AddressIndex: 10,
        shieldedBase58:
          'K3MgL4YMR9KHv3JXTVxKDY4eYqxDYu5GHMQv3CDfRS5Khmt6x8K8YPvKrTFQTXMhdHpE24E5937UEjQxuTs9qmPDG2ZzhEWNx',
        spendBase58: 'WSjrrDHZLMxpEd2PuQEnLSzndsLUMqtV3h',
        scanPubkey: '0335c5f63f6e31aec09e15e3711ae59e18f5855f08ff67569149ba65d1283fedc4',
        spendPubkey: '02f7236e105817f6e60a686c5285360579cfde4589df7c243ba5204f63865cd3d4',
      },
      {
        bip32AddressIndex: 11,
        shieldedBase58:
          'K3Nff1Gva3oMW5jK84PFxxzhE5dTD6EutfSPSRHKSqJ71iTvozNxEpmDrNVqgQpyz2ALTv1LgMbohp6PSz9kDNjUYsB149Sox',
        spendBase58: 'WheZAWKT2Nh1ziXPQLuuHka72ZXeVWu5Be',
        scanPubkey: '03990c7d16830e0485b6a93979ddf7980a9a8e89e2156b27967cc46faa50036948',
        spendPubkey: '0275fca088fd18e96673409f469259197a516f7aeb9fd3dbb39e7fd581180dee0d',
      },
      {
        bip32AddressIndex: 12,
        shieldedBase58:
          'K3PL7YNuKHdainGF9wcSbDHC6c4ba1SKUQL4xZu61zekkBDowgmy9jCWYPzwrLUGYfwoFfTdKQzQCNkcLV5p8ueSbfjvdKAGQ',
        spendBase58: 'WZzffGYLQA2DU189KsXQn3xw3L4dQU9yEh',
        scanPubkey: '03dba5ce9445764a031dbc2778d65dbecdf0429efeab85fd0059b4070481667662',
        spendPubkey: '0288ff669521b8204924d164792b0ed063320e075c2e4f85f64c34ec7b88ad8c35',
      },
      {
        bip32AddressIndex: 13,
        shieldedBase58:
          'K3LroGgRM85m2YC9pXC6JoRMeRRStMBXjPqVgSnSdfNZWPgJKQj2q5wVPjQpPyg1Nkocr3RP2PJmVccDgVZVrx4Xg6byKrpJp',
        spendBase58: 'WbyfAyMWXZTNnJvgoQE7i3ZMQUqgj57Tye',
        scanPubkey: '02e3762ac99ad587a9ae205214f83bdc0874d6ccde6412a086110478d7344cfda2',
        spendPubkey: '029101e16e58fa1a80c1e5a8abbfec517e9658510444387d1960987ce63a920302',
      },
      {
        bip32AddressIndex: 14,
        shieldedBase58:
          'K3MKZYrzVofuHoTBPKWkD8GQoEUzKXY8M3TxAhgpuFfQke3Wd5ee3haCHrGe7XcAREyW1W69WcdRHKAFwhMNoELd4FpXmwc97',
        spendBase58: 'WidpvvvXGKi9endyfbx9opYGXfsQN8JXhu',
        scanPubkey: '0311cf2932d4c8d5ed9c112d92180ee1964bd1f7635238fac6b65016940e6d18ed',
        spendPubkey: '02a13bdedc0610ca3883109e43e12d4c8de5897d98ca7ff171184b70ae8f22644f',
      },
      {
        bip32AddressIndex: 15,
        shieldedBase58:
          'K3Lp88J6ZrR9RJ5Kzmk2QqAkXtUEATCKJoEjUEv4Csuvt88tdUw5KXyaz8CV7kdBZLtbR8TRqmoNJFBQ45Wmw2oYuezjtPFPr',
        spendBase58: 'WX7NeQRxqyk9gCdaE9hHSz9Hdgef62oVRz',
        scanPubkey: '02ded44e0282ea446066a083c55487aa7c8e457692e62727cdd5749d623a2d21ff',
        spendPubkey: '0211ac1357ea0ad9c7571d6e2887f462d9263a46d8b60eb962dc1c2dfcbced16a5',
      },
      {
        bip32AddressIndex: 16,
        shieldedBase58:
          'K3PPLvVhAqJJFt66LpzG8f26vS4dGJ5SrarUhDPdzXignBK2NoiBD5JmQajRbVi2vSY3muzRAifTwgsFWaSU3eqzQ5gvFhLu9',
        spendBase58: 'Wk91fEzMZttSd4jUTi3AM752FmYWK4ptZk',
        scanPubkey: '03e13e12fb8c801e1170014f58d239c2b5192c3c373b8ff66ae399bea491631aff',
        spendPubkey: '037db08a8f5ec34566e7e0588141b323f5383cfd8d6a50f6bfcf4c722fcb793009',
      },
      {
        bip32AddressIndex: 17,
        shieldedBase58:
          'K3NbHBWjwchCnTavh8kteaox32rdndE76XRB5bQTgjfWhAH7n8ZVnRKHtuzGm5Ri3FG9WMcf4pgV45aASFLbTXk4QNuRBqsYY',
        spendBase58: 'WSucjdYmJFSvvkuLTkyWyYNtSAqE9NTssr',
        scanPubkey: '0391785d4d7436c60b598959e0ed75e5be112888d2bdb2d9fe9ba0e66758fbf9e5',
        spendPubkey: '033db842ff23e9f27bafcf0d083b88ce9333acfe79d8d909a647227112ad563a99',
      },
      {
        bip32AddressIndex: 18,
        shieldedBase58:
          'K3PLW5iTurnpGekCcKZvwdQxKoSKW1wWHKz9RTvr4Z9Mzwu3eLn5bniVLPAWFYVobSJxPyZSMGj2oi9fp3hvArc5wUceS3PWe',
        spendBase58: 'WYBVceWBrcF43nT17XbNuSLmvdSzAnzpoz',
        scanPubkey: '03dc52188bd13db404526c5ada84b957bd171a9de7b1a488edfd03850b07462336',
        spendPubkey: '0326d3e03f6521dd2c0581911790ed9d33ea6f08c90a2bac3aa2372262b59cd210',
      },
      {
        bip32AddressIndex: 19,
        shieldedBase58:
          'K3KgiE4hhXkXqnBc6iq8mNY8B5sgZe9DgMdWNJLhscuEmVS2Tw86X3ET7XCGw2xKpYSJNk1cpRbRgrdanvap6TjE4kuiwHuL7',
        spendBase58: 'WRsYoTWmC6rW1JeGuUeCxhUBuToQJR7N4o',
        scanPubkey: '026d8d42e3df4db4d21e936b0f4fdb993da4f796f4911eec8a3a7625552022fede',
        spendPubkey: '02f4a89d3ff41af643aa2d76c641cd8522432783a41ea0a682450d5f1bb466ed83',
      },
      {
        bip32AddressIndex: 20,
        shieldedBase58:
          'K3LmsP5fqzgNW5h88b3jnvL8V7AMUDvVHtgjenGzjHA8gZc4JdyVGVHDpw7FGkdmJTRMmxNQwR7BJYLRuDWb5Pd2AZFGnksUR',
        spendBase58: 'WYQWCPVFjSry9sxBnE3K3b3pHaCyidzjjL',
        scanPubkey: '02daecf133615f263282ad3fe9a1df0a373e8857c923104d7a849dd96ac602d426',
        spendPubkey: '03cbd7f51111c634c5e1d7836e98704464a2ff4ad26b76cfb2b058cd124bb52baf',
      },
      {
        bip32AddressIndex: 21,
        shieldedBase58:
          'K3NHuPUUQgXFksn9Q77po54oyrySLnaSn7rnYZ1aR67mV52TM4metUigbDqdCbWVrLkvwQaWiWVRnqYbUSwSDCk4kdJfpCDw4',
        spendBase58: 'WX1GL6ECKzKhJNwaE6HmR3cVmw7b1FwUCc',
        scanPubkey: '0373613222dbd486b6b679a5223949737387e251b3e3f2d199348f9981644b7478',
        spendPubkey: '03abaac4db02b89272cd7ae3013bc5cb2ba0beb06556c079ba66e565a13078b85c',
      },
    ],
};

/**
 * Resolve the pre-calculated shielded addresses for a known fixed seed.
 * Returns undefined for unknown seeds (the wallet then derives live).
 */
export function getPrecalculatedShieldedForSeed(
  seed?: string
): IPrecalculatedShieldedAddress[] | undefined {
  if (!seed) {
    return undefined;
  }
  return PRECALCULATED_SHIELDED_ADDRESSES[seed];
}

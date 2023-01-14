import txMiningRequestClient from "../../src/api/txMiningAxios";
import networkIntance from "../../src/network";
import config from "../../src/config";

let previousNetwork;

beforeAll(() => {
    previousNetwork = networkIntance.name;
});

afterEach(() => {
    networkIntance.setNetwork(previousNetwork);
    config.TX_MINING_URL = undefined;
});

test('use testnet tx mining by default', () => {
    const client = txMiningRequestClient(null, null);

    expect(client.defaults.baseURL).toEqual("https://txmining.testnet.hathor.network/");
});

test('use mainnet tx mining when network is mainnet', () => {
    networkIntance.setNetwork("mainnet");
    const client = txMiningRequestClient(null, null);

    expect(client.defaults.baseURL).toEqual("https://txmining.mainnet.hathor.network/");
});

test('use testnet tx mining when network is testnet', () => {
    networkIntance.setNetwork("testnet");
    const client = txMiningRequestClient(null, null);

    expect(client.defaults.baseURL).toEqual("https://txmining.testnet.hathor.network/");
});

test('use explicitly configured tx mining', () => {
    config.setTxMiningUrl("txmining.url");
    const client = txMiningRequestClient(null, null);

    expect(client.defaults.baseURL).toEqual("txmining.url");
});
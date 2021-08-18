const mockAddresses = [
  "WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp",
  "WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ",
];

jest.mock("../src/wallet", () => {
  const wallet = require.requireActual("../src/wallet").default;
  return {
    ...wallet,
    _rewardSpendMinBlocks: 0,
    _networkBestChainHeight: 10,
    isAddressMine: (address) => mockAddresses.includes(address),
    getAddressIndex: (address) => mockAddresses.indexOf(address),
  };
});

import HathorWallet from "../src/new/wallet";
import txHistoryFixture from "./__fixtures__/tx_history";

class FakeHathorWallet {
  constructor() {}
  getAddressIndex(...args) {
    return HathorWallet.prototype.getAddressIndex.call(this, ...args);
  }
  getAddressInfo(...args) {
    return HathorWallet.prototype.getAddressInfo.call(this, ...args);
  }
  isAddressMine(...args) {
    return HathorWallet.prototype.isAddressMine.call(this, ...args);
  }
  _getHistoryRaw() {
    return txHistoryFixture;
  }
}

describe("Get address info", () => {
  let hathorWallet;
  beforeAll(() => {
    hathorWallet = new FakeHathorWallet();
  });

  test("throw error for an invalid address", () => {
    try {
      hathorWallet.getAddressInfo("WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAD");
    } catch (error) {
      expect(error.message).toBe("Address does not belong to this wallet.");
    }
  });

  test("correctly return the address info", () => {
    let addressInfo = hathorWallet.getAddressInfo(
      "WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp"
    );
    expect(addressInfo.total_amount_received).toBe(2);
    expect(addressInfo.total_amount_sent).toBe(1);
    expect(addressInfo.total_amount_available).toBe(1);
    expect(addressInfo.total_amount_locked).toBe(0);
    expect(addressInfo.token).toBe("00");
    expect(addressInfo.index).toBe(0);

    addressInfo = hathorWallet.getAddressInfo(
      "WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ"
    );
    expect(addressInfo.total_amount_received).toBe(2);
    expect(addressInfo.total_amount_sent).toBe(0);
    expect(addressInfo.total_amount_available).toBe(1);
    expect(addressInfo.total_amount_locked).toBe(1);
    expect(addressInfo.token).toBe("00");
    expect(addressInfo.index).toBe(1);
  });

  test("correctly return the address info for a custom token", () => {
    const addressInfo = hathorWallet.getAddressInfo(
      "WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp",
      { token: "01" }
    );
    expect(addressInfo.total_amount_received).toBe(1);
    expect(addressInfo.total_amount_sent).toBe(0);
    expect(addressInfo.total_amount_available).toBe(1);
    expect(addressInfo.total_amount_locked).toBe(0);
    expect(addressInfo.token).toBe("01");
    expect(addressInfo.index).toBe(0);
  });
});

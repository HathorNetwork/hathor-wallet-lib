import wallet from "../src/wallet";
import HathorWallet from "../src/new/wallet";
import txHistoryFixture from "./__fixtures__/tx_history";
import transaction from "../src/transaction";

const MAX_INPUTS = 255;

class FakeHathorWallet {
  constructor() {
    this.wallet = wallet;
    wallet._rewardSpendMinBlocks = 0;
    wallet._networkBestChainHeight = 10;
    this.isFromXPub = HathorWallet.prototype.isFromXPub.bind(this);
    this.getUtxos = HathorWallet.prototype.getUtxos.bind(this);
    this.consolidateUtxos = HathorWallet.prototype.consolidateUtxos.bind(this);
    this.prepareConsolidateUtxosData = HathorWallet.prototype.prepareConsolidateUtxosData.bind(
      this
    );
    this.isAddressMine = (address) =>
      address === "WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ" ||
      address === "WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp";
    this.sendManyOutputsTransaction = jest.fn(() => {
      return Promise.resolve({ hash: "123" });
    });
  }
  _getHistoryRaw() {
    return txHistoryFixture;
  }
}

describe("UTXO Consolidation", () => {
  let hathorWallet;
  const destinationAddress = "WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ";
  const invalidDestinationAddress = "WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi";
  beforeAll(() => {
    transaction.updateMaxInputsConstant(MAX_INPUTS);
    hathorWallet = new FakeHathorWallet();
  });

  test("filter only HTR utxos", () => {
    const utxoDetails = hathorWallet.getUtxos();
    expect(utxoDetails.utxos).toHaveLength(3);
    expect(utxoDetails.total_amount_available).toBe(2);
    expect(utxoDetails.total_utxos_available).toBe(2);
    expect(utxoDetails.total_amount_locked).toBe(1);
    expect(utxoDetails.total_utxos_locked).toBe(1);
  });

  test("filter by custom token", () => {
    const utxoDetails = hathorWallet.getUtxos({
      token: "01",
    });
    expect(utxoDetails.utxos).toHaveLength(1);
    expect(utxoDetails.total_amount_available).toBe(1);
    expect(utxoDetails.total_utxos_available).toBe(1);
    expect(utxoDetails.total_amount_locked).toBe(0);
    expect(utxoDetails.total_utxos_locked).toBe(0);
  });

  test("filter by max_utxos", () => {
    const utxoDetails = hathorWallet.getUtxos({
      max_utxos: 2,
    });
    expect(utxoDetails.utxos).toHaveLength(2);
  });

  test("filter by filter_address", () => {
    const utxoDetails = hathorWallet.getUtxos({
      filter_address: "WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp",
    });
    expect(utxoDetails.utxos).toHaveLength(1);
    expect(utxoDetails.total_amount_available).toBe(1);
    expect(utxoDetails.total_utxos_available).toBe(1);
    expect(utxoDetails.total_amount_locked).toBe(0);
    expect(utxoDetails.total_utxos_locked).toBe(0);
  });

  test("filter by maximum_amount", () => {
    const utxoDetails = hathorWallet.getUtxos({
      maximum_amount: 2,
    });
    expect(utxoDetails.utxos).toHaveLength(3);
    expect(utxoDetails.total_amount_available).toBe(2);
    expect(utxoDetails.total_utxos_available).toBe(2);
    expect(utxoDetails.total_amount_locked).toBe(1);
    expect(utxoDetails.total_utxos_locked).toBe(1);
  });

  test("filter by amount_bigger_than", () => {
    const utxoDetails = hathorWallet.getUtxos({
      token: "02",
      amount_bigger_than: 2.5,
    });
    expect(utxoDetails.utxos).toHaveLength(1);
    expect(utxoDetails.total_amount_available).toBe(3);
    expect(utxoDetails.total_utxos_available).toBe(1);
    expect(utxoDetails.total_amount_locked).toBe(0);
    expect(utxoDetails.total_utxos_locked).toBe(0);
  });

  test("filter by amount_smaller_than", () => {
    const utxoDetails = hathorWallet.getUtxos({
      token: "02",
      amount_smaller_than: 1.5,
    });
    expect(utxoDetails.utxos).toHaveLength(1);
    expect(utxoDetails.total_amount_available).toBe(1);
    expect(utxoDetails.total_utxos_available).toBe(1);
    expect(utxoDetails.total_amount_locked).toBe(0);
    expect(utxoDetails.total_utxos_locked).toBe(0);
  });

  test("filter only_available utxos", () => {
    const utxoDetails = hathorWallet.getUtxos({ only_available_utxos: true });
    expect(utxoDetails.utxos).toHaveLength(2);
  });

  test("correctly execute consolidateUtxos", async () => {
    const result = await hathorWallet.consolidateUtxos(destinationAddress);
    expect(hathorWallet.sendManyOutputsTransaction).toBeCalled();
    expect(result.total_utxos_consolidated).toBe(2);
    expect(result.total_amount).toBe(2);
    expect(result.tx_id).toBe("123");
    expect(result.utxos).toHaveLength(2);
    expect(result.utxos.some((utxo) => utxo.locked)).toBeFalsy();
    // assert single output
    expect(hathorWallet.sendManyOutputsTransaction.mock.calls[0][0]).toEqual([
      { address: destinationAddress, value: 2, token: "00" },
    ]);
    // assert 2 inputs only
    expect(
      hathorWallet.sendManyOutputsTransaction.mock.calls[0][1].inputs
    ).toHaveLength(2);
  });

  test("all HTR utxos locked by height", () => {
    wallet._rewardSpendMinBlocks = 10;
    const utxoDetails = hathorWallet.getUtxos();
    expect(utxoDetails.utxos).toHaveLength(3);
    expect(utxoDetails.total_utxos_locked).toBe(3);
    wallet._rewardSpendMinBlocks = 0;
  });

  test("throw error when there is no utxo to consolidade", async () => {
    await expect(
      hathorWallet.consolidateUtxos(destinationAddress, { token: "05" })
    ).rejects.toEqual(new Error("No available utxo to consolidate."));
  });

  test("throw error for invalid destinationAddress", async () => {
    await expect(
      hathorWallet.consolidateUtxos(invalidDestinationAddress)
    ).rejects.toEqual(new Error("Utxo consolidation to an address not owned by this wallet isn\'t allowed."));
  });
});

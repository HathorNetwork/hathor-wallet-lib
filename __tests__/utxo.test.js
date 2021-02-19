import wallet from "../src/wallet";
import HathorWallet from "../src/new/wallet";
import txHistoryFixture from "./__fixtures__/tx_history";
import transaction from "../src/transaction";

class FakeHathorWallet {
  constructor() {
    this.wallet = wallet;
    this.getUtxos = HathorWallet.prototype.getUtxos.bind(this);
    this.consolidateUtxos = HathorWallet.prototype.consolidateUtxos.bind(this);
    this.sendManyOutputsTransaction = jest.fn(() => ({
      success: true,
      promise: Promise.resolve({ tx_id: "123" }),
    }));
  }
  getTxHistory() {
    return txHistoryFixture;
  }
}

describe("UTXO Consolidation", () => {
  let hathorWallet;
  const destinationAddress = "WVGxdgZMHkWo2Hdrb1sEFedNdjTXzjvjPi";
  beforeAll(() => {
    transaction.updateMaxInputsConstant(255);
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

  test("correctly execute consolidateUtxos", async () => {
    const result = await hathorWallet.consolidateUtxos(destinationAddress);
    expect(hathorWallet.sendManyOutputsTransaction).toBeCalled();
    expect(result.total_utxos_consolidated).toBe(3);
    expect(result.total_amount).toBe(3);
    expect(result.tx_id).toBe("123");
    expect(result.utxos).toHaveLength(3);
  });
});

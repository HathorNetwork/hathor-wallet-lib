import HathorWalletServiceWallet from '../../src/wallet/wallet';
import { SCANNING_POLICY } from '../../src/types';
import walletApi from '../../src/wallet/api/walletApi';
import Network from '../../src/models/network';
import { defaultWalletSeed } from '../__mock_helpers__/wallet-service.fixtures';

describe('enableSingleAddressMode', () => {
  let wallet: HathorWalletServiceWallet;

  beforeEach(() => {
    wallet = new HathorWalletServiceWallet({
      requestPassword: async () => 'password',
      seed: defaultWalletSeed,
      network: new Network('testnet'),
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    try {
      await wallet.stop();
    } catch (_e) {
      // ignore
    }
  });

  it('should throw if wallet is not ready', async () => {
    await expect(wallet.enableSingleAddressMode()).rejects.toThrow('Wallet not ready');
  });

  it('should throw if there are transactions outside first address', async () => {
    // Force wallet to ready state
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any).state = 'Ready';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any).firstAddress = 'addr0';

    // Mock getAddresses to return addresses with tx on index > 0
    jest.spyOn(walletApi, 'getHasTxOutsideFirstAddress').mockResolvedValue({
      success: true,
      hasTransactions: true,
    });

    await expect(wallet.enableSingleAddressMode()).rejects.toThrow(
      'Cannot enable single-address policy: wallet has transactions on addresses other than the first'
    );
  });

  it('should succeed when only first address has transactions', async () => {
    // Force wallet to ready state
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any).state = 'Ready';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any).firstAddress = 'addr0';

    // Mock getAddresses to return only first address with txs
    jest.spyOn(walletApi, 'getHasTxOutsideFirstAddress').mockResolvedValue({
      success: true,
      hasTransactions: false,
    });

    await wallet.enableSingleAddressMode();

    // Verify scanning policy was updated
    const policyData = await wallet.storage.getScanningPolicyData();
    expect(policyData.policy).toBe(SCANNING_POLICY.SINGLE_ADDRESS);
  });

  it('getCurrentAddress should always return first address in single-address mode', async () => {
    // Force wallet to ready state and single-address mode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any).state = 'Ready';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any).singleAddress = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any).firstAddress = 'addr0';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any).newAddresses = [
      { address: 'addr0', index: 0, addressPath: "m/44'/280'/0'/0/0" },
      { address: 'addr1', index: 1, addressPath: "m/44'/280'/0'/0/1" },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any).indexToUse = 0;

    // markAsUsed should not advance
    const addr1 = wallet.getCurrentAddress({ markAsUsed: true });
    expect(addr1.address).toBe('addr0');

    const addr2 = wallet.getCurrentAddress({ markAsUsed: true });
    expect(addr2.address).toBe('addr0');
  });

  it('getNextAddress should return same address in single-address mode', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any).state = 'Ready';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any).singleAddress = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any).firstAddress = 'addr0';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any).newAddresses = [
      { address: 'addr0', index: 0, addressPath: "m/44'/280'/0'/0/0" },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wallet as any).indexToUse = 0;

    const addr = wallet.getNextAddress();
    expect(addr.address).toBe('addr0');

    const addr1 = wallet.getNextAddress();
    expect(addr1.address).toBe('addr0');
  });
});

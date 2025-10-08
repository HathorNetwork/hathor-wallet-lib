import config from '../../src/config';
import { buildWalletInstance } from './helpers/service-facade.helper';
import { generateWalletHelper } from './helpers/wallet.helper';
import { HathorWallet, HathorWalletServiceWallet } from '../../src';

/** Default pin to simplify the tests */
const pinCode = '123456';
/** Default password to simplify the tests */
const password = 'testpass';

// Set base URL for the wallet service API inside the privatenet test container
config.setWalletServiceBaseUrl('http://localhost:3000/dev/');
config.setWalletServiceBaseWsUrl('ws://localhost:3001/');

describe('getCurrentAddress, getNextAddress', () => {
  it('should return the correct current and next address', async () => {
    const serviceWallet = buildWalletInstance();
    await serviceWallet.wallet.start({ pinCode, password });
    const nodeWallet = await generateWalletHelper();

    expect(() => testCurrentAddress(serviceWallet.wallet, serviceWallet.addresses)).not.toThrow();
    expect(() => testCurrentAddress(nodeWallet, nodeWallet.preCalculatedAddresses!)).not.toThrow();

    async function testCurrentAddress(
      wallet: HathorWalletServiceWallet | HathorWallet,
      knownAddresses: string[]
    ) {
      let currentAddress = await wallet.getCurrentAddress();

      // Should return an object with index and address
      expect(currentAddress).toEqual(
        expect.objectContaining({
          index: expect.any(Number),
          address: expect.any(String),
        })
      );

      expect(currentAddress.index).toBeGreaterThanOrEqual(0);
      expect(knownAddresses).toContain(currentAddress.address);
      expect(currentAddress.addressPath).toMatch(/^m\/44'\/280'\/0'\/0\/\d+$/);
      expect(currentAddress.info).toBeFalsy(); // Validating currentAddress behavior

      currentAddress = await wallet.getCurrentAddress();
      expect(currentAddress).toMatchObject({
        index: 0,
        address: await wallet.getAddressAtIndex(0),
      });
      // Expect no change on second call
      currentAddress = await wallet.getCurrentAddress();
      expect(currentAddress).toMatchObject({
        index: 0,
        address: await wallet.getAddressAtIndex(0),
      });
      // Expect the same address for the last time when calling with markAsUsed parameters
      currentAddress = await wallet.getCurrentAddress({ markAsUsed: true });
      expect(currentAddress).toMatchObject({
        index: 0,
        address: await wallet.getAddressAtIndex(0),
      });
      // Now it won't return the used one
      currentAddress = await wallet.getCurrentAddress();
      expect(currentAddress).toMatchObject({
        index: 1,
        address: await wallet.getAddressAtIndex(1),
      });

      // Validating getNextAddress behavior
      let nextAddress = await wallet.getNextAddress();
      expect(nextAddress).toMatchObject({
        index: 2,
        address: await wallet.getAddressAtIndex(2),
      });
      // Expecting the next address index
      nextAddress = await wallet.getNextAddress();
      expect(nextAddress).toMatchObject({
        index: 3,
        address: await wallet.getAddressAtIndex(3),
      });
    }
  });
});

import { buildWalletToAuthenticateApiCall } from "./__fixtures__/wallet.fixtures";
import { mockAxiosAdapter } from "./__mocks__/wallet.mock";
import { PushNotification } from "../src/pushNotification";
import config from "../src/config";

test('registerDeviceToPushNotification', async () => {
  const wallet = buildWalletToAuthenticateApiCall();
  config.setWalletServiceBaseUrl('https://wallet-service.testnet.hathor.network/');

  mockAxiosAdapter.reset();
  mockAxiosAdapter
    .onPost('push/register')
    .replyOnce(200, {
      success: true,
    })
    .onPost('push/register')
    .replyOnce(400, {
      success: false,
      error: 'invalid-payload',
      details: [{ message: '"deviceId" length must be less than or equal to 256 characters long', path: ['deviceId'] }],
    });

  const successCall = PushNotification.registerDevice(wallet, { deviceId: '123', pushProvider: 'android', enablePush: true });
  
  await expect(successCall).resolves.toStrictEqual({ success: true });

  const invalidCall = PushNotification.registerDevice(wallet, { deviceId: '123', pushProvider: 'android', enablePush: true });

  await expect(invalidCall).rejects.toThrowError('Error registering device for push notification.');
});

test('updateDeviceToPushNotification', async () => {
  const wallet = buildWalletToAuthenticateApiCall();
  spyOn(wallet, 'isReady').and.returnValue(true);

  mockAxiosAdapter.reset();
  mockAxiosAdapter
    .onPut('push/update')
    .replyOnce(200, {
      success: true,
    })
    .onPut('push/update')
    .replyOnce(400, {
      success: false,
      error: 'invalid-payload',
      details: [{ message: '"deviceId" length must be less than or equal to 256 characters long', path: ['deviceId'] }],
    });

  const successCall = PushNotification.updateDevice(wallet, { deviceId: '123', enablePush: true, enableShowAmounts: true });
  
  await expect(successCall).resolves.toStrictEqual({ success: true });

  const invalidCall = PushNotification.updateDevice(wallet, { deviceId: '123', enablePush: true, enableShowAmounts: true });

  await expect(invalidCall).rejects.toThrowError('Error updating push notification settings for device.');
});

test('unregisterDeviceToPushNotification', async () => {
  const wallet = buildWalletToAuthenticateApiCall();
  spyOn(wallet, 'isReady').and.returnValue(true);

  mockAxiosAdapter.reset();
  mockAxiosAdapter
    .onPost('push/unregister')
    .replyOnce(200, {
      success: true,
    })
    .onPost('push/unregister')
    .replyOnce(400, {
      success: false,
      error: 'invalid-payload',
      details: [{ message: '"deviceId" length must be less than or equal to 256 characters long', path: ['deviceId'] }],
    });

  const successCall = PushNotification.unregisterDevice(wallet, { deviceId: '123' });
  
  await expect(successCall).resolves.toStrictEqual({ success: true });

  const invalidCall = PushNotification.unregisterDevice(wallet, { deviceId: '123' });

  await expect(invalidCall).rejects.toThrowError('Error unregistering wallet from push notifications.');
});

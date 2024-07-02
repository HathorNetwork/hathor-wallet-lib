import { mockAxiosAdapter } from './__mocks__/wallet.mock';
import { buildWalletToAuthenticateApiCall } from './__mock_helpers/wallet-service.fixtures';
import { PushNotification, PushNotificationProvider } from '../src/pushNotification';
import config from '../src/config';

test('registerDevice', async () => {
  const wallet = buildWalletToAuthenticateApiCall();
  jest.spyOn(wallet, 'isReady').mockReturnValue(true);
  config.setWalletServiceBaseUrl('https://wallet-service.testnet.hathor.network/');

  mockAxiosAdapter.reset();
  mockAxiosAdapter
    .onPost('wallet/push/register')
    .replyOnce(200, {
      success: true,
    })
    .onPost('wallet/push/register')
    .replyOnce(400, {
      success: false,
      error: 'invalid-payload',
      details: [
        {
          message: '"deviceId" length must be less than or equal to 256 characters long',
          path: ['deviceId'],
        },
      ],
    });

  const successCall = PushNotification.registerDevice(wallet, {
    deviceId: '123',
    pushProvider: PushNotificationProvider.ANDROID,
    enablePush: true,
  });

  await expect(successCall).resolves.toStrictEqual({ success: true });

  const invalidCall = PushNotification.registerDevice(wallet, {
    deviceId: '123',
    pushProvider: PushNotificationProvider.ANDROID,
    enablePush: true,
  });

  await expect(invalidCall).rejects.toThrowError('Error registering device for push notification.');
});

test('updateDevice', async () => {
  const wallet = buildWalletToAuthenticateApiCall();
  jest.spyOn(wallet, 'isReady').mockReturnValue(true);

  mockAxiosAdapter.reset();
  mockAxiosAdapter
    .onPut('wallet/push/update')
    .replyOnce(200, {
      success: true,
    })
    .onPut('wallet/push/update')
    .replyOnce(400, {
      success: false,
      error: 'invalid-payload',
      details: [
        {
          message: '"deviceId" length must be less than or equal to 256 characters long',
          path: ['deviceId'],
        },
      ],
    });

  const successCall = PushNotification.updateDevice(wallet, {
    deviceId: '123',
    enablePush: true,
    enableShowAmounts: true,
  });

  await expect(successCall).resolves.toStrictEqual({ success: true });

  const invalidCall = PushNotification.updateDevice(wallet, {
    deviceId: '123',
    enablePush: true,
    enableShowAmounts: true,
  });

  await expect(invalidCall).rejects.toThrowError(
    'Error updating push notification settings for device.'
  );
});

test('unregisterDevice', async () => {
  const wallet = buildWalletToAuthenticateApiCall();
  jest.spyOn(wallet, 'isReady').mockReturnValue(true);

  mockAxiosAdapter.reset();
  mockAxiosAdapter
    .onDelete('wallet/push/unregister/123')
    .replyOnce(200, {
      success: true,
    })
    .onDelete('wallet/push/unregister/123')
    .replyOnce(400, {
      success: false,
      error: 'invalid-payload',
      details: [
        {
          message: '"deviceId" length must be less than or equal to 256 characters long',
          path: ['deviceId'],
        },
      ],
    });

  const successCall = PushNotification.unregisterDevice(wallet, '123');

  await expect(successCall).resolves.toStrictEqual({ success: true });

  const invalidCall = PushNotification.unregisterDevice(wallet, '123');

  await expect(invalidCall).rejects.toThrowError(
    'Error unregistering wallet from push notifications.'
  );
});

import walletApi from './wallet/api/walletApi';
import HathorWalletServiceWallet from './wallet/wallet';

export class PushNotification {

  /**
   * Register the device to receive push notifications
   *
   * @memberof PushNotification
   * @inner
   */
  static async registerDevice(wallet: HathorWalletServiceWallet, payload: PushRegisterRequestData): Promise<PushNotificationResult> {
    wallet.failIfWalletNotReady();
    const data = await walletApi.pushRegister(wallet, payload);
    return data;
  }

  /**
   * Update the device settings to receive push notifications
   *
   * @memberof PushNotification
   * @inner
   */
  static async updateDevice(wallet: HathorWalletServiceWallet, payload: PushUpdateRequestData): Promise<PushNotificationResult> {
    wallet.failIfWalletNotReady();
    const data = await walletApi.pushUpdate(wallet, payload);
    return data;
  }

  /**
   * Delete the device from the push notification service
   *
   * @memberof PushNotification
   * @inner
   */
  static async unregisterDevice(wallet: HathorWalletServiceWallet, deviceId: string): Promise<PushNotificationResult> {
    wallet.failIfWalletNotReady();
    const data = await walletApi.pushUnregister(wallet, deviceId);
    return data;
  }
}

export interface PushNotificationResponseData {
  success: boolean,
  error?: string,
  /** This property shows up in case of validation error. */
  details?: {message: string, path: string}[]
};

export interface PushNotificationResult {
  success: boolean,
}

enum PushNotificationProvider {
  IOS = 'ios',
  ANDROID = 'android',
}

export interface PushRegisterRequestData {
  pushProvider: PushNotificationProvider,
  deviceId: string,
  enablePush?: boolean,
  enableShowAmounts?: boolean,
};

export interface PushRegisterResponseData extends PushNotificationResponseData {};

export interface PushUpdateRequestData {
  deviceId: string,
  enablePush: boolean,
  enableShowAmounts: boolean,
};

export interface PushUpdateResponseData extends PushNotificationResponseData {};

export interface PushUnregisterRequestData {
  deviceId: string,
}

export interface PushUnregisterResponseData extends PushNotificationResponseData {};
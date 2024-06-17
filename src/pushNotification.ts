import HathorWalletServiceWallet from './wallet/wallet';
import { axiosInstance } from './wallet/api/walletServiceAxios';
import { WalletRequestError } from './errors';

export class PushNotification {
  /**
   * Register the device to receive push notifications
   *
   * @memberof PushNotification
   * @inner
   */
  static async registerDevice(
    wallet: HathorWalletServiceWallet,
    payload: PushRegisterRequestData
  ): Promise<PushNotificationResult> {
    wallet.failIfWalletNotReady();
    const data = await walletServiceClient.pushRegister(wallet, payload);
    return data;
  }

  /**
   * Update the device settings to receive push notifications
   *
   * @memberof PushNotification
   * @inner
   */
  static async updateDevice(
    wallet: HathorWalletServiceWallet,
    payload: PushUpdateRequestData
  ): Promise<PushNotificationResult> {
    wallet.failIfWalletNotReady();
    const data = await walletServiceClient.pushUpdate(wallet, payload);
    return data;
  }

  /**
   * Delete the device from the push notification service
   *
   * @memberof PushNotification
   * @inner
   */
  static async unregisterDevice(
    wallet: HathorWalletServiceWallet,
    deviceId: string
  ): Promise<PushNotificationResult> {
    wallet.failIfWalletNotReady();
    const data = await walletServiceClient.pushUnregister(wallet, deviceId);
    return data;
  }
}

const walletServiceClient = {
  async pushRegister(
    wallet: HathorWalletServiceWallet,
    payload: PushRegisterRequestData
  ): Promise<PushRegisterResponseData> {
    const axios = await axiosInstance(wallet, true);

    const response = await axios.post<PushRegisterResponseData>('wallet/push/register', payload);
    if (response.status === 200 && response.data.success) {
      return response.data;
    }
    throw new WalletRequestError('Error registering device for push notification.', {
      cause: response.data,
    });
  },

  async pushUpdate(
    wallet: HathorWalletServiceWallet,
    payload: PushUpdateRequestData
  ): Promise<PushUpdateResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.put<PushUpdateResponseData>('wallet/push/update', payload);
    if (response.status === 200 && response.data.success) {
      return response.data;
    }
    throw new WalletRequestError('Error updating push notification settings for device.', {
      cause: response.data,
    });
  },

  async pushUnregister(
    wallet: HathorWalletServiceWallet,
    deviceId: string
  ): Promise<PushUnregisterResponseData> {
    const axios = await axiosInstance(wallet, true);
    const response = await axios.delete(`wallet/push/unregister/${deviceId}`);
    if (response.status === 200 && response.data.success) {
      return response.data;
    }
    throw new WalletRequestError('Error unregistering wallet from push notifications.', {
      cause: response.data,
    });
  },
};

export interface PushNotificationResult {
  success: boolean;
}

export enum PushNotificationProvider {
  IOS = 'ios',
  ANDROID = 'android',
}

export interface PushNotificationResponseData {
  success: boolean;
  error?: string;
  /** This property shows up in case of validation error. */
  details?: { message: string; path: string }[];
}

export interface PushRegisterRequestData {
  pushProvider: PushNotificationProvider;
  deviceId: string;
  enablePush?: boolean;
  enableShowAmounts?: boolean;
}

export interface PushRegisterResponseData extends PushNotificationResponseData {}

export interface PushUpdateRequestData {
  deviceId: string;
  enablePush: boolean;
  enableShowAmounts: boolean;
}

export interface PushUpdateResponseData extends PushNotificationResponseData {}

export interface PushUnregisterResponseData extends PushNotificationResponseData {}

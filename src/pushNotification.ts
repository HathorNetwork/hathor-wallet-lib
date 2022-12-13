import walletApi from './wallet/api/walletApi';
import { PushNotificationResult, PushRegisterRequestData, PushUnregisterRequestData, PushUpdateRequestData } from './wallet/types';
import HathorWalletServiceWallet from './wallet/wallet';

export class PushNotification {

  /**
   * Register the device to receive push notifications
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  static async registerDevice(wallet: HathorWalletServiceWallet, payload: PushRegisterRequestData): Promise<PushNotificationResult> {
    const data = await walletApi.pushRegister(wallet, payload);
    return data;
  }

  /**
   * Update the device settings to receive push notifications
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  static async updateDevice(wallet: HathorWalletServiceWallet, payload: PushUpdateRequestData): Promise<PushNotificationResult> {
    const data = await walletApi.pushUpdate(wallet, payload);
    return data;
  }

  /**
   * Delete the device from the push notification service
   *
   * @memberof HathorWalletServiceWallet
   * @inner
   */
  static async unregisterDevice(wallet: HathorWalletServiceWallet, payload: PushUnregisterRequestData): Promise<PushNotificationResult> {
    const data = await walletApi.pushUnregister(wallet, payload);
    return data;
  }
}

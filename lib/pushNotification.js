"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PushNotificationProvider = exports.PushNotification = void 0;
var _walletServiceAxios = require("./wallet/api/walletServiceAxios");
var _errors = require("./errors");
class PushNotification {
  /**
   * Register the device to receive push notifications
   *
   * @memberof PushNotification
   * @inner
   */
  static async registerDevice(wallet, payload) {
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
  static async updateDevice(wallet, payload) {
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
  static async unregisterDevice(wallet, deviceId) {
    wallet.failIfWalletNotReady();
    const data = await walletServiceClient.pushUnregister(wallet, deviceId);
    return data;
  }
}
exports.PushNotification = PushNotification;
const walletServiceClient = {
  async pushRegister(wallet, payload) {
    const axios = await (0, _walletServiceAxios.axiosInstance)(wallet, true);
    const response = await axios.post('wallet/push/register', payload);
    if (response.status === 200 && response.data.success) {
      return response.data;
    }
    throw new _errors.WalletRequestError('Error registering device for push notification.', {
      cause: response.data
    });
  },
  async pushUpdate(wallet, payload) {
    const axios = await (0, _walletServiceAxios.axiosInstance)(wallet, true);
    const response = await axios.put('wallet/push/update', payload);
    if (response.status === 200 && response.data.success) {
      return response.data;
    }
    throw new _errors.WalletRequestError('Error updating push notification settings for device.', {
      cause: response.data
    });
  },
  async pushUnregister(wallet, deviceId) {
    const axios = await (0, _walletServiceAxios.axiosInstance)(wallet, true);
    const response = await axios.delete(`wallet/push/unregister/${deviceId}`);
    if (response.status === 200 && response.data.success) {
      return response.data;
    }
    throw new _errors.WalletRequestError('Error unregistering wallet from push notifications.', {
      cause: response.data
    });
  }
};
let PushNotificationProvider = exports.PushNotificationProvider = /*#__PURE__*/function (PushNotificationProvider) {
  PushNotificationProvider["IOS"] = "ios";
  PushNotificationProvider["ANDROID"] = "android";
  return PushNotificationProvider;
}({});
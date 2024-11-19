import HathorWalletServiceWallet from './wallet/wallet';
export declare class PushNotification {
    /**
     * Register the device to receive push notifications
     *
     * @memberof PushNotification
     * @inner
     */
    static registerDevice(wallet: HathorWalletServiceWallet, payload: PushRegisterRequestData): Promise<PushNotificationResult>;
    /**
     * Update the device settings to receive push notifications
     *
     * @memberof PushNotification
     * @inner
     */
    static updateDevice(wallet: HathorWalletServiceWallet, payload: PushUpdateRequestData): Promise<PushNotificationResult>;
    /**
     * Delete the device from the push notification service
     *
     * @memberof PushNotification
     * @inner
     */
    static unregisterDevice(wallet: HathorWalletServiceWallet, deviceId: string): Promise<PushNotificationResult>;
}
export interface PushNotificationResult {
    success: boolean;
}
export declare enum PushNotificationProvider {
    IOS = "ios",
    ANDROID = "android"
}
export interface PushNotificationResponseData {
    success: boolean;
    error?: string;
    /** This property shows up in case of validation error. */
    details?: {
        message: string;
        path: string;
    }[];
}
export interface PushRegisterRequestData {
    pushProvider: PushNotificationProvider;
    deviceId: string;
    enablePush?: boolean;
    enableShowAmounts?: boolean;
}
export interface PushRegisterResponseData extends PushNotificationResponseData {
}
export interface PushUpdateRequestData {
    deviceId: string;
    enablePush: boolean;
    enableShowAmounts: boolean;
}
export interface PushUpdateResponseData extends PushNotificationResponseData {
}
export interface PushUnregisterResponseData extends PushNotificationResponseData {
}
//# sourceMappingURL=pushNotification.d.ts.map
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/**
 * Util methods to help handle date
 *
 * @namespace Date
 */
declare const dateFormatter: {
    /**
     * Get locale date from timestamp
     * en-US date format (m/d/yyyy hh:mm:ss AM/PM)
     *
     * @param {number} timestamp Timestamp to be parsed
     *
     * @return {string} Locale date and time
     *
     * @memberof Date
     * @inner
     */
    parseTimestamp(timestamp: number, timezone?: string | null): string;
    /**
     * Get formatted seconds
     * From seconds transform into days, hours, minutes and seconds
     *
     * @param paramUptime Seconds of uptime
     *
     * @return Formatted uptime seconds
     *
     * @memberof Date
     * @inner
     */
    uptimeFormat(paramUptime: number): string;
    /**
     * Get timestamp from date
     *
     * @param {Object} date Date object to get timestamp from
     *
     * @return {number} Timestamp of the date
     *
     * @memberof Date
     * @inner
     */
    dateToTimestamp(date: Date): number;
};
export default dateFormatter;
//# sourceMappingURL=date.d.ts.map
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
const dateFormatter = {
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
  parseTimestamp(timestamp: number, timezone: string|null = null): string {
    const d = new Date(timestamp*1000); // new Date in js expect milliseconds
    const options = (timezone ? { timeZone: timezone } : {})
    return `${d.toLocaleDateString('en-US', options)} ${d.toLocaleTimeString('en-US', options)}`;
  },

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
  dateToTimestamp(date: Date): number {
    return Math.floor(date.getTime() / 1000);
  }
};


export default dateFormatter;

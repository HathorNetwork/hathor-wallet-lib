'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
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
var dateFormatter = {
  /**
   * Get locale date from timestamp
   *
   * @param {number} timestamp Timestamp to be parsed
   *
   * @return {string} Locale date and time
   *
   * @memberof Date
   * @inner
   */
  parseTimestamp: function parseTimestamp(timestamp) {
    var d = new Date(timestamp * 1000); // new Date in js expect milliseconds
    return d.toLocaleDateString('en-US') + ' ' + d.toLocaleTimeString('en-US');
  },


  /**
   * Get date from timestamp
   *
   * @param {number} timestamp Timestamp to be parsed
   *
   * @return {string} Date string
   *
   * @memberof Date
   * @inner
   */
  timestampToString: function timestampToString(timestamp) {
    return new Date(timestamp * 1000).toString();
  },


  /**
   * Get formatted seconds
   * From seconds transform into days, hours, minutes and seconds
   *
   * @param {number} uptime Seconds of uptime
   *
   * @return {string} Formatted uptime seconds
   *
   * @memberof Date
   * @inner
   */
  uptimeFormat: function uptimeFormat(uptime) {
    uptime = Math.floor(uptime);
    var days = Math.floor(uptime / 3600 / 24);
    uptime = uptime % (3600 * 24);
    var hours = Math.floor(uptime / 3600);
    uptime = uptime % 3600;
    var minutes = Math.floor(uptime / 60);
    uptime = uptime % 60;
    var seconds = uptime;
    var pad = function pad(n) {
      return Math.abs(n) >= 10 ? n : '0' + n;
    };
    var uptime_str = days + ' days, ' + pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
    return uptime_str;
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
  dateToTimestamp: function dateToTimestamp(date) {
    return Math.floor(date.getTime() / 1000);
  }
};

exports.default = dateFormatter;
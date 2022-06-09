/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable no-console */

import winston from './placeholder-logger.util';
import testConfig from '../configuration/test.config';

export const loggers = {
  /**
   * @type: TxLogger
   */
  test: null,
  walletBenchmark: null,
  txBenchmark: null,
};

/**
 * A logger for every transaction on the integration tests for debugging.
 */
export class LoggerUtil {
  /**
   * @type: string
   * Stores the log filename, which is built on the constructor.
   */
  #instanceFilename;

  /**
   * Winston logger instance
   * @type {winston}
   */
  #logger;

  /**
   * Builds the log filename based on current time and an optional title.
   * The resulting filename will be in the format:
   * <pre><code>
   * 20220224T084737-title-integrationTest.log
   * </pre></code>
   * @param {string} [title] Optional title. Keep it short and simple for readability
   * @param [options]
   * @param {boolean} [options.reusableFilename] If true, the file will not have a timestamp
   */
  constructor(title, options = { reusableFilename: false }) {
    const date = new Date();

    /**
     * Timestamp in a format like "20220224T084737" for easy human reading on a filename
     * @type {string}
     */
    const humanReadableTimestamp = date.toISOString()
      .replace(/-/g, '') // Remove date separator
      .replace(/:/g, '') // Remove hour separator
      .split('.')[0]; // Get only the seconds integer

    const additionalTitle = title ? `-${title}` : '';
    const filename = options.reusableFilename
      ? `${title}.log`
      : `${humanReadableTimestamp}${additionalTitle}-integrationTest.log`;
    this.#instanceFilename = filename;
  }

  get filename() {
    return this.#instanceFilename;
  }

  /**
   * Initializes the helper with a logger instance
   * @param [options]
   * @param {boolean} [options.filePrettyPrint] If true, the file will have pretty print
   * @returns {void}
   */
  init(options = { filePrettyPrint: false }) {
    const consoleOptions = {
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
      ),
      level: testConfig.consoleLevel || 'silly',
    };
    const fileOptions = {
      format: options.filePrettyPrint
        ? winston.format.combine(
          winston.format.timestamp(),
          winston.format.prettyPrint()
        )
        : winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
      filename: `${testConfig.logOutputFolder}${this.#instanceFilename}`,
      level: testConfig.consoleLevel || 'silly',
    };

    this.#logger = winston.createLogger({
      defaultMeta: { service: 'txLogger', suite: this.#instanceFilename },
      transports: [
        new winston.transports.Console(consoleOptions),
        new winston.transports.File(fileOptions)
      ]
    });

    this.#logger.info('Log initialized');
  }

  /**
   * Most common interaction: append a log message into the file
   *
   * @param {string} input Log Message
   * @param {Record<string,unknown>} [metadata] Additional data for winston logs
   * @returns {void}
   */
  log(input, metadata) {
    this.#logger.info(input, metadata);
  }

  /**
   * On situations that demand attention, but are not failures
   *
   * @param {string} input Log Message
   * @param {Record<string,unknown>} [metadata] Additional data for winston logs
   * @returns {void}
   */
  warn(input, metadata) {
    this.#logger.warn(input, metadata);
  }

  /**
   * For registering errors related to blockchain interaction.
   *
   * @param {string} input Log Message
   * @param {Record<string,unknown>} [metadata] Additional data for winston logs
   * @returns {void}
   */
  error(input, metadata) {
    this.#logger.error(input, metadata);
  }
}

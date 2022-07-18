/*
 * This file is a placeholder logger to replace winston while we discuss if we
 * want to have it as a dev-dependency or not.
 */

function getStringifiedLogObject(message, metadata) {
  const timestamp = (new Date()).toISOString();
  const logObj = { timestamp, ...metadata, message };
  return JSON.stringify(logObj);
}

export default class PlaceholderLoggerUtil {
  static format = {
    timestamp: () => {},
    colorize: () => {},
    prettyPrint: () => {},
    combine: () => {},
    json: () => {},
  };

  static transports = {
    Console: class FakeConsole { constructor() {} },
    File: class FakeFile { constructor() {} },
  };

  static createLogger() {
    return {
      log(message, metadata) {
        console.log(getStringifiedLogObject(message, metadata));
      },
      info(message, metadata) {
        console.info(getStringifiedLogObject(message, metadata));
      },
      warn(message, metadata) {
        console.warn(getStringifiedLogObject(message, metadata));
      },
      error(message, metadata) {
        console.error(getStringifiedLogObject(message, metadata));
      }
    };
  }
}

/*
 * This file is a placeholder logger to replace winston while we discuss if we
 * want to have it as a dev-dependency or not.
 */
export default class PlaceholderLoggerUtil {
  static format = {
    timestamp: () => {},
    colorize: () => {},
    prettyPrint: () => {},
    combine: () => {},
    json: () => {},
  }

  static transports = {
    Console: class FakeConsole { constructor() {} },
    File: class FakeFile { constructor() {} },
  }

  static createLogger() {
    return {
      info(message, metadata) {
        const logObj = { ...metadata, message }
        console.log(JSON.stringify(logObj));
      },
      warn(message, metadata) {
        const logObj = { ...metadata, message }
        console.log(JSON.stringify(logObj));
      },
      error(message, metadata) {
        const logObj = { ...metadata, message }
        console.log(JSON.stringify(logObj));
      }
    }
  }
}

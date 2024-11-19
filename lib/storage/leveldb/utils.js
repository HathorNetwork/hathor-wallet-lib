"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.checkLevelDbVersion = checkLevelDbVersion;
var _errors = require("./errors");
/**
 * Check that the index version matches the expected version.
 *
 * @param instanceName Database instance name
 * @param db Level instance
 * @param indexVersion Database index version
 * @async
 */
async function checkLevelDbVersion(instanceName, db, indexVersion) {
  try {
    const dbVersion = await db.get('version');
    if (indexVersion !== dbVersion) {
      throw new Error(`Database version mismatch for ${instanceName}: database version (${dbVersion}) expected version (${indexVersion})`);
    }
  } catch (err) {
    if ((0, _errors.errorCodeOrNull)(err) === _errors.KEY_NOT_FOUND_CODE) {
      // This is a new db, add version and return
      await db.put('version', indexVersion);
      return;
    }
    throw err;
  }
}
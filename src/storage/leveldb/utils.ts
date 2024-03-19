import { Level } from "level";
import { errorCodeOrNull, KEY_NOT_FOUND_CODE } from "./errors";

/**
 * Check that the index version matches the expected version.
 *
 * @param instanceName Database instance name
 * @param db Level instance
 * @param indexVersion Database index version
 * @async
 */
export async function checkLevelDbVersion(instanceName: string, db: Level, indexVersion: string): Promise<void> {
  try {
    const dbVersion = await db.get('version');
    if (indexVersion !== dbVersion) {
      throw new Error(`Database version mismatch for ${instanceName}: database version (${dbVersion}) expected version (${indexVersion})`);
    }
  } catch (err: unknown) {
    if (errorCodeOrNull(err) === KEY_NOT_FOUND_CODE) {
      // This is a new db, add version and return
      await db.put('version', indexVersion);
      return;
    }
    throw err;
  }
}

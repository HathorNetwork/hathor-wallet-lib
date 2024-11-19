import { Level } from 'level';
/**
 * Check that the index version matches the expected version.
 *
 * @param instanceName Database instance name
 * @param db Level instance
 * @param indexVersion Database index version
 * @async
 */
export declare function checkLevelDbVersion(instanceName: string, db: Level, indexVersion: string): Promise<void>;
//# sourceMappingURL=utils.d.ts.map
import { EventEmitter } from 'events';
import PQueue from 'queue-promise';
import { ILogger } from '../types';
import { GlobalLoadLockTaskError } from '../errors';

const MAX_CONCURRENT_LOAD_TASKS = 3;

const GLL = new PQueue({ concurrent: MAX_CONCURRENT_LOAD_TASKS });
const GLLEvents = new EventEmitter();

GLL.on('resolve', data => {
  GLLEvents.emit(data, true);
});

GLL.on('reject', data => {
  GLLEvents.emit(data.taskId, false, data.innerError);
});

/**
 * Add task to the GLL and return a promise that will resolve or reject when the task resolves or rejects.
 * @param task The task to execute.
 * @param logger Logger instance to use.
 */
export function addTask(task: () => Promise<void>, logger: ILogger) {
  const taskId = Math.random().toString(36).substring(2, 15);
  const startTime = Date.now();
  // This promise will resolve or reject when the task does, so the caller can know his task has ended.
  const promise = new Promise<void>((resolve, reject) => {
   GLLEvents.once(taskId, (success, error) => {
      if (success) {
        resolve();
      } else {
        reject(error);
      }
    });
  });

  /**
   * Add the task to the queue and return or rejects with the taskId
   * So the promise above can detect any issues and reject correctly.
   */
  GLL.enqueue(async () => {
    try {
      logger.info(`Task waited on queue for ${(Date.now() - startTime) / 1000}s`);
      await task();
      return taskId;
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new GlobalLoadLockTaskError(taskId, error);
      }
      throw new GlobalLoadLockTaskError(taskId, new Error(`${error}`));
    }
  });

  return promise;
}

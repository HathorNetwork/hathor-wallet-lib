import PQueue from 'queue-promise';
import { ILogger } from '../types';
import { GllTaskError } from '../errors';

let GLL = new PQueue({ concurrent: 5 });

export function setConcurrency(value: number) {
  GLL = new PQueue({ concurrent: value });
}

export function addTask(task: () => Promise<void>, logger: ILogger) {
  const taskId = Math.random().toString(36).substring(2, 15);
  const startTime = Date.now();
  const promise = new Promise<void>((resolve, reject) => {
    GLL.on('resolve', data => {
      if (data === taskId) {
        resolve();
      }
    });

    GLL.on('reject', data => {
      if (data.taskId === taskId) {
        reject(data.innerError);
      }
    });
  });

  GLL.enqueue(async () => {
    try {
      logger.info(`Task waited on queue for ${(Date.now() - startTime) / 1000}s`);
      await task();
      return taskId;
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new GllTaskError(taskId, error);
      }
      throw new GllTaskError(taskId, new Error(`${error}`));
    }
  });

  return promise;
}

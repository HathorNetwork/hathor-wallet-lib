import PQueue from 'queue-promise';
import { ILogger } from '../types';

let GLL = new PQueue({ concurrent: 2 });

export function setConcurrency(value: number) {
  GLL = new PQueue({ concurrent: value });
}

export function addTask(task: () => Promise<void>, logger: ILogger) {
  const taskId = Math.random().toString(36).substring(2, 15);
  const startTime = Date.now();
  const promise = new Promise<void>((resolve, reject) => {
    GLL.on('resolve', (data) => {
      if (data === taskId) {
        resolve();
      }
    });

    GLL.on('reject', (data) => {
      if (data.taskId === taskId) {
        reject(data.error);
      }
    });
  });

  GLL.enqueue(async () => {
    try {
      logger.info(`Task waited on queue for ${(Date.now() - startTime)/1000}s`);
      await task();
      return taskId;
    } catch(error) {
      throw {
        taskId,
        error,
      };
    }
  });

  return promise;
}

// export async function gll() {
//   const p1 = addTask(async () => {
//     console.log('p1 started!');
//     return new Promise(resolve => {
//       setTimeout(resolve, 2000);
//     });
//   });

//   const p2 = addTask(async () => {
//     console.log('p2 started!');
//     return new Promise(resolve => {
//       setTimeout(resolve, 2000);
//     });
//   });

//   const p3 = addTask(async () => {
//     console.log('p3 started!');
//     return new Promise(resolve => {
//       setTimeout(resolve, 2000);
//     });
//   });

//   await Promise.all([p1, p2, p3]);
//   console.log('finished');
// }

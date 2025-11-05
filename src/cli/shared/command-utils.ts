import { handleAsync } from '../../utils/error-handler.js';

export function safeAction<A extends any[]>(
  action: (...args: A) => Promise<void>,
  context: string
) {
  return async (...args: A) => {
    try {
      await action(...args);
    } catch (error) {
      try {
        await handleAsync(async () => {
          throw error;
        }, context);
      } finally {
        process.exitCode = 1;
      }
    }
  };
}

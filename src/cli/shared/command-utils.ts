import { handleAsync, isUserFriendlyError } from '../../utils/error-handler.js';

export function safeAction<A extends any[]>(
  action: (...args: A) => Promise<void>,
  context: string
) {
  return async (...args: A) => {
    try {
      await action(...args);
    } catch (error) {
      // User-friendly errors are already logged and handled by handleAsync inside action
      // Exit directly without re-throwing to prevent commander.js from printing stack trace
      if (isUserFriendlyError(error)) {
        process.exit(1);
        return;
      }

      // Handle other errors
      try {
        await handleAsync(async () => {
          throw error;
        }, context);
      } catch {
        // Error already handled, just ensure exit code
      }
      process.exitCode = 1;
      throw error;
    }
  };
}

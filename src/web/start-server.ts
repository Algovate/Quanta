import { APIServer } from './server.js';
import { UnifiedLogger } from '../logging/index.js';

const logger = UnifiedLogger.getInstance();
const loggerContext = 'Server';

const port = parseInt(process.env.PORT || '3001', 10);
const server = new APIServer(port);

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down server...', {}, loggerContext);
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down server...', {}, loggerContext);
  server.stop();
  process.exit(0);
});

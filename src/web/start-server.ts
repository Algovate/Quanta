import { APIServer } from './server.js';
import { Logger } from '../utils/logger.js';

const logger = Logger.getInstance('Server');

const port = parseInt(process.env.PORT || '3001', 10);
const server = new APIServer(port);

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down server...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down server...');
  server.stop();
  process.exit(0);
});

/**
 * Arena Routes - REST API endpoints for Arena management
 */

import { Router } from 'express';
import { ArenaManager } from '../../arena/index.js';
import {
  ArenaService,
  createListConfigsHandler,
  createGetConfigHandler,
  createStartArenaHandler,
  createStopArenaHandler,
  createGetTradesHandler,
  createGetPositionsHandler,
  createGetPerformanceHistoryHandler,
  createGetTickerPricesHandler,
  createGetConfigInfoHandler,
  createGetEventsHandler,
  createGetAICommentaryHandler,
  createGetStatusHandler,
  createListArenasHandler,
  createListRunningArenasHandler,
  createListHistoryArenasHandler,
  createGetDronesHandler,
  createGetComparisonHandler,
  createGetAIAnalysisHandler,
} from './arena/index.js';

/**
 * Register arena-related routes
 */
export function registerArenaRoutes(router: Router): void {
  const arenaManager = ArenaManager.getInstance();
  const arenaService = new ArenaService(arenaManager);

  // Config routes
  router.get('/api/arena/configs', createListConfigsHandler(arenaService));
  router.get('/api/arena/configs/:configName', createGetConfigHandler(arenaService));

  // Lifecycle routes
  router.post('/api/arena/start', createStartArenaHandler(arenaService));
  router.post('/api/arena/stop/:arenaId', createStopArenaHandler(arenaService));

  // Data routes
  router.get('/api/arena/:arenaId/positions', createGetPositionsHandler(arenaService));
  router.get(
    '/api/arena/:arenaId/performance-history',
    createGetPerformanceHistoryHandler(arenaService)
  );
  router.get('/api/arena/:arenaId/ticker-prices', createGetTickerPricesHandler(arenaService));
  router.get('/api/arena/:arenaId/trades', createGetTradesHandler(arenaService));

  // Status routes
  router.get('/api/arena/:arenaId/config-info', createGetConfigInfoHandler(arenaService));
  router.get('/api/arena/:arenaId/events', createGetEventsHandler(arenaService));
  router.get('/api/arena/:arenaId/ai-commentary', createGetAICommentaryHandler(arenaService));
  router.get('/api/arena/status/:arenaId', createGetStatusHandler(arenaService));
  router.get('/api/arena/list', createListArenasHandler(arenaService));
  router.get('/api/arena/running', createListRunningArenasHandler(arenaService));
  router.get('/api/arena/history', createListHistoryArenasHandler(arenaService));
  router.get('/api/arena/:arenaId/drones', createGetDronesHandler(arenaService));

  // Analysis routes
  router.get('/api/arena/:arenaId/comparison', createGetComparisonHandler(arenaService));
  router.get('/api/arena/:arenaId/ai-analysis', createGetAIAnalysisHandler(arenaService));
}

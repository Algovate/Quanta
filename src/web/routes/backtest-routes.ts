import { Router, Request, Response } from 'express';
import { Logger } from '../../utils/logger.js';
import { runBacktestService } from '../api-service.js';

const logger = Logger.getInstance('BacktestRoutes');

/**
 * Register backtest routes
 */
export function registerBacktestRoutes(router: Router): void {
  // Run backtest
  router.post('/api/backtest/run', async (req: Request, res: Response) => {
    try {
      const { start, end, coins, initialBalance } = req.body || {};

      // Basic validation
      if (!start || !end || !coins || !initialBalance) {
        return res
          .status(400)
          .json({ message: 'Missing required fields: start, end, coins, initialBalance' });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
      }
      if (startDate >= endDate) {
        return res.status(400).json({ message: 'Start date must be before end date' });
      }

      const parsedInitial = Number(initialBalance);
      if (!isFinite(parsedInitial) || parsedInitial <= 0) {
        return res.status(400).json({ message: 'Invalid initialBalance' });
      }

      const result = await runBacktestService({
        start,
        end,
        coins,
        initialBalance: parsedInitial,
      });
      res.json(result);
    } catch (error) {
      logger.error('Error running backtest', error);
      const msg = error instanceof Error ? error.message : 'Failed to run backtest';
      res.status(500).json({ message: msg });
    }
  });
}

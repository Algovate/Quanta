/**
 * Smart Execution Strategies
 * TWAP, VWAP, and Iceberg order execution
 */

import type { Exchange, Order } from '../exchange/types.js';
import { UnifiedLogger } from '../logging/index.js';

export interface ExecutionConfig {
  strategy: 'market' | 'limit' | 'twap' | 'vwap' | 'iceberg';
  duration?: number; // For TWAP (milliseconds)
  slices?: number; // For TWAP/Iceberg
  maxSliceSize?: number; // For Iceberg (absolute value)
  sliceInterval?: number; // For TWAP (milliseconds)
}

export interface SmartExecutionResult {
  success: boolean;
  orders: Order[];
  totalFilled: number;
  averagePrice: number;
  executionTime: number;
  error?: string;
}

/**
 * Smart Execution Manager
 * Executes orders using advanced strategies
 */
export class SmartExecutionManager {
  private logger: UnifiedLogger;
  private readonly context = 'SmartExecution';
  private activeExecutions: Map<
    string,
    {
      startTime: number;
      targetSize: number;
      filledSize: number;
      orders: Order[];
    }
  > = new Map();

  constructor(private exchange: Exchange) {
    this.logger = UnifiedLogger.getInstance();
  }

  /**
   * Execute order using smart execution strategy
   */
  async executeSmart(
    symbol: string,
    side: 'buy' | 'sell',
    totalSize: number,
    config: ExecutionConfig
  ): Promise<SmartExecutionResult> {
    const startTime = Date.now();
    const orders: Order[] = [];
    let totalFilled = 0;
    let totalValue = 0;

    try {
      switch (config.strategy) {
        case 'market':
          return await this.executeMarket(symbol, side, totalSize);

        case 'limit':
          return await this.executeLimit(symbol, side, totalSize);

        case 'twap':
          return await this.executeTWAP(symbol, side, totalSize, config);

        case 'vwap':
          return await this.executeVWAP(symbol, side, totalSize, config);

        case 'iceberg':
          return await this.executeIceberg(symbol, side, totalSize, config);

        default:
          return {
            success: false,
            orders: [],
            totalFilled: 0,
            averagePrice: 0,
            executionTime: Date.now() - startTime,
            error: `Unknown execution strategy: ${config.strategy}`,
          };
      }
    } catch (error) {
      this.logger.error(
        'Smart execution failed',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      return {
        success: false,
        orders,
        totalFilled,
        averagePrice: totalFilled > 0 ? totalValue / totalFilled : 0,
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute market order
   */
  private async executeMarket(
    symbol: string,
    side: 'buy' | 'sell',
    size: number
  ): Promise<SmartExecutionResult> {
    const startTime = Date.now();
    const order = await this.exchange.placeOrder(symbol, side, size); // market order: no price

    const filledSize = order.status === 'filled' ? order.amount : 0;
    const averagePrice = order.price && order.price > 0 ? order.price : 0;

    return {
      success: order.status === 'filled',
      orders: [order],
      totalFilled: filledSize,
      averagePrice,
      executionTime: Date.now() - startTime,
    };
  }

  /**
   * Execute limit order
   */
  private async executeLimit(
    symbol: string,
    side: 'buy' | 'sell',
    size: number
  ): Promise<SmartExecutionResult> {
    const startTime = Date.now();

    // Get current price for limit order
    const ticker = await this.exchange.getTicker(symbol);
    const currentPrice = (ticker as { price: number }).price;

    // Set limit price slightly better than market (aggressive)
    const limitPrice =
      side === 'buy'
        ? currentPrice * 0.9995 // 0.05% below market
        : currentPrice * 1.0005; // 0.05% above market

    const order = await this.exchange.placeOrder(symbol, side, size, limitPrice);

    const filledSize = order.status === 'filled' ? order.amount : 0;
    const averagePrice = order.price && order.price > 0 ? order.price : 0;

    return {
      success: order.status === 'filled',
      orders: [order],
      totalFilled: filledSize,
      averagePrice,
      executionTime: Date.now() - startTime,
    };
  }

  /**
   * Execute TWAP (Time-Weighted Average Price)
   * Splits order into slices over time
   */
  private async executeTWAP(
    symbol: string,
    side: 'buy' | 'sell',
    totalSize: number,
    config: ExecutionConfig
  ): Promise<SmartExecutionResult> {
    const startTime = Date.now();
    const duration = config.duration || 60000; // Default 1 minute
    const slices = config.slices || 5; // Default 5 slices
    const sliceInterval = config.sliceInterval || duration / slices;
    const sliceSize = totalSize / slices;

    const orders: Order[] = [];
    let totalFilled = 0;
    let totalValue = 0;

    this.logger.info(
      `Starting TWAP execution for ${symbol}: ${totalSize} over ${duration}ms in ${slices} slices`,
      {
        symbol,
        side,
        totalSize,
        duration,
        slices,
        sliceSize,
        sliceInterval,
      },
      this.context
    );

    for (let i = 0; i < slices; i++) {
      // Wait for slice interval (except first slice)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, sliceInterval));
      }

      // Get current price for limit order
      const ticker = await this.exchange.getTicker(symbol);
      const currentPrice = (ticker as { price: number }).price;

      // Set aggressive limit price
      const limitPrice = side === 'buy' ? currentPrice * 0.9995 : currentPrice * 1.0005;

      try {
        const order = await this.exchange.placeOrder(symbol, side, sliceSize, limitPrice);

        orders.push(order);

        if (order.status === 'filled' && order.price) {
          totalFilled += order.amount;
          totalValue += order.amount * order.price;
        }
      } catch (error) {
        this.logger.warn(
          `TWAP slice ${i + 1} failed`,
          {
            error: error instanceof Error ? error.message : String(error),
            slice: i + 1,
            totalSlices: slices,
          },
          this.context
        );
        // Continue with next slice
      }
    }

    const averagePrice = totalFilled > 0 ? totalValue / totalFilled : 0;

    return {
      success: totalFilled > 0,
      orders,
      totalFilled,
      averagePrice,
      executionTime: Date.now() - startTime,
    };
  }

  /**
   * Execute VWAP (Volume-Weighted Average Price)
   * Splits order based on volume distribution
   */
  private async executeVWAP(
    symbol: string,
    side: 'buy' | 'sell',
    totalSize: number,
    config: ExecutionConfig
  ): Promise<SmartExecutionResult> {
    // Simplified VWAP: execute in slices over time, mimicking volume distribution
    // In production, would use actual volume data to time slices
    const startTime = Date.now();
    const slices = config.slices || 5;
    const sliceSize = totalSize / slices;
    const sliceInterval = 12000; // 12 seconds per slice

    const orders: Order[] = [];
    let totalFilled = 0;
    let totalValue = 0;

    this.logger.info(
      `Starting VWAP execution for ${symbol}: ${totalSize} in ${slices} slices`,
      {
        symbol,
        side,
        totalSize,
        slices,
        sliceSize,
      },
      this.context
    );

    for (let i = 0; i < slices; i++) {
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, sliceInterval));
      }

      const ticker = await this.exchange.getTicker(symbol);
      const currentPrice = (ticker as { price: number }).price;

      const limitPrice = side === 'buy' ? currentPrice * 0.9995 : currentPrice * 1.0005;

      try {
        const order = await this.exchange.placeOrder(symbol, side, sliceSize, limitPrice);

        orders.push(order);

        if (order.status === 'filled' && order.price) {
          totalFilled += order.amount;
          totalValue += order.amount * order.price;
        }
      } catch (error) {
        this.logger.warn(
          `VWAP slice ${i + 1} failed`,
          {
            error: error instanceof Error ? error.message : String(error),
          },
          this.context
        );
      }
    }

    const averagePrice = totalFilled > 0 ? totalValue / totalFilled : 0;

    return {
      success: totalFilled > 0,
      orders,
      totalFilled,
      averagePrice,
      executionTime: Date.now() - startTime,
    };
  }

  /**
   * Execute Iceberg order
   * Hides order size by showing only small slices
   */
  private async executeIceberg(
    symbol: string,
    side: 'buy' | 'sell',
    totalSize: number,
    config: ExecutionConfig
  ): Promise<SmartExecutionResult> {
    const startTime = Date.now();
    const maxSliceSize = config.maxSliceSize || totalSize * 0.1; // Default 10% of total
    const sliceInterval = config.sliceInterval || 5000; // 5 seconds between slices

    const orders: Order[] = [];
    let totalFilled = 0;
    let totalValue = 0;
    let remainingSize = totalSize;

    this.logger.info(
      `Starting Iceberg execution for ${symbol}: ${totalSize} with max slice size ${maxSliceSize}`,
      {
        symbol,
        side,
        totalSize,
        maxSliceSize,
        sliceInterval,
      },
      this.context
    );

    while (remainingSize > 0) {
      const sliceSize = Math.min(remainingSize, maxSliceSize);

      const ticker = await this.exchange.getTicker(symbol);
      const currentPrice = (ticker as { price: number }).price;

      const limitPrice = side === 'buy' ? currentPrice * 0.9995 : currentPrice * 1.0005;

      try {
        const order = await this.exchange.placeOrder(symbol, side, sliceSize, limitPrice);

        orders.push(order);

        if (order.status === 'filled' && order.price) {
          const filled = order.amount;
          totalFilled += filled;
          totalValue += filled * order.price;
          remainingSize -= filled;
        } else {
          // Order not filled, wait and try again with smaller size
          remainingSize -= sliceSize * 0.5; // Assume partial fill
        }

        // Wait before next slice
        if (remainingSize > 0) {
          await new Promise(resolve => setTimeout(resolve, sliceInterval));
        }
      } catch (error) {
        this.logger.warn(
          `Iceberg slice failed`,
          {
            error: error instanceof Error ? error.message : String(error),
            remainingSize,
          },
          this.context
        );
        // Retry with smaller size
        remainingSize -= sliceSize * 0.5;
      }
    }

    const averagePrice = totalFilled > 0 ? totalValue / totalFilled : 0;

    return {
      success: totalFilled > 0,
      orders,
      totalFilled,
      averagePrice,
      executionTime: Date.now() - startTime,
    };
  }

  /**
   * Cancel all active executions for a symbol
   */
  async cancelExecution(symbol: string): Promise<void> {
    const execution = this.activeExecutions.get(symbol);
    if (execution) {
      // Cancel all pending orders
      for (const order of execution.orders) {
        if (order.status === 'open') {
          try {
            await this.exchange.cancelOrder(order.id, symbol);
          } catch (error) {
            this.logger.warn(
              `Failed to cancel order ${order.id}`,
              { error: error instanceof Error ? error.message : String(error) },
              this.context
            );
          }
        }
      }
      this.activeExecutions.delete(symbol);
    }
  }
}

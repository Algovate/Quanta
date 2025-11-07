import { Exchange, TradingSignal, Order, Position, Account } from '../exchange/types.js';
import { calculatePositionPnl } from '../utils/symbol-utils.js';
import { RiskManager, PositionSizing } from './risk.js';
import { ensureUsdtSuffix } from '../utils/symbol-utils.js';
import { UnifiedLogger } from '../logging/index.js';
import { TradingManager } from '../core/trading-manager.js';
import type { OrderEvent, TradeEvent } from '../core/types/trading-manager.js';
import { getConfig } from '../config/settings.js';
import { SlippageManager } from './slippage-manager.js';
import { TechnicalIndicators } from '../types/index.js';
import {
  validateOrder as validateOrderUtil,
  clampReduceOnlyQuantity,
  attemptFallbackRounding,
  getSymbolMetadata,
} from '../utils/order-validation.js';

// Type guard to check if exchange is SimulatorExchange with metadata support
function isSimulatorExchange(exchange: Exchange): exchange is Exchange & {
  setOrderMetadata: (orderId: string, source: string, reason: string) => void;
} {
  return typeof (exchange as any).setOrderMetadata === 'function';
}

export interface OrderResult {
  success: boolean;
  order?: Order;
  error?: string;
  errorCode?:
    | 'TINY_PARTIAL_ACCUMULATED'
    | 'BATCH_TOO_SMALL_AFTER_CLAMP'
    | 'VALIDATION_FAILED'
    | 'EXECUTION_FAILED';
  realizedPnl?: number;
  fees?: number;
}

export class OrderExecutor {
  private exchange: Exchange;
  private riskManager: RiskManager;
  private logger: UnifiedLogger;
  private readonly context = 'OrderExecutor';
  private forceMarketOrders: boolean;
  private priceSanityEnabled: boolean;
  private priceSanityMaxDeviation: number;
  private slippageManager: SlippageManager;
  // Accumulate tiny partial close remainders per position (symbol -> remainder USD)
  private partialCloseRemainders: Map<string, number> = new Map();
  // Track skipped and batched tiny partials
  private skippedTinyPartialsCount = 0;
  private batchedTinyPartialsCount = 0;

  private minNotionalUsd?: number;

  constructor(
    exchange: Exchange,
    riskManager: RiskManager,
    options?: { forceMarketOrders?: boolean; minNotionalUsd?: number }
  ) {
    this.exchange = exchange;
    this.riskManager = riskManager;
    this.logger = UnifiedLogger.getInstance();
    this.forceMarketOrders = Boolean(options?.forceMarketOrders);
    this.minNotionalUsd = options?.minNotionalUsd;
    const cfg = getConfig();
    this.priceSanityEnabled = Boolean(cfg.trading?.priceSanity?.enabled);
    this.priceSanityMaxDeviation = Number(cfg.trading?.priceSanity?.maxDeviation ?? 0.05);
    this.slippageManager = new SlippageManager();
  }

  /**
   * Execute a partial close of a position by submitting an opposite side market order
   * for the requested fraction of current size.
   * Validates quantity, notional, and clamps to position size for reduce-only.
   */
  async executePartialClose(position: Position, fraction: number): Promise<OrderResult> {
    try {
      const symbol = position.symbol;
      const side: 'buy' | 'sell' = position.side === 'long' ? 'sell' : 'buy';
      const requestedAmount = Math.max(0, Math.min(1, fraction)) * position.size;
      if (requestedAmount <= 0) {
        return this.createErrorResult('Zero amount for partial close', 'VALIDATION_FAILED');
      }

      // Get current price for validation
      const currentPrice = await this.getCurrentPriceWithFallback(symbol, position);

      // Clamp reduce-only quantity to position size
      // Note: We allow clampedAmount to be 0 or very small - batching logic will handle accumulation
      const clampedAmount = clampReduceOnlyQuantity(requestedAmount, position.size, symbol);

      // Enforce minimum notional for partial closes (to avoid spammy tiny orders)
      // Batch tiny remainders until they reach minimum
      // This will handle cases where clampedAmount is 0 or below minQty by accumulating them
      const batchingResult = this.handleTinyPartialBatching(
        symbol,
        clampedAmount,
        currentPrice,
        position.size
      );
      if (!batchingResult.shouldProceed) {
        return this.createErrorResult(
          batchingResult.error || 'Batching failed',
          batchingResult.errorCode
        );
      }
      const effectiveAmount = batchingResult.effectiveAmount;

      // Validate and execute order with fallback handling
      const executionResult = await this.validateAndExecuteOrder(
        symbol,
        side,
        effectiveAmount,
        currentPrice,
        {
          isReduceOnly: true,
          positionSize: position.size,
          leverage: position.leverage,
          source: 'AI',
          reason: 'partial-close',
        }
      );

      if (!executionResult.success) {
        return executionResult;
      }

      return this.createSuccessResult(executionResult.order);
    } catch (error) {
      return this.handleError('Partial close', error);
    }
  }
  /**
   * Build full symbol from coin name
   */
  private buildSymbol(coin: string): string {
    return ensureUsdtSuffix(coin);
  }

  /**
   * Find position by coin name
   */
  private findPosition(coin: string, positions: Position[]): Position | undefined {
    const symbol = this.buildSymbol(coin);
    return positions.find(p => p.symbol === symbol);
  }

  /**
   * Convert position side to order side
   * Long positions need to be sold to close, short positions need to be bought to close
   */
  private positionSideToOrderSide(positionSide: 'long' | 'short'): 'buy' | 'sell' {
    return positionSide === 'long' ? 'sell' : 'buy';
  }

  /**
   * Create a success result
   */
  private createSuccessResult(order?: Order, realizedPnl?: number, fees?: number): OrderResult {
    return { success: true, order, realizedPnl, fees };
  }

  /**
   * Create an error result with optional error code
   */
  private createErrorResult(error: string, errorCode?: OrderResult['errorCode']): OrderResult {
    return { success: false, error, errorCode };
  }

  /**
   * Handle error and return standardized error result
   */
  private handleError(context: string, error: unknown): OrderResult {
    this.logger.error(
      `Error executing ${context}`,
      error instanceof Error ? error : new Error(String(error)),
      this.context
    );
    return this.createErrorResult(
      error instanceof Error ? error.message : `${context} execution failed`,
      'EXECUTION_FAILED'
    );
  }

  private pushOrderEvent(
    order: Order,
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    source: string,
    reason: string,
    price?: number
  ): void {
    try {
      const event: OrderEvent = {
        id: order?.id ?? `${symbol}-${Date.now()}`,
        timestamp: Date.now(),
        symbol,
        side,
        amount,
        status: order?.status ?? 'open',
        source,
        reason,
        ...(price !== undefined ? { price } : {}),
      };
      TradingManager.getInstance().pushOrder(event);
    } catch (error) {
      // TradingManager might not be initialized in backtest mode
      // This is non-critical, so we log at debug level
      this.logger.debug(
        'Failed to push order to TradingManager',
        error instanceof Error ? { error: error.message } : { error: String(error) },
        this.context
      );
    }
  }

  private pushTradeEvent(
    order: Order,
    orderId: string,
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    source: string,
    reason: string,
    realizedPnl?: number,
    fees?: number
  ): void {
    try {
      const event: TradeEvent = {
        id: `${orderId}-${Date.now()}`, // unique trade ID
        orderId, // link to order
        timestamp: Date.now(),
        symbol,
        side,
        amount,
        price: order.price, // execution price (required for trades)
        source,
        reason,
        ...(fees !== undefined ? { fee: fees, feeAsset: 'USDT' } : {}),
        ...(realizedPnl !== undefined ? { realizedPnl } : {}),
      };
      TradingManager.getInstance().pushTrade(event);
    } catch (error) {
      // TradingManager might not be initialized in backtest mode
      // This is non-critical, so we log at debug level
      this.logger.debug(
        'Failed to push trade to TradingManager',
        error instanceof Error ? { error: error.message } : { error: String(error) },
        this.context
      );
    }
  }

  /**
   * Helper to push both order and trade events (if order is filled)
   */
  private pushOrderAndTradeEvents(
    order: Order,
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    source: string,
    reason: string,
    price?: number,
    realizedPnl?: number,
    fees?: number
  ): void {
    // Always emit order event
    this.pushOrderEvent(order, symbol, side, amount, source, reason, price);

    // Emit trade event if order was filled
    if (order.status === 'filled') {
      this.pushTradeEvent(order, order.id, symbol, side, amount, source, reason, realizedPnl, fees);
    }
  }

  async executeSignal(
    signal: TradingSignal,
    account: Account,
    currentPositions: Position[],
    currentPrice: number,
    indicators?: TechnicalIndicators
  ): Promise<OrderResult> {
    try {
      // Validate signal (do not log per-failure here; caller aggregates for UI)
      const validationResult = this.riskManager.validateSignal(signal, account, currentPositions);
      if (!validationResult.valid) {
        return this.createErrorResult(
          validationResult.reason || 'Signal validation failed',
          'VALIDATION_FAILED'
        );
      }

      // Calculate position sizing (ATR not available at this level, will use default)
      let sizing: PositionSizing | null;
      try {
        sizing = this.riskManager.calculatePositionSizing(
          signal,
          account,
          currentPositions,
          currentPrice
        );
      } catch (error) {
        // Extract detailed rejection reason from error message
        const reason =
          error instanceof Error ? error.message : 'Position sizing calculation failed';
        return this.createErrorResult(reason, 'VALIDATION_FAILED');
      }

      if (!sizing) {
        return this.createErrorResult('Position sizing calculation failed', 'VALIDATION_FAILED');
      }

      // Execute order based on signal action
      switch (signal.action) {
        case 'LONG':
          return await this.executeLongOrder(signal, sizing, currentPrice, indicators);

        case 'SHORT':
          return await this.executeShortOrder(signal, sizing, currentPrice, indicators);

        case 'CLOSE':
          return await this.executeCloseOrder(signal, currentPositions, currentPrice);

        case 'HOLD':
          return this.createSuccessResult();

        default:
          return this.createErrorResult(`Unknown action: ${signal.action}`, 'VALIDATION_FAILED');
      }
    } catch (error) {
      this.logger.error(
        'Error executing signal',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Unknown error',
        'EXECUTION_FAILED'
      );
    }
  }

  /**
   * Execute a directional order (long or short)
   * Consolidates duplicate logic from executeLongOrder and executeShortOrder
   */
  private async executeDirectionalOrder(
    signal: TradingSignal,
    sizing: PositionSizing,
    currentPrice: number,
    side: 'buy' | 'sell',
    indicators?: TechnicalIndicators
  ): Promise<OrderResult> {
    try {
      // Validate current price before proceeding
      if (currentPrice <= 0 || !isFinite(currentPrice)) {
        return {
          success: false,
          error: `Invalid current price: ${currentPrice}`,
        };
      }

      const symbol = this.buildSymbol(signal.coin);
      const amount = sizing.suggestedSize;

      // Calculate expected slippage
      const slippageMetrics = this.slippageManager.calculateExpectedSlippage(
        symbol,
        amount,
        currentPrice,
        side,
        indicators
      );

      // Log slippage warning if high
      if (slippageMetrics.warning) {
        this.logger.warn(
          slippageMetrics.warning,
          {
            symbol,
            coin: signal.coin,
            side,
            expectedSlippage: (slippageMetrics.expectedSlippage * 100).toFixed(2) + '%',
            historicalAverage: (slippageMetrics.historicalAverage * 100).toFixed(2) + '%',
            orderSize: amount,
            orderValue: amount * currentPrice,
          },
          this.context
        );
      }

      // Determine intended price
      // Use limit order if expected slippage is high and not forcing market orders
      let price = this.forceMarketOrders ? undefined : signal.entry_price || currentPrice;

      // If expected slippage is high, prefer limit order to reduce slippage
      if (!this.forceMarketOrders && slippageMetrics.shouldUseLimitOrder && !price) {
        // Set limit price slightly better than market to reduce slippage
        // For buy: 0.1% below market, for sell: 0.1% above market
        const limitOffset = currentPrice * 0.001; // 0.1%
        price = side === 'buy' ? currentPrice - limitOffset : currentPrice + limitOffset;

        this.logger.info(
          'Using limit order to reduce expected slippage',
          {
            symbol,
            coin: signal.coin,
            side,
            expectedSlippage: (slippageMetrics.expectedSlippage * 100).toFixed(2) + '%',
            limitPrice: price,
            marketPrice: currentPrice,
          },
          this.context
        );
      }

      // Stale price guard: if entry_price deviates too much from current ticker, convert to market
      if (!this.forceMarketOrders && this.priceSanityEnabled && signal.entry_price !== undefined) {
        // currentPrice is already validated above
        const denom = currentPrice;
        const relDiff = denom > 0 ? Math.abs(signal.entry_price - denom) / denom : 0;
        if (relDiff > this.priceSanityMaxDeviation) {
          this.logger.warn(
            'Overriding stale entry price with market due to deviation',
            {
              coin: signal.coin,
              side,
              entryPrice: signal.entry_price,
              currentPrice: denom,
              relativeDiff: relDiff,
              maxAllowed: this.priceSanityMaxDeviation,
            },
            this.context
          );
          price = undefined; // force market order
        }
      }
      const leverage = sizing.leverage;

      const order = await this.exchange.placeOrder(symbol, side, amount, price, leverage);
      // Set metadata for simulator exchange if applicable
      if (isSimulatorExchange(this.exchange)) {
        this.exchange.setOrderMetadata?.(order.id, 'AI', 'signal');
      }

      // Calculate actual slippage if order was filled
      const actualPrice = order.price || currentPrice;
      if (order.status === 'filled' && actualPrice > 0 && currentPrice > 0) {
        const actualSlippage =
          side === 'buy'
            ? (actualPrice - currentPrice) / currentPrice
            : (currentPrice - actualPrice) / currentPrice;

        // Record slippage for tracking
        this.slippageManager.recordSlippage({
          symbol,
          timestamp: Date.now(),
          expectedPrice: currentPrice,
          actualPrice,
          slippage: actualSlippage,
          orderSize: amount,
          side,
        });

        // Log if actual slippage differs significantly from expected
        if (Math.abs(actualSlippage - slippageMetrics.expectedSlippage) > 0.002) {
          this.logger.info(
            'Slippage deviation from expected',
            {
              symbol,
              coin: signal.coin,
              side,
              expected: (slippageMetrics.expectedSlippage * 100).toFixed(2) + '%',
              actual: (actualSlippage * 100).toFixed(2) + '%',
              deviation:
                ((actualSlippage - slippageMetrics.expectedSlippage) * 100).toFixed(2) + '%',
            },
            this.context
          );
        }
      }

      this.pushOrderAndTradeEvents(order, symbol, side, amount, 'AI', 'signal', price);

      // Check if order was actually filled
      if (order.status === 'filled' || order.status === 'open') {
        return this.createSuccessResult(order);
      } else {
        return this.createErrorResult(
          `Order ${order.status}: ${order.status === 'rejected' ? 'Insufficient margin' : 'Unknown reason'}`,
          'EXECUTION_FAILED'
        );
      }
    } catch (error) {
      return this.handleError(`${side.toUpperCase()} order`, error);
    }
  }

  private async executeLongOrder(
    signal: TradingSignal,
    sizing: PositionSizing,
    currentPrice: number,
    indicators?: TechnicalIndicators
  ): Promise<OrderResult> {
    return this.executeDirectionalOrder(signal, sizing, currentPrice, 'buy', indicators);
  }

  private async executeShortOrder(
    signal: TradingSignal,
    sizing: PositionSizing,
    currentPrice: number,
    indicators?: TechnicalIndicators
  ): Promise<OrderResult> {
    return this.executeDirectionalOrder(signal, sizing, currentPrice, 'sell', indicators);
  }

  private async executeCloseOrder(
    signal: TradingSignal,
    currentPositions: Position[],
    currentPrice: number
  ): Promise<OrderResult> {
    try {
      const position = this.findPosition(signal.coin, currentPositions);

      if (!position) {
        return this.createErrorResult(`No position found for ${signal.coin}`, 'VALIDATION_FAILED');
      }

      const symbol = this.buildSymbol(signal.coin);
      const side = this.positionSideToOrderSide(position.side);

      // For CLOSE orders, use exact position size to prevent creating new positions
      // This ensures the order amount exactly matches the position size, preventing
      // floating point precision issues that could cause small remainders and trigger
      // new position creation in updatePosition()
      const exactAmount = position.size;

      // Use currentPrice from cache to compute realized P&L (avoid duplicate ticker call)
      const priceForPnl = currentPrice > 0 && isFinite(currentPrice) ? currentPrice : undefined;

      const order = await this.exchange.placeOrder(symbol, side, exactAmount);
      // Set metadata for simulator exchange if applicable
      if (isSimulatorExchange(this.exchange)) {
        this.exchange.setOrderMetadata?.(order.id, 'AI', 'signal');
      }

      const realizedPnl =
        priceForPnl !== undefined
          ? calculatePositionPnl(position.side, priceForPnl, position.entryPrice, position.size)
          : undefined;

      // Emit order and trade events for filled close orders with realized PnL
      this.pushOrderAndTradeEvents(
        order,
        symbol,
        side,
        exactAmount,
        'AI',
        'signal',
        undefined,
        realizedPnl
      );

      return this.createSuccessResult(order, realizedPnl, 0);
    } catch (error) {
      return this.handleError('CLOSE order', error);
    }
  }

  /**
   * Execute position exit (stop loss or take profit)
   * Consolidates duplicate logic
   */
  private async executePositionExit(
    position: Position,
    currentPrice: number,
    source: string,
    reason: string,
    context: string
  ): Promise<OrderResult> {
    try {
      const symbol = ensureUsdtSuffix(position.symbol);
      const side = this.positionSideToOrderSide(position.side);
      const amount = position.size;
      // Exits should default to market orders for immediacy; avoid posting limits here.
      // Pass leverage to ensure consistent fee/margin application on some exchanges.
      const order = await this.exchange.placeOrder(
        symbol,
        side,
        amount,
        undefined,
        position.leverage
      );
      // Set metadata for simulator exchange if applicable
      if (isSimulatorExchange(this.exchange)) {
        this.exchange.setOrderMetadata?.(order.id, source, reason);
      }
      this.pushOrderAndTradeEvents(order, symbol, side, amount, source, reason, currentPrice);

      return this.createSuccessResult(order);
    } catch (error) {
      return this.handleError(context, error);
    }
  }

  async executeStopLoss(
    position: Position,
    currentPrice: number,
    source?: string,
    reason?: string
  ): Promise<OrderResult> {
    return this.executePositionExit(
      position,
      currentPrice,
      source ?? 'stop-loss',
      reason ?? 'Stop loss triggered',
      'stop loss'
    );
  }

  async executeTakeProfit(
    position: Position,
    currentPrice: number,
    source?: string,
    reason?: string
  ): Promise<OrderResult> {
    return this.executePositionExit(
      position,
      currentPrice,
      source ?? 'take-profit',
      reason ?? 'Take profit triggered',
      'take profit'
    );
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    try {
      return await this.exchange.cancelOrder(orderId, symbol);
    } catch (error) {
      this.logger.error(
        'Error canceling order',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      return false;
    }
  }

  /**
   * Get current price with fallback to position mark/entry price
   */
  private async getCurrentPriceWithFallback(symbol: string, position: Position): Promise<number> {
    try {
      const ticker = await this.exchange.getTicker(symbol);
      return (ticker as { price: number }).price;
    } catch (error) {
      this.logger.warn(
        `Failed to get price for partial close validation: ${symbol}`,
        error instanceof Error ? { error: error.message } : { error: String(error) },
        this.context
      );
      // Fallback: use mark price from position
      return position.markPrice || position.entryPrice;
    }
  }

  /**
   * Validate and execute order with fallback rounding support
   */
  private async validateAndExecuteOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    price: number,
    options: {
      isReduceOnly: boolean;
      positionSize: number;
      leverage: number;
      source: string;
      reason: string;
    }
  ): Promise<OrderResult & { order?: Order }> {
    // Validate order
    const validation = validateOrderUtil(symbol, side, amount, price, {
      isReduceOnly: options.isReduceOnly,
      positionSize: options.positionSize,
    });

    if (!validation.valid) {
      // Attempt fallback rounding
      const fallback = attemptFallbackRounding(symbol, amount, price, options.isReduceOnly);
      if (fallback?.valid && fallback.validatedQuantity) {
        // Use fallback quantity if valid
        const fallbackAmount = Math.min(fallback.validatedQuantity, options.positionSize);
        const finalValidation = validateOrderUtil(symbol, side, fallbackAmount, price, {
          isReduceOnly: options.isReduceOnly,
          positionSize: options.positionSize,
        });

        if (finalValidation.valid && finalValidation.validatedQuantity) {
          return this.placeOrderWithMetadata(
            symbol,
            side,
            finalValidation.validatedQuantity,
            undefined,
            options.leverage,
            options.source,
            options.reason
          );
        }
      }

      return this.createErrorResult(
        `Order validation failed: ${validation.reason || 'Unknown reason'}`,
        'VALIDATION_FAILED'
      );
    }

    // Use validated quantity
    const validatedAmount = validation.validatedQuantity || amount;

    // Place order
    return this.placeOrderWithMetadata(
      symbol,
      side,
      validatedAmount,
      undefined,
      options.leverage,
      options.source,
      options.reason
    );
  }

  /**
   * Place order and set metadata if applicable
   */
  private async placeOrderWithMetadata(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    price: number | undefined,
    leverage: number,
    source: string,
    reason: string
  ): Promise<OrderResult & { order?: Order }> {
    const order = await this.exchange.placeOrder(symbol, side, amount, price, leverage);

    // Set metadata for simulator exchange if applicable
    if (isSimulatorExchange(this.exchange)) {
      this.exchange.setOrderMetadata?.(order.id, source, reason);
    }

    this.pushOrderEvent(order, symbol, side, amount, source, reason, undefined);

    if (order.status === 'filled' || order.status === 'open') {
      return this.createSuccessResult(order);
    }

    return this.createErrorResult(
      `Order ${order.status || 'unknown'} on ${reason}`,
      'EXECUTION_FAILED'
    );
  }

  /**
   * Handle batching logic for tiny partial closes
   * Accumulates remainders until they reach minimum notional, then executes batched order
   */
  private handleTinyPartialBatching(
    symbol: string,
    clampedAmount: number,
    currentPrice: number,
    positionSize: number
  ): {
    shouldProceed: boolean;
    effectiveAmount?: number;
    error?: string;
    errorCode?: OrderResult['errorCode'];
  } {
    try {
      // Effective min notional: prefer configured threshold if higher than symbol metadata
      // Fall back to 5 if neither is available
      const symbolMeta = getSymbolMetadata(symbol);
      const configuredMin = this.minNotionalUsd ?? 5;
      const minNotional = Math.max(configuredMin, symbolMeta?.minNotional ?? 5);
      const notional = clampedAmount * currentPrice;
      const existingRemainder = this.partialCloseRemainders.get(symbol) || 0;
      const totalNotional = notional + existingRemainder;

      // If current request is large enough, clear any remainder and proceed
      if (minNotional === 0 || notional >= minNotional) {
        if (existingRemainder > 0) {
          this.partialCloseRemainders.delete(symbol);
        }
        return { shouldProceed: true, effectiveAmount: clampedAmount };
      }

      // Current request is too small - accumulate remainder
      this.partialCloseRemainders.set(symbol, totalNotional);

      // If accumulated remainder reaches minimum, try to execute batched order
      if (totalNotional >= minNotional) {
        return this.attemptBatchedExecution(
          symbol,
          totalNotional,
          currentPrice,
          positionSize,
          minNotional,
          notional
        );
      }

      // Still too small, just accumulate
      this.skippedTinyPartialsCount++;
      this.logger.debug(
        `Accumulating tiny partial close: notional $${notional.toFixed(3)} < min $${minNotional.toFixed(2)}, total remainder: $${totalNotional.toFixed(3)}`,
        { symbol, clampedAmount, price: currentPrice, remainder: totalNotional },
        this.context
      );
      return {
        shouldProceed: false,
        error: `Tiny partial accumulated: notional ${notional.toFixed(3)} < ${minNotional.toFixed(2)}`,
        errorCode: 'TINY_PARTIAL_ACCUMULATED',
      };
    } catch {
      // If config read fails, ignore and proceed with original amount
      return { shouldProceed: true, effectiveAmount: clampedAmount };
    }
  }

  /**
   * Attempt to execute a batched order from accumulated remainders
   */
  private attemptBatchedExecution(
    symbol: string,
    totalNotional: number,
    currentPrice: number,
    positionSize: number,
    minNotional: number,
    originalNotional: number
  ): {
    shouldProceed: boolean;
    effectiveAmount?: number;
    error?: string;
    errorCode?: OrderResult['errorCode'];
  } {
    // Calculate batched quantity from total notional
    const batchedQty = Math.min(totalNotional / currentPrice, positionSize);
    this.partialCloseRemainders.delete(symbol);

    // Use batched quantity for validation and execution
    const batchedClamped = clampReduceOnlyQuantity(batchedQty, positionSize, symbol);
    const batchedNotional = batchedClamped * currentPrice;

    // Check if batched notional (after clamping) still meets minimum
    if (batchedClamped > 0 && batchedNotional >= minNotional) {
      this.batchedTinyPartialsCount++;
      this.logger.debug(
        `Batched tiny partial close: accumulated $${totalNotional.toFixed(3)} → executing $${batchedNotional.toFixed(3)}`,
        { symbol, originalNotional, batchedNotional, price: currentPrice },
        this.context
      );
      return { shouldProceed: true, effectiveAmount: batchedClamped };
    }

    // Batched quantity still too small after clamping, keep accumulating
    // Put the remainder back since we couldn't execute
    this.partialCloseRemainders.set(symbol, totalNotional);
    this.logger.debug(
      `Batched quantity too small after clamping (notional $${batchedNotional.toFixed(3)} < min $${minNotional.toFixed(2)}), continuing to accumulate`,
      { symbol, batchedQty, batchedClamped, batchedNotional, totalNotional, minNotional },
      this.context
    );
    return {
      shouldProceed: false,
      error: `Batched quantity too small after clamping: notional ${batchedNotional.toFixed(3)} < ${minNotional.toFixed(2)}`,
      errorCode: 'BATCH_TOO_SMALL_AFTER_CLAMP',
    };
  }

  /**
   * Get statistics for skipped and batched tiny partial closes
   */
  getPartialCloseStats(): { skipped: number; batched: number } {
    return {
      skipped: this.skippedTinyPartialsCount,
      batched: this.batchedTinyPartialsCount,
    };
  }
}

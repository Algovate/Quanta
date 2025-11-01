/**
 * Position Manager - Handles complex position update logic
 * Consolidates duplicate position management code from SimulatorExchange and BacktestExchange
 */

import { Position, Account } from './types.js';
import { CompletedTrade } from '../types/index.js';
import {
  createPosition,
  calculateMargin,
  calculateNotional,
  calculateRealizedPnl,
  createCompletedTrade,
  calculateAverageEntryPrice,
  updateAccountEquity,
  updatePositionWithPrice,
} from './position-calculations.js';
import { shouldCreatePositionAfterClose } from '../utils/position-close-utils.js';
import { POSITION_CLOSING } from '../execution/constants.js';
import { normalizeSymbol } from '../utils/symbol-utils.js';
import {
  safeAdd,
  safeSubtract,
  safeMultiply,
  safeDivide,
  roundToPrecision,
  EXCHANGE_PRECISION,
} from '../utils/precision.js';
import { Logger } from '../utils/logger.js';

export interface PositionManagerConfig {
  account: Account;
  positions: Position[];
  completedTrades: CompletedTrade[];
  maxCompletedTrades?: number;
  currentTime?: number; // Optional for backtest to use historical time
  onAccountUpdate?: () => void; // Optional callback when account is updated
}

/**
 * Handles complex position update logic shared between exchanges
 */
export class PositionUpdateManager {
  private config: PositionManagerConfig;
  private logger: Logger;

  constructor(config: PositionManagerConfig) {
    this.config = config;
    this.logger = Logger.getInstance('PositionManager');
  }

  /**
   * Update the current time (for backtesting scenarios)
   */
  updateCurrentTime(timestamp: number): void {
    this.config.currentTime = timestamp;
  }

  /**
   * Main entry point for position updates
   * Handles both closing opposite positions and creating/updating same-side positions
   */
  updatePosition(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    price: number,
    leverage: number = 1
  ): void {
    const positionSide = side === 'buy' ? 'long' : 'short';
    const oppositeSide = positionSide === 'long' ? 'short' : 'long';
    symbol = normalizeSymbol(symbol);

    // Check if there's an opposite position to close/reduce
    const oppositePosition = this.config.positions.find(
      p => p.symbol === symbol && p.side === oppositeSide
    );

    if (oppositePosition) {
      this.handleOppositePosition(oppositePosition, amount, price, symbol, positionSide, leverage);
    } else {
      this.handleSameSidePosition(symbol, positionSide, amount, price, leverage);
    }
  }

  /**
   * Handle closing or reducing an opposite position
   */
  private handleOppositePosition(
    oppositePosition: Position,
    amount: number,
    price: number,
    symbol: string,
    positionSide: 'long' | 'short',
    leverage: number
  ): void {
    // Use tolerance from constants to handle floating point errors and price volatility
    const tolerance = oppositePosition.size * POSITION_CLOSING.CLOSE_TOLERANCE_PERCENT;
    const isFullClose = amount >= oppositePosition.size - tolerance;

    if (isFullClose) {
      this.handleFullClose(oppositePosition, amount, price, symbol, positionSide, leverage);
    } else {
      this.handlePartialClose(oppositePosition, amount, price, symbol);
    }
  }

  /**
   * Handle full position close
   */
  private handleFullClose(
    oppositePosition: Position,
    amount: number,
    price: number,
    symbol: string,
    positionSide: 'long' | 'short',
    leverage: number
  ): void {
    const closedSize = oppositePosition.size;
    const remainingAmount = Math.max(0, amount - closedSize);

    // Calculate realized P&L using precision-safe arithmetic
    const realizedPnl = calculateRealizedPnl(
      oppositePosition.side,
      price,
      oppositePosition.entryPrice,
      closedSize,
      symbol
    );

    const completedTrade = createCompletedTrade(
      oppositePosition,
      price,
      this.config.currentTime || Date.now(),
      this.config.completedTrades.length + 1,
      'signal'
    );

    this.config.completedTrades.push(completedTrade);

    // Prevent memory leak: keep only last N trades
    const maxTrades = this.config.maxCompletedTrades || 500;
    if (this.config.completedTrades.length > maxTrades) {
      this.config.completedTrades.shift();
    }

    // Update account with realized P&L using precision-safe arithmetic
    this.config.account.balance = roundToPrecision(
      safeAdd(this.config.account.balance, realizedPnl).toNumber(),
      EXCHANGE_PRECISION.USDT
    );

    // Calculate margin release plus P&L with precision
    const marginReleasePlusPnl = safeAdd(oppositePosition.marginUsed, realizedPnl).toNumber();
    this.config.account.availableMargin = roundToPrecision(
      safeAdd(this.config.account.availableMargin, marginReleasePlusPnl).toNumber(),
      EXCHANGE_PRECISION.USDT
    );

    this.config.account.usedMargin = roundToPrecision(
      safeSubtract(this.config.account.usedMargin, oppositePosition.marginUsed).toNumber(),
      EXCHANGE_PRECISION.USDT
    );

    // Close the position
    const closeIndex = this.config.positions.findIndex(p => p === oppositePosition);
    if (closeIndex >= 0) {
      this.config.positions.splice(closeIndex, 1);
    }

    // Update account equity with new positions array
    updateAccountEquity(this.config.account, this.config.positions);

    // Check if we should create a new position after closing
    const closeCheck = shouldCreatePositionAfterClose(
      remainingAmount,
      closedSize,
      symbol,
      positionSide
    );

    if (closeCheck.shouldCreatePosition) {
      if (closeCheck.warningMessage) {
        this.logger.warn(closeCheck.warningMessage);
      }
      this.createNewPosition(symbol, positionSide, remainingAmount, price, leverage);
    } else if (closeCheck.shouldLogRemainder) {
      this.logger.debug(
        `Ignoring small remaining amount (${remainingAmount}) after closing ${symbol} position ` +
          `(likely floating point precision). Closed size: ${closedSize}`
      );
    }

    if (this.config.onAccountUpdate) {
      this.config.onAccountUpdate();
    }
  }

  /**
   * Handle partial position close
   */
  private handlePartialClose(
    oppositePosition: Position,
    amount: number,
    price: number,
    symbol: string
  ): void {
    // Partial close: reduce position size using precision-safe arithmetic
    const ratio = safeDivide(amount, oppositePosition.size, 8).toNumber();
    const marginToReturn = roundToPrecision(
      safeMultiply(oppositePosition.marginUsed, ratio).toNumber(),
      EXCHANGE_PRECISION.USDT
    );

    // Update position size and margin using precision
    oppositePosition.size = roundToPrecision(
      safeSubtract(oppositePosition.size, amount).toNumber(),
      8 // Max precision for position sizes
    );
    oppositePosition.marginUsed = roundToPrecision(
      safeSubtract(oppositePosition.marginUsed, marginToReturn).toNumber(),
      EXCHANGE_PRECISION.USDT
    );

    // Calculate realized P&L for partial close
    const realizedPnl = calculateRealizedPnl(
      oppositePosition.side,
      price,
      oppositePosition.entryPrice,
      amount,
      symbol
    );

    // For partial closes, create a temporary position object for the closed portion
    const partialPosition: Position = {
      ...oppositePosition,
      size: amount,
    };
    const completedTrade = createCompletedTrade(
      partialPosition,
      price,
      this.config.currentTime || Date.now(),
      this.config.completedTrades.length + 1,
      'signal'
    );

    this.config.completedTrades.push(completedTrade);

    // Prevent memory leak
    const maxTrades = this.config.maxCompletedTrades || 500;
    if (this.config.completedTrades.length > maxTrades) {
      this.config.completedTrades.shift();
    }

    // Update account with partial realized P&L using precision-safe arithmetic
    this.config.account.balance = roundToPrecision(
      safeAdd(this.config.account.balance, realizedPnl).toNumber(),
      EXCHANGE_PRECISION.USDT
    );
    this.config.account.usedMargin = roundToPrecision(
      safeSubtract(this.config.account.usedMargin, marginToReturn).toNumber(),
      EXCHANGE_PRECISION.USDT
    );
    const marginPlusPnl = safeAdd(marginToReturn, realizedPnl).toNumber();
    this.config.account.availableMargin = roundToPrecision(
      safeAdd(this.config.account.availableMargin, marginPlusPnl).toNumber(),
      EXCHANGE_PRECISION.USDT
    );

    // Update notional for remaining position
    oppositePosition.notional = calculateNotional(
      oppositePosition.size,
      oppositePosition.markPrice,
      oppositePosition.leverage
    );

    if (this.config.onAccountUpdate) {
      this.config.onAccountUpdate();
    }
  }

  /**
   * Handle creating or updating same-side positions
   */
  private handleSameSidePosition(
    symbol: string,
    positionSide: 'long' | 'short',
    amount: number,
    price: number,
    leverage: number
  ): void {
    const existingPosition = this.config.positions.find(
      p => p.symbol === symbol && p.side === positionSide
    );

    if (existingPosition) {
      this.updateExistingPosition(existingPosition, amount, price, leverage);
    } else {
      this.createNewPosition(symbol, positionSide, amount, price, leverage);
    }
  }

  /**
   * Update existing same-side position (averaging entry price)
   */
  private updateExistingPosition(
    existingPosition: Position,
    amount: number,
    price: number,
    leverage: number
  ): void {
    // Update existing position with average entry price
    existingPosition.entryPrice = calculateAverageEntryPrice(
      existingPosition.size,
      existingPosition.entryPrice,
      amount,
      price
    );
    existingPosition.size += amount;

    // Calculate margin with leverage for the additional position
    const additionalMargin = calculateMargin(amount, price, leverage);
    existingPosition.marginUsed += additionalMargin;

    // Update notional with leverage (matches real exchanges: size * markPrice * leverage)
    existingPosition.notional = calculateNotional(
      existingPosition.size,
      existingPosition.markPrice,
      leverage
    );
    existingPosition.leverage = leverage;

    // Update account margins using precision-safe arithmetic
    this.config.account.availableMargin = roundToPrecision(
      safeSubtract(this.config.account.availableMargin, additionalMargin).toNumber(),
      EXCHANGE_PRECISION.USDT
    );
    this.config.account.usedMargin = roundToPrecision(
      safeAdd(this.config.account.usedMargin, additionalMargin).toNumber(),
      EXCHANGE_PRECISION.USDT
    );

    if (this.config.onAccountUpdate) {
      this.config.onAccountUpdate();
    }
  }

  /**
   * Create a new position using shared calculation utilities
   */
  private createNewPosition(
    symbol: string,
    side: 'long' | 'short',
    amount: number,
    price: number,
    leverage: number
  ): void {
    const timestamp = this.config.currentTime || Date.now();
    const position = createPosition(symbol, side, amount, price, leverage, timestamp);
    this.config.positions.push(position);

    // Update account margins
    const marginRequired = position.marginUsed;
    this.config.account.availableMargin = roundToPrecision(
      safeSubtract(this.config.account.availableMargin, marginRequired).toNumber(),
      EXCHANGE_PRECISION.USDT
    );
    this.config.account.usedMargin = roundToPrecision(
      safeAdd(this.config.account.usedMargin, marginRequired).toNumber(),
      EXCHANGE_PRECISION.USDT
    );

    if (this.config.onAccountUpdate) {
      this.config.onAccountUpdate();
    }
  }

  /**
   * Update all positions with current market prices
   * Only updates positions with valid prices (invalid prices are skipped to preserve last valid markPrice)
   *
   * @param getCurrentPrice - Function to get current price for a symbol (may return 0 for invalid)
   */
  updateAllPositions(getCurrentPrice: (symbol: string) => number): void {
    let updatedCount = 0;
    let skippedCount = 0;

    for (const position of this.config.positions) {
      const currentPrice = getCurrentPrice(position.symbol);
      // updatePositionWithPrice will skip if price is invalid (preserves last valid markPrice)
      const previousMarkPrice = position.markPrice;
      updatePositionWithPrice(position, currentPrice);

      // Check if position was actually updated
      if (position.markPrice !== previousMarkPrice && currentPrice > 0 && isFinite(currentPrice)) {
        updatedCount++;
      } else if (currentPrice <= 0 || !isFinite(currentPrice)) {
        skippedCount++;
      }
    }

    // Only update account equity if at least some positions were updated
    // This ensures equity calculation uses consistent price point
    if (updatedCount > 0 || skippedCount === 0) {
      updateAccountEquity(this.config.account, this.config.positions);
    }
    // If all positions were skipped due to invalid prices, account equity keeps previous value
    // This is better than recalculating with stale/invalid prices
  }

  /**
   * Get the configured account instance
   */
  getAccount(): Account {
    return this.config.account;
  }

  /**
   * Get the configured positions array
   */
  getPositions(): Position[] {
    return this.config.positions;
  }

  /**
   * Get the configured completed trades array
   */
  getCompletedTrades(): CompletedTrade[] {
    return this.config.completedTrades;
  }
}

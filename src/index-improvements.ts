/**
 * Improvements Entry Point
 * Exports all new systems and utilities
 */

// State Management
export {
  StateService,
  StateRepository,
  type TradingSystemState,
  type StateUpdate,
} from './core/state/index.js';

export {
  BaseStateObserver,
  LoggingStateObserver,
  WebSocketStateObserver,
  type StateObserver,
} from './core/state/state-observers.js';

// Dependency Injection
export {
  Container,
  ServiceRegistry,
  type ServiceIdentifier,
  type ServiceDescriptor,
} from './core/di/index.js';

// Service Layer
export {
  SignalServiceImpl,
  RiskServiceImpl,
  ExecutionServiceImpl,
  PortfolioServiceImpl,
  AnalyticsServiceImpl,
} from './services/index.js';

export type {
  SignalService,
  RiskService,
  ExecutionService,
  ExecutionResult,
  PortfolioService,
  PortfolioMetrics,
  AnalyticsService,
  PerformanceMetrics,
} from './services/interfaces/index.js';

// Strategy Pattern
export {
  BaseStrategy,
  AIStrategy,
  TechnicalStrategy,
  StrategyManager,
} from './strategies/index.js';

export type {
  IStrategy,
  StrategyConfig,
  StrategyContext,
  StrategyResult,
} from './strategies/index.js';

// Event System
export {
  UnifiedEventEmitter,
  type EventHandler,
  type EventSubscription,
} from './core/events/index.js';

export type {
  UnifiedEvent,
  EventCategory,
  SystemEvent,
  TradingEvent,
  RiskEvent,
  ExecutionEvent,
  MarketEvent,
  AnalyticsEvent,
  PortfolioEvent,
} from './core/events/index.js';

// Plugins
export {
  PluginManager,
  type Plugin,
  type PluginMetadata,
  type PluginConfig,
} from './plugins/plugin-manager.js';

// Risk Management
export { KellyCriterionCalculator, type KellyResult } from './execution/kelly-criterion.js';

export {
  PortfolioCorrelationAnalyzer,
  type PortfolioCorrelation,
  type CorrelationPair,
} from './execution/portfolio-correlation.js';

export { PortfolioRiskManager, type PortfolioRiskMetrics } from './execution/portfolio-risk.js';

// Exit Strategies
export {
  BreakevenPlusStrategy,
  PyramidingStrategy,
  AdaptiveTrailingStopStrategy,
  type ExitStrategy,
  type ExitDecision,
} from './execution/exit-strategies.js';

// Market Analysis
export {
  MarketRegimeAnalyzer,
  type MarketRegime,
  type VolatilityRegime,
  type TrendRegime,
  type RegimeTransition,
} from './analytics/market-regime.js';

// Portfolio Optimization
export {
  MPTOptimizer,
  type OptimizedPortfolio,
  type AssetOpportunity,
  type EfficientFrontierPoint,
} from './portfolio/mpt-optimizer.js';

// Learning Systems
export {
  AdaptiveParameterLearner,
  type AdaptiveParams,
  type LearningResult,
} from './learning/adaptive-params.js';

export {
  StrategyEvolutionManager,
  type StrategyVariant,
  type StrategyEvolutionResult,
} from './learning/strategy-evolution.js';

// Analytics
export { AdvancedAnalyticsEngine, type PerformanceReport } from './analytics/feedback-loop.js';

// Execution
export {
  SmartExecutionManager,
  type ExecutionConfig,
  type SmartExecutionResult,
} from './execution/smart-execution.js';

export {
  EnsembleSignalAggregator,
  AISignalSource,
  type SignalSource,
  type EnsembleSignalResult,
} from './ai/ensemble-signal.js';

// System Initialization
export { SystemInitializer, type SystemInitializationConfig } from './core/system-initializer.js';

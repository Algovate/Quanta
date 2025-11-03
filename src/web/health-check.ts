import { Exchange } from '../exchange/types.js';
import { OpenRouterClient } from '../ai/agent.js';
import { MarketDataProvider } from '../data/market.js';
import { UnifiedLogger } from '../logging/index.js';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  uptime: number;
  components: {
    exchange: ComponentHealth;
    aiClient?: ComponentHealth;
    marketData?: ComponentHealth;
    cache?: ComponentHealth;
  };
  metrics?: {
    totalChecks: number;
    consecutiveFailures: number;
    lastFailureTime: number | null;
  };
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  details?: Record<string, any>;
  lastCheck: number;
  responseTime?: number;
}

export class HealthCheckService {
  private logger = UnifiedLogger.getInstance();
  private readonly context = 'HealthCheck';
  private startTime = Date.now();
  private totalChecks = 0;
  private consecutiveFailures = 0;
  private lastFailureTime: number | null = null;

  constructor(
    private exchange?: Exchange,
    private aiClient?: OpenRouterClient,
    private marketDataProvider?: MarketDataProvider
  ) {}

  /**
   * Perform a comprehensive health check of all system components
   */
  async check(): Promise<HealthStatus> {
    this.totalChecks++;
    const startTime = Date.now();

    const components: HealthStatus['components'] = {
      exchange: await this.checkExchange(),
    };

    // Optional components
    if (this.aiClient) {
      components.aiClient = this.checkAIClient();
    }

    if (this.marketDataProvider) {
      components.marketData = this.checkMarketData();
    }

    // Check cache health
    components.cache = this.checkCache();

    // Determine overall health
    const overallStatus = this.determineOverallStatus(components);

    // Track failures
    if (overallStatus === 'unhealthy') {
      this.consecutiveFailures++;
      this.lastFailureTime = Date.now();
    } else {
      this.consecutiveFailures = 0;
    }

    const responseTime = Date.now() - startTime;

    this.logger.debug(
      'Health check completed',
      {
        status: overallStatus,
        responseTime,
        consecutiveFailures: this.consecutiveFailures,
      },
      this.context
    );

    return {
      status: overallStatus,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      components,
      metrics: {
        totalChecks: this.totalChecks,
        consecutiveFailures: this.consecutiveFailures,
        lastFailureTime: this.lastFailureTime,
      },
    };
  }

  /**
   * Quick health check (no async operations)
   */
  quickCheck(): Pick<HealthStatus, 'status' | 'timestamp' | 'uptime'> {
    return {
      status: this.consecutiveFailures > 3 ? 'unhealthy' : 'healthy',
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Check exchange connectivity
   */
  private async checkExchange(): Promise<ComponentHealth> {
    const startTime = Date.now();

    if (!this.exchange) {
      return {
        status: 'unhealthy',
        message: 'Exchange not configured',
        lastCheck: Date.now(),
      };
    }

    try {
      // Check if exchange has the methods we need
      const hasGetExchangeName = typeof (this.exchange as any).getExchangeName === 'function';
      const hasIsTestnetMode = typeof (this.exchange as any).isTestnetMode === 'function';

      const exchangeName = hasGetExchangeName
        ? (this.exchange as any).getExchangeName()
        : 'unknown';
      const isTestnet = hasIsTestnetMode ? (this.exchange as any).isTestnetMode() : false;

      // Try to check if exchange is responsive
      // We don't want to make actual API calls in health check to avoid rate limits
      // Instead, we just verify the exchange object is properly configured
      const responseTime = Date.now() - startTime;

      return {
        status: 'healthy',
        message: `Exchange ${exchangeName} is configured`,
        details: {
          exchange: exchangeName,
          testnet: isTestnet,
        },
        lastCheck: Date.now(),
        responseTime,
      };
    } catch (error) {
      this.logger.error(
        'Exchange health check failed',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      return {
        status: 'unhealthy',
        message: `Exchange check failed: ${error instanceof Error ? error.message : String(error)}`,
        lastCheck: Date.now(),
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Check AI client status (circuit breaker state)
   */
  private checkAIClient(): ComponentHealth {
    const startTime = Date.now();

    if (!this.aiClient) {
      return {
        status: 'degraded',
        message: 'AI client not configured',
        lastCheck: Date.now(),
      };
    }

    try {
      // Check circuit breaker state if available
      const circuitBreaker = (this.aiClient as any).circuitBreaker;

      if (circuitBreaker && typeof circuitBreaker.getStats === 'function') {
        const stats = circuitBreaker.getStats();
        const state = circuitBreaker.getState();

        let status: 'healthy' | 'degraded' | 'unhealthy';
        let message: string;

        switch (state) {
          case 'CLOSED':
            status = 'healthy';
            message = 'AI client circuit is closed (normal operation)';
            break;
          case 'HALF_OPEN':
            status = 'degraded';
            message = 'AI client circuit is half-open (testing recovery)';
            break;
          case 'OPEN':
            status = 'unhealthy';
            message = 'AI client circuit is open (failing)';
            break;
          default:
            status = 'degraded';
            message = 'AI client state unknown';
        }

        return {
          status,
          message,
          details: {
            circuitState: state,
            failureCount: stats.failureCount,
            successCount: stats.successCount,
            consecutiveFailures: stats.consecutiveFailures,
            lastFailureTime: stats.lastFailureTime,
            lastSuccessTime: stats.lastSuccessTime,
          },
          lastCheck: Date.now(),
          responseTime: Date.now() - startTime,
        };
      }

      // No circuit breaker info available
      return {
        status: 'healthy',
        message: 'AI client is configured',
        lastCheck: Date.now(),
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error(
        'AI client health check failed',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      return {
        status: 'unhealthy',
        message: `AI client check failed: ${error instanceof Error ? error.message : String(error)}`,
        lastCheck: Date.now(),
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Check market data provider status
   */
  private checkMarketData(): ComponentHealth {
    const startTime = Date.now();

    if (!this.marketDataProvider) {
      return {
        status: 'degraded',
        message: 'Market data provider not configured',
        lastCheck: Date.now(),
      };
    }

    try {
      // Check cache stats if available
      if (typeof (this.marketDataProvider as any).getCacheStats === 'function') {
        const stats = (this.marketDataProvider as any).getCacheStats();

        return {
          status: 'healthy',
          message: 'Market data provider is operational',
          details: {
            cacheSize: stats.size,
            cachedSymbols: stats.keys,
          },
          lastCheck: Date.now(),
          responseTime: Date.now() - startTime,
        };
      }

      return {
        status: 'healthy',
        message: 'Market data provider is configured',
        lastCheck: Date.now(),
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error(
        'Market data health check failed',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      return {
        status: 'unhealthy',
        message: `Market data check failed: ${error instanceof Error ? error.message : String(error)}`,
        lastCheck: Date.now(),
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Check cache health (memory usage, etc.)
   */
  private checkCache(): ComponentHealth {
    const startTime = Date.now();

    try {
      const memUsage = process.memoryUsage();
      const memUsageMB = {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
      };

      // Consider unhealthy if heap used exceeds 1GB
      const status = memUsageMB.heapUsed > 1024 ? 'degraded' : 'healthy';
      const message =
        status === 'degraded' ? 'High memory usage detected' : 'Memory usage is normal';

      return {
        status,
        message,
        details: {
          memoryUsageMB: memUsageMB,
          uptime: Math.round(process.uptime()),
        },
        lastCheck: Date.now(),
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error(
        'Cache health check failed',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      return {
        status: 'unhealthy',
        message: `Cache check failed: ${error instanceof Error ? error.message : String(error)}`,
        lastCheck: Date.now(),
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Determine overall system health based on components
   */
  private determineOverallStatus(
    components: HealthStatus['components']
  ): 'healthy' | 'degraded' | 'unhealthy' {
    const statuses = Object.values(components).map(c => c.status);

    // If any critical component is unhealthy, system is unhealthy
    if (components.exchange.status === 'unhealthy') {
      return 'unhealthy';
    }

    // If any component is unhealthy, system is unhealthy
    if (statuses.includes('unhealthy')) {
      return 'unhealthy';
    }

    // If any component is degraded, system is degraded
    if (statuses.includes('degraded')) {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Reset consecutive failure counter
   */
  reset(): void {
    this.consecutiveFailures = 0;
    this.lastFailureTime = null;
    this.logger.info('Health check metrics reset', {}, this.context);
  }
}

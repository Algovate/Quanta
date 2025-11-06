/**
 * System Initializer
 * Initializes all new systems and services
 */

import { StateService } from './state/index.js';
import { Container } from './di/index.js';
import { StrategyManager } from '../strategies/index.js';
import { UnifiedEventEmitter } from './events/index.js';
import { PluginManager } from '../plugins/plugin-manager.js';
import { UnifiedLogger } from '../logging/index.js';

export interface SystemInitializationConfig {
  initializeStateService?: boolean;
  initializeDI?: boolean;
  initializeStrategies?: boolean;
  initializeEvents?: boolean;
  initializePlugins?: boolean;
}

/**
 * System Initializer
 * Sets up all new systems and services
 */
export class SystemInitializer {
  private logger: UnifiedLogger;
  private readonly context = 'SystemInitializer';
  private stateService?: StateService;
  private diContainer?: Container;
  private strategyManager?: StrategyManager;
  private eventEmitter?: UnifiedEventEmitter;
  private pluginManager?: PluginManager;

  constructor() {
    this.logger = UnifiedLogger.getInstance();
  }

  /**
   * Initialize all systems
   */
  async initialize(config: SystemInitializationConfig = {}): Promise<void> {
    const {
      initializeStateService = true,
      initializeDI = true,
      initializeStrategies = true,
      initializeEvents = true,
      initializePlugins = true,
    } = config;

    try {
      // Initialize State Service
      if (initializeStateService) {
        this.stateService = StateService.getInstance();
        await this.stateService.initialize();
        this.logger.info('State Service initialized', {}, this.context);
      }

      // Initialize DI Container
      if (initializeDI) {
        this.diContainer = Container.getInstance();
        this.logger.info('DI Container initialized', {}, this.context);
      }

      // Initialize Strategy Manager
      if (initializeStrategies) {
        this.strategyManager = new StrategyManager();
        this.logger.info('Strategy Manager initialized', {}, this.context);
      }

      // Initialize Event Emitter
      if (initializeEvents) {
        this.eventEmitter = new UnifiedEventEmitter();
        this.logger.info('Unified Event Emitter initialized', {}, this.context);
      }

      // Initialize Plugin Manager
      if (initializePlugins) {
        this.pluginManager = new PluginManager();
        this.logger.info('Plugin Manager initialized', {}, this.context);
      }

      this.logger.info(
        'System initialization complete',
        {
          stateService: initializeStateService,
          diContainer: initializeDI,
          strategyManager: initializeStrategies,
          eventEmitter: initializeEvents,
          pluginManager: initializePlugins,
        },
        this.context
      );
    } catch (error) {
      this.logger.error(
        'System initialization failed',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      throw error;
    }
  }

  /**
   * Get initialized services
   */
  getStateService(): StateService | undefined {
    return this.stateService;
  }

  getDIContainer(): Container | undefined {
    return this.diContainer;
  }

  getStrategyManager(): StrategyManager | undefined {
    return this.strategyManager;
  }

  getEventEmitter(): UnifiedEventEmitter | undefined {
    return this.eventEmitter;
  }

  getPluginManager(): PluginManager | undefined {
    return this.pluginManager;
  }

  /**
   * Cleanup all systems
   */
  async cleanup(): Promise<void> {
    try {
      if (this.pluginManager) {
        const plugins = this.pluginManager.getPlugins();
        for (const plugin of plugins) {
          await this.pluginManager.unregisterPlugin(plugin.metadata.id);
        }
      }

      if (this.stateService) {
        // State service persists automatically, no cleanup needed
      }

      this.logger.info('System cleanup complete', {}, this.context);
    } catch (error) {
      this.logger.warn(
        'Error during system cleanup',
        { error: error instanceof Error ? error.message : String(error) },
        this.context
      );
    }
  }
}

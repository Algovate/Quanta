/**
 * Plugin Architecture
 * Extensible plugin system for trading strategies and features
 */

import { UnifiedLogger } from '../logging/index.js';

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entryPoint: string;
  dependencies?: string[];
  configSchema?: Record<string, any>;
}

export interface PluginConfig {
  enabled: boolean;
  params: Record<string, any>;
}

export interface Plugin {
  metadata: PluginMetadata;
  initialize(config: PluginConfig): Promise<void>;
  execute(context: any): Promise<any>;
  cleanup?(): Promise<void>;
}

/**
 * Plugin Manager
 * Manages plugin lifecycle and execution
 */
export class PluginManager {
  private logger: UnifiedLogger;
  private readonly context = 'PluginManager';
  private plugins: Map<string, Plugin> = new Map();
  private pluginConfigs: Map<string, PluginConfig> = new Map();

  constructor() {
    this.logger = UnifiedLogger.getInstance();
  }

  /**
   * Register a plugin
   */
  async registerPlugin(plugin: Plugin): Promise<void> {
    const { id, name } = plugin.metadata;

    // Check dependencies
    if (plugin.metadata.dependencies) {
      for (const dep of plugin.metadata.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(`Plugin ${id} requires dependency ${dep} which is not registered`);
        }
      }
    }

    // Initialize plugin if enabled
    const config = this.pluginConfigs.get(id) || { enabled: true, params: {} };
    if (config.enabled) {
      try {
        await plugin.initialize(config);
      } catch (error) {
        this.logger.error(
          `Failed to initialize plugin ${id}`,
          error instanceof Error ? error : new Error(String(error)),
          this.context
        );
        throw error;
      }
    }

    this.plugins.set(id, plugin);
    this.logger.info(
      `Registered plugin: ${name} (${id})`,
      {
        pluginId: id,
        version: plugin.metadata.version,
        enabled: config.enabled,
      },
      this.context
    );
  }

  /**
   * Unregister a plugin
   */
  async unregisterPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return;
    }

    // Cleanup plugin if it has cleanup method
    if (plugin.cleanup) {
      try {
        await plugin.cleanup();
      } catch (error) {
        this.logger.warn(
          `Error cleaning up plugin ${pluginId}`,
          { error: error instanceof Error ? error.message : String(error) },
          this.context
        );
      }
    }

    this.plugins.delete(pluginId);
    this.logger.info(`Unregistered plugin: ${pluginId}`, {}, this.context);
  }

  /**
   * Get all registered plugins
   */
  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a specific plugin
   */
  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Execute a plugin
   */
  async executePlugin(pluginId: string, context: any): Promise<any> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const config = this.pluginConfigs.get(pluginId);
    if (!config || !config.enabled) {
      throw new Error(`Plugin ${pluginId} is not enabled`);
    }

    try {
      return await plugin.execute(context);
    } catch (error) {
      this.logger.error(
        `Plugin ${pluginId} execution failed`,
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      throw error;
    }
  }

  /**
   * Enable/disable a plugin
   */
  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    let config = this.pluginConfigs.get(pluginId);
    if (!config) {
      config = { enabled, params: {} };
      this.pluginConfigs.set(pluginId, config);
    } else {
      config.enabled = enabled;
    }

    if (enabled) {
      // Initialize if enabling
      await plugin.initialize(config);
    } else {
      // Cleanup if disabling
      if (plugin.cleanup) {
        await plugin.cleanup();
      }
    }

    this.logger.info(
      `${enabled ? 'Enabled' : 'Disabled'} plugin: ${pluginId}`,
      { pluginId, enabled },
      this.context
    );
  }

  /**
   * Update plugin configuration
   */
  updatePluginConfig(pluginId: string, params: Record<string, any>): void {
    let config = this.pluginConfigs.get(pluginId);
    if (!config) {
      config = { enabled: true, params: {} };
      this.pluginConfigs.set(pluginId, config);
    }

    config.params = { ...config.params, ...params };
  }

  /**
   * Get plugin configuration
   */
  getPluginConfig(pluginId: string): PluginConfig | undefined {
    return this.pluginConfigs.get(pluginId);
  }
}

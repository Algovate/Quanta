/**
 * Dependency Injection Container
 * Provides dependency injection capabilities
 */

import { ServiceRegistry } from './service-registry.js';

export type ServiceIdentifier = string | symbol | Function;

/**
 * Dependency injection container
 */
export class Container {
  private static instance: Container;
  private registry: ServiceRegistry;

  private constructor() {
    this.registry = ServiceRegistry.getInstance();
  }

  static getInstance(): Container {
    if (!Container.instance) {
      Container.instance = new Container();
    }
    return Container.instance;
  }

  /**
   * Register a service with factory function
   */
  register<T>(identifier: ServiceIdentifier, factory: () => T, singleton: boolean = true): void {
    this.registry.register(identifier, factory, singleton);
  }

  /**
   * Register a service instance
   */
  registerInstance<T>(identifier: ServiceIdentifier, instance: T): void {
    this.registry.registerInstance(identifier, instance);
  }

  /**
   * Resolve a service
   */
  resolve<T>(identifier: ServiceIdentifier): T {
    return this.registry.resolve<T>(identifier);
  }

  /**
   * Check if service is registered
   */
  isRegistered(identifier: ServiceIdentifier): boolean {
    return this.registry.isRegistered(identifier);
  }

  /**
   * Clear all services
   */
  clear(): void {
    this.registry.clear();
  }
}

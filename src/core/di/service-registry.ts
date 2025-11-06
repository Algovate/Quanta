/**
 * Service Registry
 * Manages service registration and resolution
 */

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export type ServiceIdentifier = string | symbol | Function;

export interface ServiceDescriptor {
  identifier: ServiceIdentifier;
  factory?: () => any;
  instance?: any;
  singleton?: boolean;
}

/**
 * Service registry for dependency injection
 */
export class ServiceRegistry {
  private static instance: ServiceRegistry;
  private services: Map<ServiceIdentifier, ServiceDescriptor> = new Map();

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): ServiceRegistry {
    if (!ServiceRegistry.instance) {
      ServiceRegistry.instance = new ServiceRegistry();
    }
    return ServiceRegistry.instance;
  }

  /**
   * Register a service
   */
  register<T>(identifier: ServiceIdentifier, factory: () => T, singleton: boolean = true): void {
    this.services.set(identifier, {
      identifier,
      factory,
      singleton,
    });
  }

  /**
   * Register a service instance
   */
  registerInstance<T>(identifier: ServiceIdentifier, instance: T): void {
    this.services.set(identifier, {
      identifier,
      instance,
      singleton: true,
    });
  }

  /**
   * Resolve a service
   */
  resolve<T>(identifier: ServiceIdentifier): T {
    const descriptor = this.services.get(identifier);

    if (!descriptor) {
      throw new Error(`Service not registered: ${String(identifier)}`);
    }

    // If singleton and already instantiated, return instance
    if (descriptor.singleton && descriptor.instance) {
      return descriptor.instance as T;
    }

    // If instance provided, use it
    if (descriptor.instance) {
      return descriptor.instance as T;
    }

    // If factory provided, create instance
    if (descriptor.factory) {
      const instance = descriptor.factory();

      // If singleton, store instance
      if (descriptor.singleton) {
        descriptor.instance = instance;
      }

      return instance as T;
    }

    throw new Error(`Service has no factory or instance: ${String(identifier)}`);
  }

  /**
   * Check if service is registered
   */
  isRegistered(identifier: ServiceIdentifier): boolean {
    return this.services.has(identifier);
  }

  /**
   * Clear all services
   */
  clear(): void {
    this.services.clear();
  }
}

/**
 * CLI Domain Errors - Structured error types for CLI commands
 */

/**
 * Base CLI error class
 */
export class CLIError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'CLIError';
  }
}

/**
 * Session conflict error
 */
export class SessionConflictError extends CLIError {
  constructor(mode: string, id: string) {
    super(
      `Another execution session is active (mode: ${mode}, id: ${id}). Stop it before starting a new one.`,
      'E_SESSION_ACTIVE',
      { mode, id }
    );
    this.name = 'SessionConflictError';
  }
}

/**
 * Invalid configuration error
 */
export class InvalidConfigError extends CLIError {
  constructor(message: string, details?: unknown) {
    super(message, 'E_INVALID_CONFIG', details);
    this.name = 'InvalidConfigError';
  }
}

/**
 * Invalid environment error
 */
export class InvalidEnvError extends CLIError {
  constructor(env: string, validEnvs: string[]) {
    super(
      `Invalid env: "${env}". Valid environments are: ${validEnvs.join(', ')}`,
      'E_INVALID_ENV',
      { env, validEnvs }
    );
    this.name = 'InvalidEnvError';
  }
}

/**
 * Missing API key error
 */
export class MissingAPIKeyError extends CLIError {
  constructor(service: string) {
    super(
      `API key required for ${service}. Set environment variable or configure in config.json`,
      'E_MISSING_API_KEY',
      { service }
    );
    this.name = 'MissingAPIKeyError';
  }
}

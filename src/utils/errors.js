/**
 * Custom error classes for OmniRouteAI
 */

export class ProviderError extends Error {
  constructor(provider, message, statusCode = 502, model = 'unknown', cause = null) {
    super(`[${provider}|${model}] ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.model = model;
    this.statusCode = statusCode;
    this.cause = cause;
  }
}

export class KeyExhaustedError extends Error {
  constructor(provider, message = 'All API keys exhausted') {
    super(`[${provider}] ${message}`);
    this.name = 'KeyExhaustedError';
    this.provider = provider;
    this.statusCode = 503;
  }
}

export class CircuitOpenError extends Error {
  constructor(provider) {
    super(`[${provider}] Circuit breaker OPEN — provider temporarily disabled`);
    this.name = 'CircuitOpenError';
    this.provider = provider;
    this.statusCode = 503;
  }
}

export class CacheError extends Error {
  constructor(message, cause = null) {
    super(`Cache error: ${message}`);
    this.name = 'CacheError';
    this.cause = cause;
  }
}

export class AllProvidersExhaustedError extends Error {
  constructor() {
    super('All providers and keys exhausted after max retries');
    this.name = 'AllProvidersExhaustedError';
    this.statusCode = 503;
  }
}

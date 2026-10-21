// Tests must never touch the network. Anything that needs HTTP takes an
// injected `Http` backed by recorded fixtures.
globalThis.fetch = () => {
  throw new Error('Network access is disabled in tests. Inject a replay Http instead.');
};

// Registry retries back off with real sleeps in production; tests exercise the retry path without waiting.
const { registryRetry } = await import('../src/registry/resolve.js');
registryRetry.baseDelayMs = 0;

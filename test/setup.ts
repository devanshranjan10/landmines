// Tests must never touch the network. Anything that needs HTTP takes an
// injected `Http` backed by recorded fixtures.
globalThis.fetch = () => {
  throw new Error('Network access is disabled in tests. Inject a replay Http instead.');
};

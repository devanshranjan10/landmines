import type { Landmine } from './types.js';

/** A touched symbol must score at least this on an issue for the hook to fire. */
export const SYMBOL_THRESHOLD = 0.6;

/** Symbols on this landmine strong enough to trigger the hook. */
export function armedSymbols(l: Landmine): string[] {
  return l.symbols.filter((s) => s.score >= SYMBOL_THRESHOLD).map((s) => s.name);
}

/** Can the hook ever fire on this landmine? Needs non-weak version evidence and at least one strong symbol. */
export function isArmed(l: Landmine): boolean {
  return l.evidence.strength !== 'weak' && armedSymbols(l).length > 0;
}

import type { Landmine } from './types.js';

/** A touched symbol must score at least this on an issue for the hook to fire. */
export const SYMBOL_THRESHOLD = 0.6;

/** Symbols on this landmine strong enough to trigger the hook. */
export function armedSymbols(l: Landmine): string[] {
  return l.symbols.filter((s) => s.score >= SYMBOL_THRESHOLD).map((s) => s.name);
}

/** A trigger card that rules the issue out (not a bug, or not in this version). */
export function cardDisarms(l: Landmine): boolean {
  const c = l.card;
  return Boolean(c && (!c.isBug || c.affectsPinned === 'no' || c.apis.length === 0 || c.selfCheck === 'fail'));
}

/**
 * Can the hook ever fire on this landmine? Needs non-weak version evidence, and either a trigger card that says it is
 * a bug in this version, or (without a card) at least one strong symbol and no feature-request label.
 */
export function isArmed(l: Landmine): boolean {
  if (l.evidence.strength === 'weak') return false;
  if (l.card) return !cardDisarms(l);
  return !l.nonBug && armedSymbols(l).length > 0;
}

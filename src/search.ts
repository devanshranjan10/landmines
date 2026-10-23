import { cardDisarms, isArmed } from './policy.js';
import { reportable } from './render.js';
import type { Landmine, LandmineIndex } from './types.js';

const TOKEN = /[A-Za-z_$][\w$]{2,}/g;

/** Words in almost every error message or issue title: matching them says nothing. */
const SEARCH_STOPWORDS = new Set(
  'the and for with when not does doesn from that this have has get set use using used error errors bug issue function functions method value values type types return returns returned null undefined true false cannot can can\'t work works working broken wrong fails failed failing throw throws thrown when after before new old version versions call called calls object objects string number data file files code'.split(
    ' ',
  ),
);

/** Rank issues by how many of the query's words appear in their title, labels, symbols and trigger card. */
export function searchLandmines(index: LandmineIndex, query: string, pkg?: string, limit = 5): Landmine[] {
  const words = new Set((query.match(TOKEN) ?? []).map((w) => w.toLowerCase()).filter((w) => !SEARCH_STOPWORDS.has(w)));
  if (words.size === 0) return [];
  const seen = new Set<string>();
  const scored: Array<{ l: Landmine; score: number }> = [];
  for (const l of index.landmines) {
    if ((pkg && l.package !== pkg) || !reportable(l) || seen.has(l.id)) continue;
    seen.add(l.id);
    // Title, labels, symbols, and the trigger card's APIs and condition (the card's wording is often what an error says).
    const cardText = l.card && !cardDisarms(l) ? `${l.card.apis.join(' ')} ${l.card.condition}` : '';
    const hay = new Set(
      [...(`${l.issue.title} ${l.issue.labels.join(' ')} ${cardText}`.match(TOKEN) ?? []), ...l.symbols.flatMap((s) => s.name.split(/[./]/)), ...(l.card?.apis.flatMap((a) => a.split('.')) ?? [])].map((w) => w.toLowerCase()),
    );
    let score = 0;
    for (const w of words) if (hay.has(w)) score++;
    if (score > 0) scored.push({ l, score: score + (l.evidence.strength === 'strong' ? 0.5 : 0) + (isArmed(l) ? 0.5 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || b.l.issue.reactions - a.l.issue.reactions);
  // Keep results that match at least half as many query words as the best one: a single shared word is noise.
  const best = scored[0]?.score ?? 0;
  return scored
    .filter((s) => s.score >= Math.max(1, best / 2))
    .slice(0, limit)
    .map((s) => s.l);
}

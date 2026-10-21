# Terse prompt variants (`prompt-terse.txt`)

Every `set: "fresh"` task (31) has a `prompt-terse.txt` next to `prompt.txt`. The terse variant is the same request
phrased the way a real user would write it. It removes only the sentences or clauses that turn the bug's triggering edge
case into an explicit requirement. Facts about the data or environment stay, as do interface details the hidden test checks
and the closing constraints. Eight prompts had no such prescription, so their terse variant is byte-identical to the spec
prompt.

Rules applied (the same for every task):
- Remove a clause only if it targets the edge-case condition, or if it restates the edge-relevant behaviour when the same
  information is already given elsewhere (in an example annotation or a docstring).
- Keep a clause if it is the general spec of the feature, even when it is the property the bug breaks.
- If the test checks an exact edge-case detail that isn't inferable, keep the minimal wording, phrased as a general property.

| task | what was removed (short) | what was kept to stay fair |
|---|---|---|
| arrow-1341 | "and those need to come out exact"; "(that's 12 hours before `now`)" | Fact that people type `in 1.5 hours` / `0.5 days ago`; describe() round-trip phrasing; ValueError; UTC Arrow |
| csv-parse-536 | "All of these must work." | Full list of encodings seen (UTF-8 ± BOM, UTF-16LE + BOM); trim requirement (also tested on plain UTF-8) |
| date-fns-4384 | Bullet "A label must never read 60 seconds/60 minutes/24 hours; those are 1 minute/1 hour/1 day" | Unit rule "seconds under a minute, minutes under an hour, hours under a day", rounding, singular, past/future format. **Borderline**, see below |
| dayjs-3279 | "A leading `-` means before the event start; no sign or `+` means at or after it." | All TRIGGER examples with their annotations ("15 minutes before the start", "a day before", "5 minutes after"), so sign semantics are still stated as facts |
| fast-xml-parser-892 | "Titles and brands must come out as the plain decoded text" | Fact that values may use any standard XML escaping incl. numeric char refs `&#233;` / `&#xE9;`; titles/brands go into the search index; single/empty-feed rule (`[]`) |
| networkx-8964 | nothing (identical) | Prompt has no edge-case prescription; the triggering graph shape (cheap back links) was never mentioned |
| pandas-67949 | "i.e. `isna()` is True for those rows" (and "must") | "Anything that isn't a valid number (text or blank) becomes a missing value", which is also in the docstring; summary semantics |
| pandas-68026 | nothing (identical) | The XSD types (`in_stock` is `xs:boolean`) and "feeds that don't validate are rejected" are facts about the partner |
| pandas-70811 | nothing (identical) | `" | "` separator fact, column naming, skipped→all zeros are interface requirements, not about the separator bug |
| pandas-71280 | "Each row has to land in the Stata week of the calendar year its `week` date belongs to." | The Stata weekly-calendar reminder (52 weeks, week 52 runs to Dec 31, 8 or 9 days). It's a fact about the target format, so it stays. **Weak removal:** the remaining fact still strongly hints at the edge |
| pandas-71282 | nothing (identical) | Band boundaries and "skipped scores get no band (a missing value)" are the interface; the bug (wrong bins with object dtype + NaN) was never spelled out |
| papaparse-1174 | "must contain a column for every field that appears in any of the records, ordered by first appearance (...); records without a value get an empty cell" | Fact "API omits optional fields that are empty, so records don't all have the same keys"; general property "Columns follow the order of the records' keys"; empty→`''`; quoting. **Mildly borderline**, see below |
| plotly-5792 | nothing (identical) | Layout spec incl. "(Plotly's usual row-title placement, vertically centred on the row)". That is the generic spec of the feature, not the colspan trigger |
| plotly-5805 | "it gets the start color" (single category) | Fact "Filtered views often leave just one category"; "first category gets the start color" (implies the single-category answer); empty→`{}` |
| plotly-5827 | "as text" in "each trace's `name` is the value as text" | "each trace is named after its value, so the legend reads e.g. `North` or, for stores, `12`" (Plotly stores a Python int name as "12", so the test is still satisfiable) |
| polars-30043 | "Lookups must work for every user in the index;" | Fact "production index currently holds about 500,000 users"; return shape; normalisation; None for unknown |
| polars-30081 | nothing (identical) | Tie-break "submitted earlier comes first" and `submitted_at` as a rank column are interface; repeated sort keys never mentioned |
| polars-30105 | "with every column (`event_id`, ..., `reviewed`) unchanged from what the collector sent" | Exact-last-`max_rows`-in-arrival-order requirement; "A single batch can be larger than `max_rows`"; aggregates reflect the window |
| pyarrow-51162 | "so a snapshot must keep showing the entries exactly as they were when it was taken, even if corrections ... are applied" | "frozen copies" (first sentence); fact that the archiver keeps snapshots and reads them later and that corrections can be applied after a snapshot; "must not change the ledger" |
| pyarrow-51368 | "it must come through exactly as exported, line breaks included" | Facts: CRLF line endings, descriptions often multi-line, support bot quotes them back to customers, nightly export is a few MB; exact TICKET_SCHEMA |
| pyarrow-51491 | ": failed samples must always be included" | Definition "every reading whose `mm` is not exactly 0.0. That covers rainfall readings and failed samples, recorded as NaN" (that is what defines the result set) |
| pyarrow-54534 | "that denotes exactly the moment of the observation, to the second"; "including our oldest records" turned into a plain fact | ISO 8601 with UTC offset or `Z`; portal parses with a standard parser onto a common UTC timeline; fact that records go back to 1869 / 1880 |
| pyarrow-54535 | Bullet "The round trip must be lossless: same rows, same order, missing values still null" | `load_extract` "reads such a file back" with exact schema; facts "some have several columns and some have just one" and "Missing metrics are null" (also in docstring) |
| rich-4214 | "there it should simply print one name per line instead of failing" | Fact "People also run this in narrow tmux panes (20-something columns or less)"; "as many columns per row as fit the console width" |
| rich-4216 | nothing (identical) | "use `heading()`, i.e. centered across the 60 columns" is the core spec of the heading, not an edge case |
| scipy-26188 | "so f = 0 must be supported; there the 'power' is just the false-positive rate `alpha`" | Fact "The dashboard plots power for f from 0 upwards" (power at f=0 equals alpha by definition of the test) |
| scipy-26406 | "so `process` must also accept empty chunks (and return an empty array for them)" | Fact "When a poll times out the reader passes an empty array"; "chunk of any length", "returns the filtered samples for that chunk", chunking-invariance requirement |
| scipy-26409 | "which must be accurate to within 0.01" | Facts: per-node p 1e-6..1e-2, 3-12 nodes, "so loss probabilities are often extremely small", planner compares by nines |
| semver-904 | nothing (identical) | "Policies can combine a caret/tilde range with an extra floor or cap" is a fact; classification definitions are interface |
| yaml-733 | Bullet "Exporting must be lossless: `importSnippets(exportSnippets(lib))` must give back exactly `lib`"; "and whitespace matters" | 4-space indentation rule (tested); facts that bodies are multi-line, may or may not end with a newline, and often start with indentation |
| zod-6666 | Wording only: "null when the field is absent" became "or `null` if there is none" | Fact that the API leaves `constructor` out for historic entries / test sessions; null return (docstring says `string \| null`); non-empty-string rule. Effectively unchanged |

## Borderline / caveats

- **date-fns-4384 (borderline):** The test expects 59.6 s → "1 minute ago", 59 min 45 s → "1 hour ago", 23 h 50 min → "1 day ago".
  The terse prompt still has "seconds under a minute ... round to the nearest whole number". Read with normal expectations,
  that rules out "60 seconds ago". A strictly literal reading (choose the unit, then round) gives "60 seconds ago", which
  is exactly the library's behaviour. I left the hint out because restating it in any general form would just point at the
  bug, but this is the task most open to an "unfair" objection.
- **papaparse-1174 (mild):** The sparse-records test needs the union of all keys in first-appearance order, with empty
  cells. The terse prompt keeps "records don't all have the same keys" and "Columns follow the order of the records' keys".
  An export that silently drops data isn't a reasonable outcome, and first-appearance order is the natural reading. Still,
  the exact column order isn't uniquely pinned down.
- **pandas-71280 (weak removal, not unfair):** The Stata weekly-calendar fact (week 52 runs to Dec 31) stays because it's a
  fact about the format. The terse variant is therefore barely harder than the spec one.
- **pyarrow-54535 / yaml-733 / pyarrow-54534 (fine, noted):** These dropped explicit "round trip must be lossless" or
  "exact moment to the second" requirements. A loader that reads back what the saver wrote, and a timestamp that names
  the correct instant, are normal expectations, so I'm not flagging them as unfair.
- **Identical prompts (8):** networkx-8964, pandas-68026, pandas-70811, pandas-71282, plotly-5792, polars-30081,
  rich-4216, semver-904. Their spec prompts never prescribed the edge case, so there was nothing to remove. zod-6666 is
  effectively identical (wording only).

import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(customParseFormat);

/** BaltLine manifests: "29/07/2021". Returns 'YYYY-MM-DD' or null. */
export function parseBaltLineDate(raw) {
  const d = dayjs(String(raw ?? '').trim(), 'DD/MM/YYYY', true);
  return d.isValid() ? d.format('YYYY-MM-DD') : null;
}

/** Nordfracht manifests: "29.Jul.21". Returns 'YYYY-MM-DD' or null. */
export function parseNordfrachtDate(raw) {
  const d = dayjs(String(raw ?? '').trim(), 'DD.MMM.YY', true);
  return d.isValid() ? d.format('YYYY-MM-DD') : null;
}

const PARSERS = { baltline: parseBaltLineDate, nordfracht: parseNordfrachtDate };

/** Normalise one manifest row: { carrier, ref, shipped } -> { ref, shippedOn } */
export function normalizeRow(row) {
  const parse = PARSERS[row.carrier];
  if (!parse) throw new Error(`unknown carrier ${row.carrier}`);
  return { ref: row.ref, shippedOn: parse(row.shipped) };
}

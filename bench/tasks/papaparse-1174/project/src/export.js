import Papa from 'papaparse';

/** Parse a CSV contact import (header row required) into plain objects of strings. */
export function fromCsv(text) {
  const { data } = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
  return data;
}

/**
 * Serialise contact records (plain objects as returned by the CRM API) to CSV text
 * with a header row.
 */
export function toCsv(records) {
  throw new Error('not implemented');
}

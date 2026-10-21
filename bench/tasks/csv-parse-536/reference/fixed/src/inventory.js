import { parse } from 'csv-parse/sync';

/** Parse the internal price list export (a UTF-8 string with header `sku,price`). */
export function parsePriceList(text) {
  return parse(text, { columns: true, skip_empty_lines: true }).map((r) => ({ sku: r.sku, price: Number(r.price) }));
}

/**
 * Parse a stock-count upload (the raw file contents as a Buffer) with header `sku,name,qty`.
 * Returns [{ sku: string, name: string, qty: number }].
 */
export function parseStockCount(buffer) {
  // Decode ourselves so trimming always runs on text, whatever the file's encoding.
  let text;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.subarray(2).toString('utf16le');
  else if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) text = buffer.subarray(3).toString('utf8');
  else text = buffer.toString('utf8');
  const rows = parse(text, { columns: true, trim: true, skip_empty_lines: true });
  return rows.map((r) => ({ sku: r.sku, name: r.name, qty: Number(r.qty) }));
}

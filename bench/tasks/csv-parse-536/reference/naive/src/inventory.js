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
  const rows = parse(buffer, { bom: true, columns: true, trim: true, skip_empty_lines: true });
  return rows.map((r) => ({ sku: r.sku, name: r.name, qty: Number(r.qty) }));
}

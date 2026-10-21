import { XMLParser } from 'fast-xml-parser';

/**
 * Supplier product feed, e.g.
 *
 *   <catalog supplier="nordhaus">
 *     <product sku="NH-1001" brand="Nordhaus">
 *       <title>Oak side table</title>
 *       <price currency="EUR">129.00</price>
 *     </product>
 *     ...
 *   </catalog>
 */

/** Supplier id from the feed's root element. */
export function supplierOf(xml) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  return parser.parse(xml).catalog['@_supplier'];
}

/**
 * Products in a supplier feed as plain objects:
 *   { sku: string, brand: string, title: string, price: number, currency: string }
 */
export function parseProducts(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    htmlEntities: true,
    isArray: (name) => name === 'product',
  });
  const doc = parser.parse(xml);
  const products = doc.catalog?.product ?? [];
  return products.map((p) => ({
    sku: String(p['@_sku']),
    brand: String(p['@_brand']),
    title: String(p.title),
    price: Number(p.price['#text']),
    currency: p.price['@_currency'],
  }));
}

// Hidden test for axios-6587. Uses a loopback Partner API stub. Run from the task's working directory.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import http from 'node:http';
const { createPartnerClient } = await import(pathToFileURL(join(process.cwd(), 'src/partnerClient.js')).href);

const BASIC = `Basic ${Buffer.from('svc-finance:s3cret').toString('base64')}`;
const seen = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const auth = req.headers.authorization || null;
  seen.push([url.pathname, auth]);
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/admin/report') {
    if (auth !== 'Bearer op-token-123') return send(401, { error: 'admin token required' });
    return send(200, { month: url.searchParams.get('month'), total: 1234.5 });
  }
  if (auth !== BASIC) return send(401, { error: 'service account required' });
  if (url.pathname === '/orders') return send(200, [{ id: 'o-1' }, { id: 'o-2' }]);
  if (url.pathname === '/orders/o-1') return send(200, { id: 'o-1' });
  return send(404, { error: 'not found' });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseURL = `http://127.0.0.1:${server.address().port}`;

let fail = 0, total = 0;
const check = (cond, msg) => { total++; if (!cond) { fail++; console.log(`FAIL ${msg}`); } };
const attempt = async (label, fn) => { try { return await fn(); } catch (e) { return { threw: `${e.message}${e.response ? ` ${JSON.stringify(e.response.data)}` : ''}` }; } };

try {
  const client = createPartnerClient({ baseURL, username: 'svc-finance', password: 's3cret' });
  const orders = await attempt('listOrders', () => client.listOrders());
  check(Array.isArray(orders) && orders.length === 2, `listOrders before admin call: ${JSON.stringify(orders)}`);
  const report = await attempt('getAdminReport', () => client.getAdminReport('op-token-123', '2024-05'));
  check(report && report.month === '2024-05' && report.total === 1234.5, `getAdminReport('op-token-123', '2024-05') = ${JSON.stringify(report)}; server saw ${JSON.stringify(seen.filter(([p]) => p === '/admin/report'))}`);
  const order = await attempt('getOrder', () => client.getOrder('o-1'));
  check(order && order.id === 'o-1', `getOrder after admin call: ${JSON.stringify(order)}`);
  const orders2 = await attempt('listOrders', () => client.listOrders());
  check(Array.isArray(orders2) && orders2.length === 2, `listOrders after admin call: ${JSON.stringify(orders2)}`);
  const report2 = await attempt('getAdminReport', () => client.getAdminReport('op-token-123', '2024-06'));
  check(report2 && report2.month === '2024-06', `second getAdminReport = ${JSON.stringify(report2)}`);
} finally {
  server.close();
}
console.log(fail ? `FAILED ${fail}/${total}` : `PASSED ${total}/${total}`);
process.exit(fail ? 1 : 0);

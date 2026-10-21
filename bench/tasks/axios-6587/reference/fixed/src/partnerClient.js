import axios from 'axios';

/**
 * Client for the Partner API. Regular endpoints authenticate with our service account (HTTP Basic).
 * @param {{ baseURL: string, username: string, password: string, timeout?: number }} config
 */
export function createPartnerClient({ baseURL, username, password, timeout = 5000 }) {
  // Basic credentials go in a default header (not axios `auth`, which would override per-request Authorization).
  const basic = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const http = axios.create({
    baseURL,
    timeout,
    headers: { Accept: 'application/json', Authorization: basic },
  });

  return {
    /** GET /orders */
    async listOrders(params = {}) {
      const { data } = await http.get('/orders', { params });
      return data;
    },

    /** GET /orders/:id */
    async getOrder(id) {
      const { data } = await http.get(`/orders/${encodeURIComponent(id)}`);
      return data;
    },

    /** GET /admin/report?month=YYYY-MM, authenticated with the operator's bearer token. */
    async getAdminReport(adminToken, month) {
      const { data } = await http.get('/admin/report', {
        params: { month },
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      return data;
    },
  };
}

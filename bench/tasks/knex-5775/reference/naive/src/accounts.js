// Account queries (Postgres). Each function takes the knex instance and the current request id and
// returns the query; callers await it. Every query is tagged "/* req:<requestId> */" for the slow-query log.
// Table: accounts (id bigint primary key, name text, plan text, created_at timestamptz)

const tag = (requestId) => `req:${requestId}`;

export function getAccount(db, requestId, accountId) {
  return db("accounts").where({ id: accountId }).first().comment(tag(requestId));
}

export function listAccountsByPlan(db, requestId, plan) {
  return db("accounts").select("id", "name").where({ plan }).orderBy("id").comment(tag(requestId));
}

/** Set the plan of an account. */
export function changePlan(db, requestId, accountId, plan) {
  return db("accounts").where({ id: accountId }).update({ plan }).comment(tag(requestId));
}

/** Delete an account. */
export function closeAccount(db, requestId, accountId) {
  return db("accounts").where({ id: accountId }).del().comment(tag(requestId));
}

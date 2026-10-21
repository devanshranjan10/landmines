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

// knex drops query comments on pg write queries, so prefix the compiled SQL ourselves.
function tagged(db, requestId, query) {
  const { sql, bindings } = query.toSQL();
  return db.raw(`/* ${tag(requestId)} */ ${sql}`, bindings);
}

/** Set the plan of an account. */
export function changePlan(db, requestId, accountId, plan) {
  return tagged(db, requestId, db("accounts").where({ id: accountId }).update({ plan }));
}

/** Delete an account. */
export function closeAccount(db, requestId, accountId) {
  return tagged(db, requestId, db("accounts").where({ id: accountId }).del());
}

// Session queries (Postgres). Each function takes the knex instance and returns the query; callers await it.
// Table: sessions (id bigserial primary key, user_id bigint, token text, created_at timestamptz, expires_at timestamptz)

export function findSessionByToken(db, token) {
  return db("sessions").where({ token }).first();
}

export function createSession(db, { userId, token, expiresAt }) {
  return db("sessions").insert({ user_id: userId, token, expires_at: expiresAt }).returning(["id", "expires_at"]);
}

export function revokeUserSessions(db, userId) {
  return db("sessions").where({ user_id: userId }).del();
}

/**
 * Delete at most `batchSize` sessions that expired before `now`.
 * Resolves to the number of deleted rows.
 */
export function purgeExpiredSessions(db, now, batchSize = 1000) {
  throw new Error('not implemented');
}

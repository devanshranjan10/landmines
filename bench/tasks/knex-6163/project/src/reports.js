// Reporting queries for the customer-success dashboard (Postgres).
// Each function takes the knex instance and returns the query; callers await it.
// Table: users (id bigint, org_id bigint, email text, plan text, last_seen_at timestamptz, features jsonb)

/** Number of users per plan in an organisation that were active since `since`. */
export function activeUsersByPlan(db, { orgId, since }) {
  return db.raw(
    `select plan, count(*)::int as users
       from users
      where org_id = :orgId
        and last_seen_at >= :since
      group by plan
      order by plan`,
    { orgId, since },
  );
}

/** Users of an organisation that have not been seen for `days` days, oldest first. */
export function dormantUsers(db, { orgId, days }) {
  return db.raw(
    `select id, email, last_seen_at
       from users
      where org_id = :orgId
        and last_seen_at < now() - make_interval(days => :days)
      order by last_seen_at`,
    { orgId, days },
  );
}

/** id and email of the users of `orgId` whose `features` jsonb object has the key `feature`, ordered by id. */
export function usersWithFeature(db, { orgId, feature }) {
  throw new Error('not implemented');
}

import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, serial, text } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
});

export const db = drizzle({ connection: process.env.DATABASE_URL ?? 'postgres://localhost/demo' });

export async function findUser(id: number) {
  return db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, id) });
}

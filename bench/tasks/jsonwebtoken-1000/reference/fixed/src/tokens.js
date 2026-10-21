import jwt from 'jsonwebtoken';

const SECRET = process.env.TOKEN_SECRET || 'dev-only-secret-change-me';

export const SIGN_OPTIONS = { algorithm: 'HS256', issuer: 'acme-auth', audience: 'acme-api', expiresIn: '15m' };
export const VERIFY_OPTIONS = { algorithms: ['HS256'], issuer: 'acme-auth', audience: 'acme-api' };

/** Verify a service token. cb(err) if invalid or expired, cb(null, payload) otherwise. */
export function verifyToken(token, cb) {
  jwt.verify(token, SECRET, VERIFY_OPTIONS, cb);
}

/**
 * Issue a short-lived token for an internal service.
 * cb(err) on failure, cb(null, token) on success.
 */
export function issueServiceToken(claims, cb) {
  let token;
  try {
    // Synchronous sign throws on conflicting claims; the callback form can report the error and then a token too.
    token = jwt.sign({ ...claims }, SECRET, SIGN_OPTIONS);
  } catch (err) {
    process.nextTick(cb, err);
    return;
  }
  process.nextTick(cb, null, token);
}

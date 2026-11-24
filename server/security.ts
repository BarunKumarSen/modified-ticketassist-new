import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 hours

// Process-scoped cryptographic secret used unless overridden via env or DB App_Meta
let runtimeJwtSecret: string =
  process.env.JWT_SECRET?.trim() || crypto.randomBytes(32).toString('hex');

const revokedTokenIds = new Set<string>();

export function initSecurityForDatabase(db: DatabaseSync): void {
  if (process.env.JWT_SECRET?.trim()) {
    runtimeJwtSecret = process.env.JWT_SECRET.trim();
    return;
  }
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS App_Meta (
        meta_key TEXT PRIMARY KEY,
        meta_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS Revoked_Tokens (
        jti TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        revoked_at TEXT NOT NULL
      );
    `);
    const existing = db
      .prepare(`SELECT meta_value FROM App_Meta WHERE meta_key = 'jwt_runtime_secret' LIMIT 1`)
      .get() as { meta_value: string } | undefined;
    if (existing?.meta_value) {
      runtimeJwtSecret = existing.meta_value;
    } else {
      const generated = crypto.randomBytes(32).toString('hex');
      db.prepare(
        `INSERT OR IGNORE INTO App_Meta (meta_key, meta_value, updated_at) VALUES ('jwt_runtime_secret', ?, ?)`
      ).run(generated, new Date().toISOString());
      const stored = db
        .prepare(`SELECT meta_value FROM App_Meta WHERE meta_key = 'jwt_runtime_secret' LIMIT 1`)
        .get() as { meta_value: string } | undefined;
      runtimeJwtSecret = stored?.meta_value || generated;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    db.prepare(`DELETE FROM Revoked_Tokens WHERE expires_at <= ?`).run(nowSec);
  } catch {
    // Keep existing process-scoped runtimeJwtSecret if initialization happens in read-only mode
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!password || !storedHash) return false;
  if (!storedHash.startsWith('scrypt$')) {
    return false;
  }
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hashHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export interface JwtPayload {
  sub: string;
  loginId: string;
  roleId: string;
  role: string;
  jti: string;
  iat: number;
  exp: number;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${pad}`, 'base64');
}

export function signJwt(
  payload: Omit<JwtPayload, 'jti' | 'iat' | 'exp'>,
  ttlSeconds: number = DEFAULT_TOKEN_TTL_SECONDS
): string {
  const secret = process.env.JWT_SECRET?.trim() || runtimeJwtSecret;
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + ttlSeconds,
  };
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = base64UrlEncode(
    crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${signature}`;
}

export function verifyJwt(token: string, db?: DatabaseSync): JwtPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  if (!header || !body || !sig) return null;

  try {
    const secret = process.env.JWT_SECRET?.trim() || runtimeJwtSecret;
    const expectedSig = base64UrlEncode(
      crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest()
    );
    const sigBuf = Buffer.from(sig, 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const decoded = JSON.parse(base64UrlDecode(body).toString('utf8')) as JwtPayload;
    if (!decoded || typeof decoded.sub !== 'string' || typeof decoded.exp !== 'number') {
      return null;
    }
    if (decoded.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (revokedTokenIds.has(decoded.jti)) {
      return null;
    }
    if (db) {
      const revokedRow = db
        .prepare(`SELECT jti FROM Revoked_Tokens WHERE jti = ? LIMIT 1`)
        .get(decoded.jti) as { jti: string } | undefined;
      if (revokedRow) {
        revokedTokenIds.add(decoded.jti);
        return null;
      }
    }
    return decoded;
  } catch {
    return null;
  }
}

export function revokeJwt(token: string, db?: DatabaseSync): void {
  const decoded = verifyJwt(token, db);
  if (decoded?.jti) {
    revokedTokenIds.add(decoded.jti);
    if (db) {
      try {
        db.prepare(
          `INSERT OR IGNORE INTO Revoked_Tokens (jti, expires_at, revoked_at) VALUES (?, ?, ?)`
        ).run(decoded.jti, decoded.exp, new Date().toISOString());
      } catch {
        // Non-fatal if Revoked_Tokens isn't present on an isolated test db
      }
    }
  }
}

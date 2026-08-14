import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const AUTH_SERVER_URL = process.env['AUTH_SERVER_URL'] ?? '';
const AUTH_SESSION_ENDPOINT = process.env['AUTH_SESSION_ENDPOINT'] ?? '/api/auth/get-session';
const SESSION_COOKIE_NAME = process.env['SESSION_COOKIE_NAME'] ?? 'better-auth.session_token';

// ─── Simple in-memory cache (avoids hammering the auth server) ────────────────

interface CacheEntry {
  userId: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000; // 60 seconds

function getCached(token: string): string | null {
  const entry = cache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(token); return null; }
  return entry.userId;
}

function setCached(token: string, userId: string): void {
  // Evict old entries if cache grows too large
  if (cache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now > v.expiresAt) cache.delete(k);
    }
  }
  cache.set(token, { userId, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Token extraction ─────────────────────────────────────────────────────────

function extractToken(req: Request): string | null {
  // 1. Authorization: Bearer <token>
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  // 2. Cookie: better-auth.session_token=<token>
  const rawCookies = req.headers['cookie'] ?? '';
  for (const part of rawCookies.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name?.trim() === SESSION_COOKIE_NAME) {
      return decodeURIComponent(rest.join('=').trim());
    }
  }

  return null;
}

// ─── Session validation ───────────────────────────────────────────────────────

interface BetterAuthSession {
  user?: { id: string; email?: string };
  session?: { id: string };
}

async function validateSessionToken(token: string): Promise<string | null> {
  if (!AUTH_SERVER_URL) {
    logger.warn('AUTH_SERVER_URL is not set — authentication is disabled. Set it to enable auth.');
    return 'anonymous'; // fallback in dev if not configured
  }

  // Check cache first
  const cached = getCached(token);
  if (cached) return cached;

  try {
    const url = `${AUTH_SERVER_URL}${AUTH_SESSION_ENDPOINT}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        // Forward token both ways Better Auth accepts it
        'Cookie': `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(5_000), // 5s timeout
    });

    if (!res.ok) return null;

    const data = await res.json() as BetterAuthSession;
    const userId = data?.user?.id ?? data?.session?.id;
    if (!userId) return null;

    setCached(token, userId);
    return userId;
  } catch (err) {
    logger.error({ err, url: AUTH_SERVER_URL }, 'Auth server request failed');
    return null;
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * requireAuth — Express middleware that validates a Better Auth session token.
 *
 * Accepts the token from:
 *   1. `Authorization: Bearer <token>` header
 *   2. `better-auth.session_token` cookie (automatically sent by the browser)
 *
 * On success: sets `req.userId` and calls `next()`.
 * On failure: returns 401 Unauthorized.
 *
 * Results are cached in-memory for 60 seconds to reduce load on the auth server.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Authentication required. Provide a valid session cookie or Authorization: Bearer <token> header.',
    });
    return;
  }

  const userId = await validateSessionToken(token);

  if (!userId) {
    res.status(401).json({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid or expired session. Please log in again.',
    });
    return;
  }

  // Attach userId to the request so controllers can use it if needed
  (req as Request & { userId: string }).userId = userId;
  next();
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

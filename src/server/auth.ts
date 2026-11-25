import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, getServiceFeeConfig } from './db.ts';

// Runtime-ephemeral fallback if SESSION_SECRET is not provided in environment
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

export const ADMIN_ROLES = new Set([
  'super_admin',
  'admin',
  'support',
  'finance',
  'moderator',
]);

export interface AuthUser {
  id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: string;
  active_role: string;
  country: string;
  city: string;
  address: string;
  account_type: string;
  avatar_url: string;
  email_verified: number;
  phone_verified: number;
  identity_verified: number;
  business_verified: number;
  verification_status: string;
  language: string;
  theme: string;
  is_blocked: number;
  roles: string[];
  subscription_status: 'active' | 'pending_payment' | 'expired' | 'exempt';
  subscription_expires_at: string | null;
  subscription_active: boolean;
  subscription_days_remaining: number;
  has_prior_subscription: boolean;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function normalizePhone(raw: string): string {
  const trimmed = raw.trim().replace(/[\s\-()]/g, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.startsWith('00')) return `+${trimmed.slice(2)}`;
  if (/^0[97]\d{8}$/.test(trimmed)) return `+251${trimmed.slice(1)}`;
  if (/^[97]\d{8}$/.test(trimmed)) return `+251${trimmed}`;
  return trimmed;
}

export function isValidPhoneOrEmail(value: string): { type: 'email' | 'phone' | 'invalid'; normalized: string } {
  const v = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    return { type: 'email', normalized: v.toLowerCase() };
  }
  const phone = normalizePhone(v);
  if (/^\+\d{8,15}$/.test(phone)) {
    return { type: 'phone', normalized: phone };
  }
  return { type: 'invalid', normalized: v };
}

export function signToken(payload: Record<string, any>, ttlSeconds = 60 * 60 * 24 * 7): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      out[k] = v;
    }
  }
  return out;
}

export function setAuthCookie(res: Response, token: string): void {
  res.setHeader(
    'Set-Cookie',
    `az_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${60 * 60 * 24 * 7}`
  );
}

export function clearAuthCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    'az_session=; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0'
  );
}

export function loadUserById(userId: number): AuthUser | null {
  const row = db
    .prepare(
      `SELECT id, full_name, email, phone, role, active_role, country, city, address,
              account_type, avatar_url, email_verified, phone_verified, identity_verified,
              business_verified, verification_status, language, theme, is_blocked,
              subscription_status, subscription_expires_at
       FROM users WHERE id = ?`
    )
    .get(userId) as any;
  if (!row) return null;
  const roles = db
    .prepare(`SELECT role_name FROM user_roles WHERE user_id = ? AND status = 'approved'`)
    .all(userId)
    .map((r: any) => r.role_name);
  if (!roles.includes(row.role)) roles.unshift(row.role);

  const isAdmin = roles.some((r: string) => ADMIN_ROLES.has(r));
  const subCountRow = db
    .prepare(`SELECT COUNT(*) as c FROM subscriptions WHERE user_id = ?`)
    .get(userId) as any;
  const hasPriorSubscription = Number(subCountRow?.c || 0) > 0;

  let expiresAt: string | null = row.subscription_expires_at || null;
  let expiresMs = 0;
  if (expiresAt) {
    const normalizedIso = expiresAt.includes('T') ? expiresAt : `${expiresAt.replace(' ', 'T')}Z`;
    const parsed = Date.parse(normalizedIso);
    if (!Number.isNaN(parsed)) expiresMs = parsed;
  }

  const nowMs = Date.now();
  let subscriptionStatus: AuthUser['subscription_status'];
  let subscriptionActive = false;
  let daysRemaining = 0;

  if (isAdmin || row.subscription_status === 'exempt') {
    subscriptionStatus = 'exempt';
    subscriptionActive = true;
    daysRemaining = 999;
  } else if (expiresMs > nowMs) {
    subscriptionStatus = 'active';
    subscriptionActive = true;
    daysRemaining = Math.max(1, Math.ceil((expiresMs - nowMs) / 86_400_000));
  } else if (hasPriorSubscription || row.subscription_status === 'expired' || expiresMs > 0) {
    subscriptionStatus = 'expired';
    subscriptionActive = false;
    daysRemaining = 0;
    if (row.subscription_status !== 'expired') {
      db.prepare(`UPDATE users SET subscription_status = 'expired' WHERE id = ?`).run(userId);
    }
  } else {
    subscriptionStatus = 'pending_payment';
    subscriptionActive = false;
    daysRemaining = 0;
  }

  return {
    ...row,
    roles,
    subscription_status: subscriptionStatus,
    subscription_expires_at: expiresAt,
    subscription_active: subscriptionActive,
    subscription_days_remaining: daysRemaining,
    has_prior_subscription: hasPriorSubscription,
  };
}

export function extractRequestUser(req: Request): { user: AuthUser | null; viaCookie: boolean } {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const payload = verifyToken(token);
    if (payload && typeof payload.uid === 'number' && payload.type === 'session') {
      const user = loadUserById(payload.uid);
      if (user && !user.is_blocked) return { user, viaCookie: false };
    }
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.az_session) {
    const payload = verifyToken(cookies.az_session);
    if (payload && typeof payload.uid === 'number' && payload.type === 'session') {
      const user = loadUserById(payload.uid);
      if (user && !user.is_blocked) return { user, viaCookie: true };
    }
  }
  return { user: null, viaCookie: false };
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const { user } = extractRequestUser(req);
  if (user) req.user = user;
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const { user, viaCookie } = extractRequestUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  // CSRF check for cookie-authenticated mutations
  if (viaCookie && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
    const customHdr = req.headers['x-requested-with'];
    const origin = req.headers.origin;
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
    const originMatches =
      origin && host && (origin === `https://${host}` || origin === `http://${host}`);
    if (customHdr !== 'AZRental' && !originMatches) {
      res.status(403).json({ error: 'CSRF validation failed' });
      return;
    }
  }
  req.user = user;
  next();
}

export function requireRole(allowed: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const hasRole = req.user.roles.some((r) => allowed.includes(r)) || allowed.includes(req.user.active_role);
    if (!hasRole) {
      res.status(403).json({ error: 'Insufficient permissions for this action' });
      return;
    }
    next();
  };
}

export function requireActiveSubscription(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.user.subscription_active) {
    next();
    return;
  }
  const { amountEtb, durationDays } = getServiceFeeConfig();
  const needsRenewal = req.user.has_prior_subscription || req.user.subscription_status === 'expired';
  res.status(402).json({
    error: needsRenewal
      ? `Your 1-month AZ RENTAL service pass has expired. Pay ${amountEtb} ETB to renew and continue (no new registration needed).`
      : `A ${amountEtb} ETB registration fee is required to activate your 1-month AZ RENTAL service pass.`,
    code: 'SUBSCRIPTION_REQUIRED',
    needsRenewal,
    amountEtb,
    durationDays,
    subscriptionStatus: req.user.subscription_status,
  });
}

// Simple in-memory sliding window rate limiter
const rateBuckets = new Map<string, number[]>();

export function rateLimit(keyPrefix: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const entries = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (entries.length >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
      return;
    }
    entries.push(now);
    rateBuckets.set(key, entries);
    next();
  };
}

export function hashOtp(code: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(code).digest('hex');
}

export function hasSuperAdmin(): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) as c FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'approved'
       WHERE u.role = 'super_admin' OR ur.role_name = 'super_admin'`
    )
    .get() as any;
  return Number(row?.c || 0) > 0;
}

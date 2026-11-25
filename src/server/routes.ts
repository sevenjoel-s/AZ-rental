import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import {
  ADMIN_ROLES,
  AuthedRequest,
  clearAuthCookie,
  hasSuperAdmin,
  hashOtp,
  hashPassword,
  isValidPhoneOrEmail,
  loadUserById,
  optionalAuth,
  rateLimit,
  requireActiveSubscription,
  requireAuth,
  setAuthCookie,
  signToken,
  verifyPassword,
} from './auth.ts';
import { db, getServiceFeeConfig, writeAuditLog } from './db.ts';
import {
  CHAT_MEDIA_DIR,
  DOCS_DIR,
  processAndWatermarkImage,
  processAndWatermarkVideo,
  STORAGE_ROOT,
} from './media.ts';
import {
  getPaymentProviders,
  initiateEthiopianPayment,
  verifyGatewayPaymentByTxRef,
  verifyWebhookAndComplete,
} from './payments.ts';
import { createNotification, getOnlineUserIds, pushRealtimeToUser } from './realtime.ts';

const TEMP_DIR = path.join(STORAGE_ROOT, 'tmp');
fs.mkdirSync(TEMP_DIR, { recursive: true });

const uploadDisk = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
});

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
}

function hydrateListing(row: any, userId?: number, userLat?: number, userLng?: number) {
  if (!row) return null;
  const images = db
    .prepare(
      `SELECT id, watermarked_path, sort_order, is_watermarked, width, height
       FROM listing_images WHERE listing_id = ? ORDER BY sort_order ASC, id ASC`
    )
    .all(row.id)
    .map((img: any) => ({
      ...img,
      url: `/media/images/${path.basename(img.watermarked_path)}`,
    }));

  const videoRow = db
    .prepare(`SELECT id, watermarked_path, mime_type, size_bytes, is_watermarked, watermark_note FROM listing_videos WHERE listing_id = ?`)
    .get(row.id) as any;

  const owner = db
    .prepare(
      `SELECT u.id, u.full_name, u.city, u.account_type, u.email_verified, u.phone_verified,
              u.identity_verified, u.business_verified, u.verification_status,
              lp.business_name, lp.rating_avg, lp.review_count
       FROM users u
       LEFT JOIN landlord_profiles lp ON lp.user_id = u.id
       WHERE u.id = ?`
    )
    .get(row.owner_id) as any;

  const isFavorite = userId
    ? Boolean(db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND listing_id = ?').get(userId, row.id))
    : false;

  const distanceKm =
    typeof userLat === 'number' && typeof userLng === 'number' && !Number.isNaN(userLat) && !Number.isNaN(userLng)
      ? haversineKm(userLat, userLng, row.latitude, row.longitude)
      : null;

  let specs: Record<string, any> = {};
  try {
    specs = JSON.parse(row.specs_json || '{}');
  } catch {
    specs = {};
  }

  return {
    ...row,
    specs,
    images,
    video: videoRow
      ? {
          ...videoRow,
          url: `/media/videos/${path.basename(videoRow.watermarked_path)}`,
        }
      : null,
    owner,
    isFavorite,
    distanceKm,
  };
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  // ==================== HEALTH & METADATA ====================
  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'AZ RENTAL API', timestamp: new Date().toISOString() });
  });

  // ==================== AUTH & VERIFICATION ====================
  router.get('/auth/admin-bootstrap-status', (_req, res) => {
    res.json({
      hasSuperAdmin: hasSuperAdmin(),
      envPasscodeConfigured: Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.length > 0),
    });
  });

  router.post('/auth/admin-bootstrap', rateLimit('admin-boot', 10, 60_000), (req, res) => {
    const { fullName, email, password, passcode } = req.body || {};
    if (hasSuperAdmin()) {
      res.status(409).json({ error: 'Super Admin account is already claimed.' });
      return;
    }
    if (process.env.ADMIN_PASSCODE && passcode !== process.env.ADMIN_PASSCODE) {
      res.status(403).json({ error: 'Invalid admin setup passcode.' });
      return;
    }
    if (!fullName || !email || !password || String(password).length < 8) {
      res.status(400).json({ error: 'Full name, valid email, and password (min 8 chars) are required.' });
      return;
    }
    const parsed = isValidPhoneOrEmail(String(email));
    if (parsed.type !== 'email') {
      res.status(400).json({ error: 'Valid email is required for Super Admin.' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(parsed.normalized) as any;
    let adminId: number;
    const pwHash = hashPassword(String(password));

    db.transaction(() => {
      if (existing) {
        adminId = existing.id;
        db.prepare(
          `UPDATE users SET password_hash = ?, role = 'super_admin', active_role = 'super_admin',
           email_verified = 1, identity_verified = 1, verification_status = 'verified',
           subscription_status = 'exempt' WHERE id = ?`
        ).run(pwHash, adminId);
      } else {
        const ins = db
          .prepare(
            `INSERT INTO users (full_name, email, password_hash, role, active_role, city, email_verified, identity_verified, verification_status, terms_accepted, subscription_status)
             VALUES (?, ?, ?, 'super_admin', 'super_admin', 'Addis Ababa', 1, 1, 'verified', 1, 'exempt')`
          )
          .run(String(fullName).trim(), parsed.normalized, pwHash);
        adminId = Number(ins.lastInsertRowid);
      }
      db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role_name, status) VALUES (?, 'super_admin', 'approved')`).run(adminId!);
      db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role_name, status) VALUES (?, 'renter', 'approved')`).run(adminId!);
      db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role_name, status) VALUES (?, 'landlord', 'approved')`).run(adminId!);
    })();

    const user = loadUserById(adminId!);
    const token = signToken({ uid: user!.id, type: 'session' });
    setAuthCookie(res, token);
    writeAuditLog({ actorId: user!.id, actorRole: 'super_admin', action: 'admin.bootstrap_claimed', targetType: 'user', targetId: user!.id });
    res.json({ user, token });
  });

  router.post('/auth/register', rateLimit('register', 20, 60_000), (req, res) => {
    const {
      fullName,
      contact,
      password,
      confirmPassword,
      role,
      country,
      city,
      address,
      accountType,
      businessName,
      licenseNumber,
      termsAccepted,
    } = req.body || {};

    if (!fullName || !contact || !password) {
      res.status(400).json({ error: 'Full name, email or phone, and password are required.' });
      return;
    }
    if (String(password).length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' });
      return;
    }
    if (!termsAccepted) {
      res.status(400).json({ error: 'You must accept the AZ RENTAL terms and conditions.' });
      return;
    }

    const parsed = isValidPhoneOrEmail(String(contact));
    if (parsed.type === 'invalid') {
      res.status(400).json({ error: 'Enter a valid email address or Ethiopian/international phone number.' });
      return;
    }

    const chosenRole = role === 'landlord' ? 'landlord' : 'renter';
    const email = parsed.type === 'email' ? parsed.normalized : null;
    const phone = parsed.type === 'phone' ? parsed.normalized : null;

    if (email && db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    if (phone && db.prepare('SELECT id FROM users WHERE phone = ?').get(phone)) {
      res.status(409).json({ error: 'An account with this phone number already exists.' });
      return;
    }

    const pwHash = hashPassword(String(password));
    let newUserId = 0;

    db.transaction(() => {
      const ins = db
        .prepare(
          `INSERT INTO users (full_name, email, phone, password_hash, role, active_role, country, city, address, account_type, terms_accepted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          String(fullName).trim(),
          email,
          phone,
          pwHash,
          chosenRole,
          chosenRole,
          String(country || 'Ethiopia').trim(),
          String(city || 'Addis Ababa').trim(),
          String(address || '').trim(),
          accountType === 'business' ? 'business' : 'individual'
        );
      newUserId = Number(ins.lastInsertRowid);
      db.prepare(`INSERT INTO user_roles (user_id, role_name, status) VALUES (?, ?, 'approved')`).run(newUserId, chosenRole);

      if (chosenRole === 'renter') {
        db.prepare(`INSERT INTO renter_profiles (user_id, preferred_city) VALUES (?, ?)`).run(
          newUserId,
          String(city || 'Addis Ababa').trim()
        );
      } else {
        db.prepare(
          `INSERT INTO landlord_profiles (user_id, business_name, business_license_no) VALUES (?, ?, ?)`
        ).run(newUserId, String(businessName || '').trim(), String(licenseNumber || '').trim());
        if (businessName || licenseNumber) {
          db.prepare(
            `INSERT INTO verification_requests (user_id, request_type, business_name, license_number, notes, status)
             VALUES (?, ?, ?, ?, 'Submitted during landlord registration', 'pending')`
          ).run(
            newUserId,
            accountType === 'business' ? 'business' : 'identity',
            String(businessName || '').trim(),
            String(licenseNumber || '').trim()
          );
          db.prepare(`UPDATE users SET verification_status = 'pending' WHERE id = ?`).run(newUserId);
        }
      }
    })();

    const user = loadUserById(newUserId);
    const token = signToken({ uid: newUserId, type: 'session' });
    setAuthCookie(res, token);

    writeAuditLog({
      actorId: newUserId,
      actorRole: chosenRole,
      action: 'user.registered',
      targetType: 'user',
      targetId: newUserId,
    });

    const feeCfg = getServiceFeeConfig();
    res.status(201).json({
      user,
      token,
      verificationTarget: parsed.normalized,
      verificationChannel: parsed.type === 'email' ? 'email' : 'sms',
      requiresServicePassPayment: true,
      servicePassAmountEtb: feeCfg.amountEtb,
      servicePassDurationDays: feeCfg.durationDays,
    });
  });

  router.post('/auth/login', rateLimit('login', 20, 60_000), (req, res) => {
    const { contact, password } = req.body || {};
    if (!contact || !password) {
      res.status(400).json({ error: 'Email/phone and password are required.' });
      return;
    }

    const parsed = isValidPhoneOrEmail(String(contact));
    let row: any;
    if (parsed.type === 'email') {
      row = db.prepare('SELECT * FROM users WHERE email = ?').get(parsed.normalized);
    } else if (parsed.type === 'phone') {
      row = db.prepare('SELECT * FROM users WHERE phone = ?').get(parsed.normalized);
    }

    if (!row || !verifyPassword(String(password), row.password_hash)) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }
    if (row.is_blocked) {
      res.status(403).json({ error: 'This account has been suspended. Contact AZ RENTAL support.' });
      return;
    }

    const user = loadUserById(row.id);
    const token = signToken({ uid: row.id, type: 'session' });
    setAuthCookie(res, token);
    writeAuditLog({ actorId: row.id, actorRole: row.active_role, action: 'user.login', targetType: 'user', targetId: row.id });
    res.json({ user, token });
  });

  router.post('/auth/logout', (_req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  router.get('/auth/me', optionalAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
      res.json({ user: null });
      return;
    }
    const token = signToken({ uid: req.user.id, type: 'session' });
    res.json({ user: req.user, token });
  });

  router.post('/auth/ws-ticket', requireAuth, (req: AuthedRequest, res) => {
    const ticket = signToken({ uid: req.user!.id, type: 'ws' }, 120);
    res.json({ ticket });
  });

  // OTP Send & Verify (with expiration, resend restriction, rate limit, max attempts)
  router.post('/auth/otp/send', rateLimit('otp-send', 10, 60_000), (req, res) => {
    const { contact, purpose } = req.body || {};
    const parsed = isValidPhoneOrEmail(String(contact || ''));
    if (parsed.type === 'invalid') {
      res.status(400).json({ error: 'Provide a valid email or phone number.' });
      return;
    }
    const channel = parsed.type === 'email' ? 'email' : 'sms';
    const cleanPurpose = purpose === 'password_reset' ? 'password_reset' : 'verify';

    const recent = db
      .prepare(
        `SELECT * FROM otp_verifications
         WHERE target = ? AND purpose = ? AND verified_at IS NULL
         ORDER BY id DESC LIMIT 1`
      )
      .get(parsed.normalized, cleanPurpose) as any;

    if (recent && new Date(recent.resend_available_at).getTime() > Date.now()) {
      const waitSec = Math.ceil((new Date(recent.resend_available_at).getTime() - Date.now()) / 1000);
      res.status(429).json({ error: `Please wait ${waitSec}s before requesting another OTP.` });
      return;
    }

    const code = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const resendAt = new Date(Date.now() + 30_000).toISOString();

    db.prepare(
      `INSERT INTO otp_verifications (target, channel, code_hash, purpose, expires_at, resend_available_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(parsed.normalized, channel, hashOtp(code), cleanPurpose, expiresAt, resendAt);

    const hasLiveDelivery = Boolean(
      (channel === 'sms' && process.env.SMS_API_KEY) ||
        (channel === 'email' && process.env.SMTP_URL)
    );

    res.json({
      ok: true,
      channel,
      target: parsed.normalized,
      expiresAt,
      deliveryMode: hasLiveDelivery ? 'dispatched' : 'sandbox_preview',
      previewCode: !hasLiveDelivery && process.env.NODE_ENV !== 'production' ? code : undefined,
    });
  });

  router.post('/auth/otp/verify', rateLimit('otp-verify', 15, 60_000), (req, res) => {
    const { contact, code, purpose } = req.body || {};
    const parsed = isValidPhoneOrEmail(String(contact || ''));
    if (parsed.type === 'invalid' || !code) {
      res.status(400).json({ error: 'Valid contact and 6-digit OTP code are required.' });
      return;
    }
    const cleanPurpose = purpose === 'password_reset' ? 'password_reset' : 'verify';
    const record = db
      .prepare(
        `SELECT * FROM otp_verifications
         WHERE target = ? AND purpose = ? AND verified_at IS NULL
         ORDER BY id DESC LIMIT 1`
      )
      .get(parsed.normalized, cleanPurpose) as any;

    if (!record) {
      res.status(404).json({ error: 'No active verification code found. Request a new code.' });
      return;
    }
    if (new Date(record.expires_at).getTime() < Date.now()) {
      res.status(410).json({ error: 'Verification code has expired. Request a new code.' });
      return;
    }
    if (record.attempts >= record.max_attempts) {
      res.status(429).json({ error: 'Maximum verification attempts exceeded. Request a new code.' });
      return;
    }

    if (hashOtp(String(code).trim()) !== record.code_hash) {
      db.prepare('UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = ?').run(record.id);
      const remaining = record.max_attempts - (record.attempts + 1);
      res.status(400).json({ error: `Invalid OTP code. ${Math.max(0, remaining)} attempts remaining.` });
      return;
    }

    db.prepare(`UPDATE otp_verifications SET verified_at = datetime('now') WHERE id = ?`).run(record.id);

    if (cleanPurpose === 'verify') {
      if (parsed.type === 'email') {
        db.prepare('UPDATE users SET email_verified = 1 WHERE email = ?').run(parsed.normalized);
      } else {
        db.prepare('UPDATE users SET phone_verified = 1 WHERE phone = ?').run(parsed.normalized);
      }
    }

    const userRow =
      parsed.type === 'email'
        ? (db.prepare('SELECT id FROM users WHERE email = ?').get(parsed.normalized) as any)
        : (db.prepare('SELECT id FROM users WHERE phone = ?').get(parsed.normalized) as any);

    res.json({
      ok: true,
      verified: true,
      user: userRow ? loadUserById(userRow.id) : null,
    });
  });

  router.post('/auth/password-reset/confirm', rateLimit('pw-reset', 10, 60_000), (req, res) => {
    const { contact, code, newPassword } = req.body || {};
    const parsed = isValidPhoneOrEmail(String(contact || ''));
    if (parsed.type === 'invalid' || !code || !newPassword || String(newPassword).length < 8) {
      res.status(400).json({ error: 'Valid contact, OTP code, and new password (min 8 chars) are required.' });
      return;
    }

    const record = db
      .prepare(
        `SELECT * FROM otp_verifications
         WHERE target = ? AND purpose = 'password_reset' AND verified_at IS NULL
         ORDER BY id DESC LIMIT 1`
      )
      .get(parsed.normalized) as any;

    if (!record || new Date(record.expires_at).getTime() < Date.now() || record.attempts >= record.max_attempts) {
      res.status(400).json({ error: 'Invalid or expired reset code.' });
      return;
    }
    if (hashOtp(String(code).trim()) !== record.code_hash) {
      db.prepare('UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = ?').run(record.id);
      res.status(400).json({ error: 'Incorrect reset code.' });
      return;
    }

    const pwHash = hashPassword(String(newPassword));
    db.transaction(() => {
      db.prepare(`UPDATE otp_verifications SET verified_at = datetime('now') WHERE id = ?`).run(record.id);
      if (parsed.type === 'email') {
        db.prepare('UPDATE users SET password_hash = ?, email_verified = 1 WHERE email = ?').run(pwHash, parsed.normalized);
      } else {
        db.prepare('UPDATE users SET password_hash = ?, phone_verified = 1 WHERE phone = ?').run(pwHash, parsed.normalized);
      }
    })();

    res.json({ ok: true, message: 'Password updated successfully.' });
  });

  router.patch('/auth/profile', requireAuth, (req: AuthedRequest, res) => {
    const { fullName, city, address, language, theme, businessName, payoutAccount, notificationPrefs } = req.body || {};
    db.prepare(
      `UPDATE users SET
        full_name = COALESCE(?, full_name),
        city = COALESCE(?, city),
        address = COALESCE(?, address),
        language = COALESCE(?, language),
        theme = COALESCE(?, theme),
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      fullName ? String(fullName).trim() : null,
      city ? String(city).trim() : null,
      address !== undefined ? String(address).trim() : null,
      language || null,
      theme || null,
      req.user!.id
    );

    if (businessName !== undefined || payoutAccount !== undefined) {
      db.prepare(
        `INSERT INTO landlord_profiles (user_id, business_name, payout_account)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           business_name = COALESCE(excluded.business_name, landlord_profiles.business_name),
           payout_account = COALESCE(excluded.payout_account, landlord_profiles.payout_account)`
      ).run(req.user!.id, businessName ?? '', payoutAccount ?? '');
    }

    if (notificationPrefs) {
      db.prepare(
        `INSERT INTO renter_profiles (user_id, notification_prefs_json)
         VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET notification_prefs_json = excluded.notification_prefs_json`
      ).run(req.user!.id, JSON.stringify(notificationPrefs));
    }

    res.json({ user: loadUserById(req.user!.id) });
  });

  router.post('/auth/switch-role', requireAuth, (req: AuthedRequest, res) => {
    const { targetRole } = req.body || {};
    if (!['renter', 'landlord', 'super_admin', 'admin'].includes(targetRole)) {
      res.status(400).json({ error: 'Invalid role.' });
      return;
    }
    if (!req.user!.roles.includes(targetRole)) {
      res.status(403).json({ error: 'You do not hold this role yet. Submit a role access request first.' });
      return;
    }
    db.prepare(`UPDATE users SET active_role = ?, updated_at = datetime('now') WHERE id = ?`).run(
      targetRole,
      req.user!.id
    );
    res.json({ user: loadUserById(req.user!.id) });
  });

  router.post('/auth/request-role', requireAuth, (req: AuthedRequest, res) => {
    const { requestedRole, notes } = req.body || {};
    if (!['renter', 'landlord'].includes(requestedRole)) {
      res.status(400).json({ error: 'Can only request renter or landlord role.' });
      return;
    }
    if (req.user!.roles.includes(requestedRole)) {
      res.status(409).json({ error: 'You already have access to this role.' });
      return;
    }
    db.prepare(
      `INSERT INTO user_roles (user_id, role_name, status) VALUES (?, ?, 'pending')
       ON CONFLICT(user_id, role_name) DO UPDATE SET status = 'pending'`
    ).run(req.user!.id, requestedRole);

    if (requestedRole === 'landlord') {
      db.prepare(`INSERT OR IGNORE INTO landlord_profiles (user_id) VALUES (?)`).run(req.user!.id);
    } else {
      db.prepare(`INSERT OR IGNORE INTO renter_profiles (user_id) VALUES (?)`).run(req.user!.id);
    }

    writeAuditLog({
      actorId: req.user!.id,
      actorRole: req.user!.active_role,
      action: 'user.role_switch_requested',
      targetType: 'user',
      targetId: req.user!.id,
      details: { requestedRole, notes: notes || '' },
    });

    res.json({ ok: true, message: 'Role switch request submitted for administrator approval.' });
  });

  router.delete('/auth/account', requireAuth, (req: AuthedRequest, res) => {
    writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.active_role, action: 'user.deleted_self', targetType: 'user', targetId: req.user!.id });
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user!.id);
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  // ==================== PUBLIC TAXONOMY, LOCATIONS, BANNERS ====================
  router.get('/categories', (_req, res) => {
    const cats = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC').all() as any[];
    const subs = db.prepare('SELECT * FROM subcategories WHERE is_active = 1 ORDER BY sort_order ASC').all() as any[];
    const grouped = cats.map((c) => ({
      ...c,
      subcategories: subs.filter((s) => s.category_id === c.id),
    }));
    res.json({ categories: grouped });
  });

  router.get('/locations', (req, res) => {
    const q = String(req.query.q || '').trim();
    let rows: any[];
    if (q) {
      const like = `%${q}%`;
      rows = db
        .prepare(
          `SELECT * FROM locations WHERE is_active = 1
           AND (region LIKE ? OR city LIKE ? OR sub_city LIKE ? OR neighborhood LIKE ? OR woreda LIKE ?)
           ORDER BY is_regional_capital DESC, city ASC LIMIT 100`
        )
        .all(like, like, like, like, like);
    } else {
      rows = db
        .prepare('SELECT * FROM locations WHERE is_active = 1 ORDER BY is_regional_capital DESC, region ASC, city ASC')
        .all();
    }
    res.json({ locations: rows });
  });

  router.get('/banners', (_req, res) => {
    const banners = db.prepare('SELECT * FROM banners WHERE is_active = 1 ORDER BY sort_order ASC').all();
    res.json({ banners });
  });

  router.get('/translations', (req, res) => {
    const lang = String(req.query.lang || '');
    const rows = lang
      ? db.prepare('SELECT * FROM translations WHERE lang_code = ?').all(lang)
      : db.prepare('SELECT * FROM translations').all();
    res.json({ translations: rows });
  });

  // ==================== LISTINGS & ADVANCED SEARCH ====================
  router.get('/listings/suggestions', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) {
      res.json({ suggestions: [] });
      return;
    }
    const like = `%${q}%`;
    const titles = db
      .prepare(`SELECT DISTINCT title as label, 'listing' as kind FROM listings WHERE status = 'approved' AND (title LIKE ? OR title_am LIKE ?) LIMIT 5`)
      .all(like, like);
    const locs = db
      .prepare(`SELECT DISTINCT city || CASE WHEN neighborhood != '' THEN ' · ' || neighborhood ELSE '' END as label, 'location' as kind FROM locations WHERE is_active = 1 AND (city LIKE ? OR neighborhood LIKE ? OR sub_city LIKE ?) LIMIT 5`)
      .all(like, like, like);
    res.json({ suggestions: [...titles, ...locs] });
  });

  router.get('/listings', optionalAuth, (req: AuthedRequest, res) => {
    const {
      q,
      category,
      subcategory,
      city,
      subCity,
      neighborhood,
      minPrice,
      maxPrice,
      duration,
      startDate,
      endDate,
      verifiedOnly,
      availability,
      sort = 'newest',
      lat,
      lng,
      radiusKm,
      ownerId,
      page = '1',
      limit = '12',
    } = req.query as Record<string, string>;

    const where: string[] = [];
    const params: any[] = [];

    if (ownerId) {
      where.push('l.owner_id = ?');
      params.push(Number(ownerId));
      if (!req.user || (req.user.id !== Number(ownerId) && !req.user.roles.some((r) => ADMIN_ROLES.has(r)))) {
        where.push(`l.status = 'approved'`);
      }
    } else {
      where.push(`l.status = 'approved'`);
    }

    if (availability) {
      where.push('l.availability_status = ?');
      params.push(availability);
    }

    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      where.push(
        '(l.title LIKE ? OR l.title_am LIKE ? OR l.description LIKE ? OR l.city LIKE ? OR l.sub_city LIKE ? OR l.neighborhood LIKE ?)'
      );
      params.push(like, like, like, like, like, like);
    }

    if (category) {
      if (/^\d+$/.test(category)) {
        where.push('l.category_id = ?');
        params.push(Number(category));
      } else {
        where.push('c.slug = ?');
        params.push(category);
      }
    }

    if (subcategory) {
      if (/^\d+$/.test(subcategory)) {
        where.push('l.subcategory_id = ?');
        params.push(Number(subcategory));
      } else {
        where.push('sc.slug = ?');
        params.push(subcategory);
      }
    }

    if (city) {
      where.push('LOWER(l.city) LIKE LOWER(?)');
      params.push(`%${city.trim()}%`);
    }
    if (subCity) {
      where.push('LOWER(l.sub_city) LIKE LOWER(?)');
      params.push(`%${subCity.trim()}%`);
    }
    if (neighborhood) {
      where.push('LOWER(l.neighborhood) LIKE LOWER(?)');
      params.push(`%${neighborhood.trim()}%`);
    }

    const priceField =
      duration === 'weekly'
        ? 'COALESCE(l.price_weekly, l.price_daily * 7, l.price_monthly / 4)'
        : duration === 'monthly'
        ? 'COALESCE(l.price_monthly, l.price_daily * 30, l.price_weekly * 4)'
        : duration === 'hourly'
        ? 'COALESCE(l.price_hourly, l.price_daily / 8)'
        : 'COALESCE(l.price_daily, l.price_monthly / 30, l.price_weekly / 7, l.price_hourly * 8)';

    if (minPrice && !Number.isNaN(Number(minPrice))) {
      where.push(`${priceField} >= ?`);
      params.push(Number(minPrice));
    }
    if (maxPrice && !Number.isNaN(Number(maxPrice))) {
      where.push(`${priceField} <= ?`);
      params.push(Number(maxPrice));
    }

    if (verifiedOnly === 'true' || verifiedOnly === '1') {
      where.push('(l.is_verified = 1 OR u.identity_verified = 1 OR u.business_verified = 1)');
    }

    // Real availability check against active/confirmed/paid bookings
    if (startDate && endDate) {
      where.push(`NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.listing_id = l.id
          AND b.status IN ('Accepted', 'Awaiting Payment', 'Paid', 'Confirmed', 'Active')
          AND b.start_date <= ? AND b.end_date >= ?
      )`);
      params.push(endDate, startDate);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `
      SELECT l.*,
             c.slug as category_slug, c.name_en as category_name_en, c.name_am as category_name_am,
             sc.slug as subcategory_slug, sc.name_en as subcategory_name_en, sc.name_am as subcategory_name_am,
             ${priceField} as effective_price
      FROM listings l
      JOIN categories c ON c.id = l.category_id
      LEFT JOIN subcategories sc ON sc.id = l.subcategory_id
      JOIN users u ON u.id = l.owner_id
      ${whereSql}
    `;

    const rawRows = db.prepare(sql).all(...params) as any[];
    const userLat = lat ? Number(lat) : undefined;
    const userLng = lng ? Number(lng) : undefined;

    let hydrated = rawRows.map((r) => hydrateListing(r, req.user?.id, userLat, userLng)!);

    if (radiusKm && userLat !== undefined && userLng !== undefined && !Number.isNaN(Number(radiusKm))) {
      const maxDist = Number(radiusKm);
      hydrated = hydrated.filter((item) => item.distanceKm !== null && item.distanceKm <= maxDist);
    }

    if (sort === 'lowest_price') {
      hydrated.sort((a, b) => (a.effective_price || 0) - (b.effective_price || 0));
    } else if (sort === 'highest_price') {
      hydrated.sort((a, b) => (b.effective_price || 0) - (a.effective_price || 0));
    } else if (sort === 'nearest' && userLat !== undefined && userLng !== undefined) {
      hydrated.sort((a, b) => (a.distanceKm ?? 99999) - (b.distanceKm ?? 99999));
    } else if (sort === 'popular') {
      hydrated.sort((a, b) => b.views_count - a.views_count);
    } else if (sort === 'verified') {
      hydrated.sort((a, b) => (b.owner?.identity_verified || 0) - (a.owner?.identity_verified || 0));
    } else {
      hydrated.sort((a, b) => b.id - a.id);
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(50, Math.max(1, Number(limit) || 12));
    const total = hydrated.length;
    const paged = hydrated.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({
      listings: paged,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
      },
    });
  });

  router.get('/listings/:id', optionalAuth, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const row = db
      .prepare(
        `SELECT l.*,
                c.slug as category_slug, c.name_en as category_name_en, c.name_am as category_name_am,
                sc.slug as subcategory_slug, sc.name_en as subcategory_name_en, sc.name_am as subcategory_name_am
         FROM listings l
         JOIN categories c ON c.id = l.category_id
         LEFT JOIN subcategories sc ON sc.id = l.subcategory_id
         WHERE l.id = ?`
      )
      .get(id) as any;

    if (!row) {
      res.status(404).json({ error: 'Listing not found.' });
      return;
    }

    const isOwnerOrAdmin =
      req.user && (req.user.id === row.owner_id || req.user.roles.some((r) => ADMIN_ROLES.has(r)));
    if (row.status !== 'approved' && !isOwnerOrAdmin) {
      res.status(403).json({ error: 'Listing is pending moderation approval.' });
      return;
    }

    db.prepare('UPDATE listings SET views_count = views_count + 1 WHERE id = ?').run(id);
    if (req.user) {
      db.prepare(
        `INSERT INTO recently_viewed (user_id, listing_id, viewed_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(user_id, listing_id) DO UPDATE SET viewed_at = datetime('now')`
      ).run(req.user.id, id);
    }

    const bookedDates = db
      .prepare(
        `SELECT start_date, end_date, status FROM bookings
         WHERE listing_id = ? AND status IN ('Accepted', 'Awaiting Payment', 'Paid', 'Confirmed', 'Active')`
      )
      .all(id);

    const reviews = db
      .prepare(
        `SELECT r.*, u.full_name as reviewer_name
         FROM reviews r JOIN users u ON u.id = r.reviewer_id
         WHERE r.listing_id = ? ORDER BY r.id DESC`
      )
      .all(id);

    const lat = req.query.lat ? Number(req.query.lat) : undefined;
    const lng = req.query.lng ? Number(req.query.lng) : undefined;
    res.json({
      listing: hydrateListing({ ...row, views_count: row.views_count + 1 }, req.user?.id, lat, lng),
      bookedDates,
      reviews,
    });
  });

  // Create listing with 1-10 watermarked images and max 1 watermarked video
  router.post(
    '/listings',
    requireAuth,
    requireActiveSubscription,
    uploadDisk.fields([
      { name: 'images', maxCount: 15 },
      { name: 'video', maxCount: 3 },
    ]),
    async (req: AuthedRequest, res) => {
      const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
      const imageFiles = files.images || [];
      const videoFiles = files.video || [];

      const cleanupTemp = () => {
        for (const f of [...imageFiles, ...videoFiles]) {
          if (f?.path && fs.existsSync(f.path)) {
            try {
              fs.unlinkSync(f.path);
            } catch {
              // ignore
            }
          }
        }
      };

      if (!req.user!.roles.includes('landlord') && !req.user!.roles.some((r) => ADMIN_ROLES.has(r))) {
        cleanupTemp();
        res.status(403).json({ error: 'Only landlord or administrator accounts can publish rental listings.' });
        return;
      }

      if (imageFiles.length < 1) {
        cleanupTemp();
        res.status(400).json({ error: 'Minimum 1 listing image is required.' });
        return;
      }
      if (imageFiles.length > 10) {
        cleanupTemp();
        res.status(400).json({ error: 'Maximum 10 images allowed per listing.' });
        return;
      }
      if (videoFiles.length > 1) {
        cleanupTemp();
        res.status(400).json({ error: 'Maximum 1 video allowed per listing.' });
        return;
      }

      for (const img of imageFiles) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(img.mimetype)) {
          cleanupTemp();
          res.status(400).json({ error: `Unsupported image format: ${img.originalname}` });
          return;
        }
      }
      if (videoFiles[0]) {
        const vid = videoFiles[0];
        if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(vid.mimetype)) {
          cleanupTemp();
          res.status(400).json({ error: 'Video must be MP4, WebM, or MOV format.' });
          return;
        }
      }

      const {
        title,
        titleAm,
        categoryId,
        subcategoryId,
        description,
        descriptionAm,
        priceHourly,
        priceDaily,
        priceWeekly,
        priceMonthly,
        primaryDuration,
        region,
        city,
        subCity,
        neighborhood,
        addressDetail,
        latitude,
        longitude,
        exactLocationVisible,
        rentalConditions,
        contactPreference,
        specs,
      } = req.body || {};

      if (!title || !categoryId || !description || !city) {
        cleanupTemp();
        res.status(400).json({ error: 'Title, category, description, and city are required.' });
        return;
      }

      const dupHash = crypto
        .createHash('sha256')
        .update(`${req.user!.id}:${String(title).trim().toLowerCase()}:${String(city).trim().toLowerCase()}`)
        .digest('hex');

      const existingDup = db
        .prepare(`SELECT id FROM listings WHERE duplicate_hash = ? AND status != 'rejected'`)
        .get(dupHash) as any;
      if (existingDup) {
        cleanupTemp();
        res.status(409).json({ error: 'Duplicate listing detected with the same title and city.' });
        return;
      }

      try {
        const processedImages: Awaited<ReturnType<typeof processAndWatermarkImage>>[] = [];
        for (const img of imageFiles) {
          const buf = fs.readFileSync(img.path);
          fs.unlinkSync(img.path);
          const wm = await processAndWatermarkImage(buf, path.extname(img.originalname));
          processedImages.push(wm);
        }

        let processedVideo = null;
        if (videoFiles[0]) {
          const vid = videoFiles[0];
          processedVideo = await processAndWatermarkVideo(
            vid.path,
            path.extname(vid.originalname),
            vid.mimetype,
            vid.size
          );
        }

        const isTrustedOwner =
          req.user!.identity_verified === 1 ||
          req.user!.business_verified === 1 ||
          req.user!.roles.some((r) => ADMIN_ROLES.has(r));

        const initialStatus = isTrustedOwner ? 'approved' : 'pending';
        const verifiedFlag = isTrustedOwner ? 1 : 0;

        let parsedSpecs = '{}';
        if (specs) {
          parsedSpecs = typeof specs === 'string' ? specs : JSON.stringify(specs);
        }

        const listingId = db.transaction(() => {
          const ins = db
            .prepare(
              `INSERT INTO listings (
                owner_id, category_id, subcategory_id, title, title_am, description, description_am,
                price_hourly, price_daily, price_weekly, price_monthly, primary_duration,
                region, city, sub_city, neighborhood, address_detail, latitude, longitude,
                exact_location_visible, rental_conditions, contact_preference, specs_json,
                status, is_verified, duplicate_hash
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              req.user!.id,
              Number(categoryId),
              subcategoryId ? Number(subcategoryId) : null,
              String(title).trim(),
              String(titleAm || '').trim(),
              String(description).trim(),
              String(descriptionAm || '').trim(),
              priceHourly ? Number(priceHourly) : null,
              priceDaily ? Number(priceDaily) : null,
              priceWeekly ? Number(priceWeekly) : null,
              priceMonthly ? Number(priceMonthly) : null,
              String(primaryDuration || 'monthly'),
              String(region || 'Addis Ababa').trim(),
              String(city).trim(),
              String(subCity || '').trim(),
              String(neighborhood || '').trim(),
              String(addressDetail || '').trim(),
              latitude ? Number(latitude) : 9.0054,
              longitude ? Number(longitude) : 38.7636,
              exactLocationVisible === 'false' || exactLocationVisible === false ? 0 : 1,
              String(rentalConditions || '').trim(),
              String(contactPreference || 'chat_call'),
              parsedSpecs,
              initialStatus,
              verifiedFlag,
              dupHash
            );
          const id = Number(ins.lastInsertRowid);

          const imgStmt = db.prepare(
            `INSERT INTO listing_images (listing_id, original_path, watermarked_path, sort_order, is_watermarked, width, height)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          );
          processedImages.forEach((im, idx) => {
            imgStmt.run(id, im.originalPath, im.watermarkedPath, idx, im.isWatermarked ? 1 : 0, im.width, im.height);
          });

          if (processedVideo) {
            db.prepare(
              `INSERT INTO listing_videos (listing_id, original_path, watermarked_path, mime_type, size_bytes, is_watermarked, watermark_note)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).run(
              id,
              processedVideo.originalPath,
              processedVideo.watermarkedPath,
              videoFiles[0].mimetype,
              videoFiles[0].size,
              processedVideo.isWatermarked ? 1 : 0,
              processedVideo.watermarkNote
            );
          }

          return id;
        })();

        writeAuditLog({
          actorId: req.user!.id,
          actorRole: req.user!.active_role,
          action: 'listing.created',
          targetType: 'listing',
          targetId: listingId,
          details: { status: initialStatus, imageCount: processedImages.length, hasVideo: Boolean(processedVideo) },
        });

        const row = db
          .prepare(
            `SELECT l.*, c.slug as category_slug, c.name_en as category_name_en, c.name_am as category_name_am
             FROM listings l JOIN categories c ON c.id = l.category_id WHERE l.id = ?`
          )
          .get(listingId);

        res.status(201).json({ listing: hydrateListing(row, req.user!.id) });
      } catch (err: any) {
        cleanupTemp();
        res.status(500).json({ error: err?.message || 'Failed to process listing media.' });
      }
    }
  );

  router.patch('/listings/:id', requireAuth, requireActiveSubscription, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Listing not found.' });
      return;
    }
    const isAdmin = req.user!.roles.some((r) => ADMIN_ROLES.has(r));
    if (existing.owner_id !== req.user!.id && !isAdmin) {
      res.status(403).json({ error: 'Not authorized to edit this listing.' });
      return;
    }

    const {
      title,
      description,
      priceDaily,
      priceWeekly,
      priceMonthly,
      priceHourly,
      availabilityStatus,
      rentalConditions,
      city,
      subCity,
      neighborhood,
      imageOrderIds,
    } = req.body || {};

    db.prepare(
      `UPDATE listings SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        price_daily = COALESCE(?, price_daily),
        price_weekly = COALESCE(?, price_weekly),
        price_monthly = COALESCE(?, price_monthly),
        price_hourly = COALESCE(?, price_hourly),
        availability_status = COALESCE(?, availability_status),
        rental_conditions = COALESCE(?, rental_conditions),
        city = COALESCE(?, city),
        sub_city = COALESCE(?, sub_city),
        neighborhood = COALESCE(?, neighborhood),
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      title || null,
      description || null,
      priceDaily !== undefined ? Number(priceDaily) : null,
      priceWeekly !== undefined ? Number(priceWeekly) : null,
      priceMonthly !== undefined ? Number(priceMonthly) : null,
      priceHourly !== undefined ? Number(priceHourly) : null,
      availabilityStatus || null,
      rentalConditions !== undefined ? rentalConditions : null,
      city || null,
      subCity !== undefined ? subCity : null,
      neighborhood !== undefined ? neighborhood : null,
      id
    );

    if (Array.isArray(imageOrderIds)) {
      const updImg = db.prepare('UPDATE listing_images SET sort_order = ? WHERE id = ? AND listing_id = ?');
      imageOrderIds.forEach((imgId: number, idx: number) => updImg.run(idx, imgId, id));
    }

    const updated = db
      .prepare(
        `SELECT l.*, c.slug as category_slug, c.name_en as category_name_en, c.name_am as category_name_am
         FROM listings l JOIN categories c ON c.id = l.category_id WHERE l.id = ?`
      )
      .get(id);
    res.json({ listing: hydrateListing(updated, req.user!.id) });
  });

  router.delete('/listings/:id', requireAuth, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Listing not found.' });
      return;
    }
    const isAdmin = req.user!.roles.some((r) => ADMIN_ROLES.has(r));
    if (existing.owner_id !== req.user!.id && !isAdmin) {
      res.status(403).json({ error: 'Not authorized to delete this listing.' });
      return;
    }
    db.prepare('DELETE FROM listings WHERE id = ?').run(id);
    writeAuditLog({
      actorId: req.user!.id,
      actorRole: req.user!.active_role,
      action: 'listing.deleted',
      targetType: 'listing',
      targetId: id,
    });
    res.json({ ok: true });
  });

  // ==================== FAVORITES, SAVED SEARCHES, RECENTLY VIEWED ====================
  router.get('/favorites', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT l.*, c.slug as category_slug, c.name_en as category_name_en, c.name_am as category_name_am
         FROM favorites f
         JOIN listings l ON l.id = f.listing_id
         JOIN categories c ON c.id = l.category_id
         WHERE f.user_id = ? ORDER BY f.created_at DESC`
      )
      .all(req.user!.id) as any[];
    res.json({ favorites: rows.map((r) => hydrateListing(r, req.user!.id)) });
  });

  router.post('/favorites/:listingId', requireAuth, (req: AuthedRequest, res) => {
    const listingId = Number(req.params.listingId);
    db.prepare(`INSERT OR IGNORE INTO favorites (user_id, listing_id) VALUES (?, ?)`).run(req.user!.id, listingId);
    res.json({ ok: true, isFavorite: true });
  });

  router.delete('/favorites/:listingId', requireAuth, (req: AuthedRequest, res) => {
    const listingId = Number(req.params.listingId);
    db.prepare(`DELETE FROM favorites WHERE user_id = ? AND listing_id = ?`).run(req.user!.id, listingId);
    res.json({ ok: true, isFavorite: false });
  });

  router.get('/saved-searches', requireAuth, (req: AuthedRequest, res) => {
    const rows = db.prepare('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY id DESC').all(req.user!.id);
    res.json({ savedSearches: rows });
  });

  router.post('/saved-searches', requireAuth, (req: AuthedRequest, res) => {
    const { name, filters, alertEnabled } = req.body || {};
    if (!name || !filters) {
      res.status(400).json({ error: 'Search name and filters are required.' });
      return;
    }
    const ins = db
      .prepare('INSERT INTO saved_searches (user_id, name, filters_json, alert_enabled) VALUES (?, ?, ?, ?)')
      .run(req.user!.id, String(name).trim(), JSON.stringify(filters), alertEnabled === false ? 0 : 1);
    res.status(201).json({ id: Number(ins.lastInsertRowid) });
  });

  router.delete('/saved-searches/:id', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('DELETE FROM saved_searches WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user!.id);
    res.json({ ok: true });
  });

  // ==================== BOOKINGS, AGREEMENTS & RECEIPTS ====================
  router.get('/bookings', requireAuth, (req: AuthedRequest, res) => {
    const roleFilter = String(req.query.role || '');
    let rows: any[];
    if (roleFilter === 'landlord') {
      rows = db
        .prepare(
          `SELECT b.*, l.title as listing_title, l.city as listing_city,
                  u.full_name as renter_name, u.phone as renter_phone,
                  o.full_name as owner_name
           FROM bookings b
           JOIN listings l ON l.id = b.listing_id
           JOIN users u ON u.id = b.renter_id
           JOIN users o ON o.id = b.owner_id
           WHERE b.owner_id = ? ORDER BY b.id DESC`
        )
        .all(req.user!.id);
    } else {
      rows = db
        .prepare(
          `SELECT b.*, l.title as listing_title, l.city as listing_city,
                  u.full_name as renter_name,
                  o.full_name as owner_name, o.phone as owner_phone
           FROM bookings b
           JOIN listings l ON l.id = b.listing_id
           JOIN users u ON u.id = b.renter_id
           JOIN users o ON o.id = b.owner_id
           WHERE b.renter_id = ? ORDER BY b.id DESC`
        )
        .all(req.user!.id);
    }
    res.json({ bookings: rows });
  });

  router.post('/bookings', requireAuth, requireActiveSubscription, (req: AuthedRequest, res) => {
    const { listingId, startDate, endDate, durationType, requestType, viewingRequestedAt, notes } = req.body || {};
    if (!listingId || !startDate || !endDate) {
      res.status(400).json({ error: 'Listing, start date, and end date are required.' });
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      res.status(400).json({ error: 'End date must be on or after start date.' });
      return;
    }

    const listing = db.prepare(`SELECT * FROM listings WHERE id = ? AND status = 'approved'`).get(Number(listingId)) as any;
    if (!listing) {
      res.status(404).json({ error: 'Listing not available.' });
      return;
    }
    if (listing.owner_id === req.user!.id) {
      res.status(400).json({ error: 'You cannot book your own listing.' });
      return;
    }

    const cleanReqType = requestType === 'viewing' ? 'viewing' : 'rental';

    // Prevent double booking for rental requests
    if (cleanReqType === 'rental') {
      const conflict = db
        .prepare(
          `SELECT id FROM bookings
           WHERE listing_id = ?
             AND request_type = 'rental'
             AND status IN ('Accepted', 'Awaiting Payment', 'Paid', 'Confirmed', 'Active')
             AND start_date <= ? AND end_date >= ?`
        )
        .get(listing.id, endDate, startDate) as any;

      if (conflict) {
        res.status(409).json({
          error: 'These dates overlap with an existing confirmed booking. Please choose different dates.',
        });
        return;
      }
    }

    const msDay = 86_400_000;
    const days = Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / msDay) + 1);
    const dType = durationType || listing.primary_duration || 'daily';
    let units = days;
    let unitRate = listing.price_daily || Math.round((listing.price_monthly || 10000) / 30);

    if (dType === 'weekly') {
      units = Math.max(1, Math.ceil(days / 7));
      unitRate = listing.price_weekly || unitRate * 7;
    } else if (dType === 'monthly') {
      units = Math.max(1, Math.ceil(days / 30));
      unitRate = listing.price_monthly || unitRate * 30;
    } else if (dType === 'hourly') {
      units = Math.max(1, days);
      unitRate = listing.price_hourly || Math.round(unitRate / 8);
    }

    const feeRow = db.prepare(`SELECT value_json FROM system_settings WHERE key = 'platform_fee_percent'`).get() as any;
    const feePct = feeRow ? Number(JSON.parse(feeRow.value_json)) : 3.5;
    const baseAmount = cleanReqType === 'viewing' ? 0 : Math.round(units * unitRate);
    const serviceFee = cleanReqType === 'viewing' ? 0 : Math.round((baseAmount * feePct) / 100);
    const totalAmount = baseAmount + serviceFee;

    const bookingId = db.transaction(() => {
      const ins = db
        .prepare(
          `INSERT INTO bookings (
            listing_id, renter_id, owner_id, request_type, start_date, end_date,
            duration_type, units, base_amount, service_fee, deposit_amount, total_amount,
            status, rental_conditions, viewing_requested_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'Pending', ?, ?)`
        )
        .run(
          listing.id,
          req.user!.id,
          listing.owner_id,
          cleanReqType,
          startDate,
          endDate,
          dType,
          units,
          baseAmount,
          serviceFee,
          totalAmount,
          String(notes || listing.rental_conditions || ''),
          String(viewingRequestedAt || '')
        );
      const bId = Number(ins.lastInsertRowid);

      const agrNo = `AZR-AGR-${new Date().getFullYear()}-${String(bId).padStart(5, '0')}`;
      const termsEn = `AZ RENTAL DIRECT RENTAL AGREEMENT (${agrNo})\nListing: ${listing.title} (${listing.city})\nDates: ${startDate} to ${endDate}\nTotal Agreed Rent & Fee: ETB ${totalAmount.toLocaleString()}\nConditions: ${listing.rental_conditions || 'Standard Ethiopian Civil Code lease & asset care terms apply.'}\nSafety Notice: Verify property/item condition in person before making payment.`;
      const termsAm = `የ AZ RENTAL ቀጥታ የኪራይ ውል (${agrNo})\nንብረት: ${listing.title_am || listing.title}\nጊዜ: ከ ${startDate} እስከ ${endDate}\nጠቅላላ ክፍያ: ${totalAmount.toLocaleString()} ብር\nሁኔታዎች: ${listing.rental_conditions || 'በውሉ መሠረት ንብረቱን በጥንቃቄ መጠበቅና በወቅቱ መመለስ።'}`;

      db.prepare(
        `INSERT INTO rental_agreements (booking_id, agreement_number, terms_en, terms_am)
         VALUES (?, ?, ?, ?)`
      ).run(bId, agrNo, termsEn, termsAm);

      return bId;
    })();

    createNotification({
      userId: listing.owner_id,
      type: 'rental_request',
      title: cleanReqType === 'viewing' ? 'New Viewing Request' : 'New Rental Booking Request',
      body: `${req.user!.full_name} requested "${listing.title}" (${startDate} – ${endDate}).`,
      titleAm: cleanReqType === 'viewing' ? 'አዲስ የንብረት እይታ ጥያቄ' : 'አዲስ የኪራይ ጥያቄ',
      bodyAm: `${req.user!.full_name} ለ "${listing.title_am || listing.title}" ጥያቄ ልከዋል።`,
      link: '/dashboard',
    });

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    res.status(201).json({ booking });
  });

  router.patch('/bookings/:id/respond', requireAuth, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { decision, conditions } = req.body || {};
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as any;
    if (!booking) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }
    if (booking.owner_id !== req.user!.id && !req.user!.roles.some((r) => ADMIN_ROLES.has(r))) {
      res.status(403).json({ error: 'Only the owner can approve or reject this request.' });
      return;
    }

    if (decision === 'accept') {
      // Double-booking re-check on acceptance
      if (booking.request_type === 'rental') {
        const conflict = db
          .prepare(
            `SELECT id FROM bookings
             WHERE listing_id = ? AND id != ?
               AND request_type = 'rental'
               AND status IN ('Accepted', 'Awaiting Payment', 'Paid', 'Confirmed', 'Active')
               AND start_date <= ? AND end_date >= ?`
          )
          .get(booking.listing_id, id, booking.end_date, booking.start_date) as any;
        if (conflict) {
          res.status(409).json({ error: 'Another accepted booking already occupies these dates.' });
          return;
        }
      }

      const nextStatus = booking.request_type === 'viewing' ? 'Confirmed' : 'Awaiting Payment';
      db.prepare(
        `UPDATE bookings SET status = ?, rental_conditions = COALESCE(?, rental_conditions), updated_at = datetime('now') WHERE id = ?`
      ).run(nextStatus, conditions || null, id);

      createNotification({
        userId: booking.renter_id,
        type: 'booking_confirmation',
        title: 'Booking Request Accepted',
        body: `Your request #${id} was accepted. Review and sign the agreement to proceed.`,
        titleAm: 'የኪራይ ጥያቄዎ ተቀባይነት አግኝቷል',
        bodyAm: `ጥያቄ #${id} ተቀባይነት አግኝቷል። ውሉን ይፈርሙ።`,
        link: '/dashboard',
      });
    } else if (decision === 'reject') {
      db.prepare(`UPDATE bookings SET status = 'Rejected', updated_at = datetime('now') WHERE id = ?`).run(id);
      createNotification({
        userId: booking.renter_id,
        type: 'booking_rejection',
        title: 'Booking Request Declined',
        body: `Your request #${id} was declined by the owner.`,
        titleAm: 'የኪራይ ጥያቄዎ ውድቅ ተደርጓል',
        bodyAm: `ጥያቄ #${id} በአከራዩ አልተቀበለም።`,
        link: '/dashboard',
      });
    } else if (decision === 'complete') {
      db.prepare(`UPDATE bookings SET status = 'Completed', updated_at = datetime('now') WHERE id = ?`).run(id);
    } else {
      res.status(400).json({ error: 'Invalid decision.' });
      return;
    }

    res.json({ booking: db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) });
  });

  router.patch('/bookings/:id/sign', requireAuth, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { signatureName } = req.body || {};
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as any;
    if (!booking) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }
    const sig = String(signatureName || req.user!.full_name).trim();
    if (booking.renter_id === req.user!.id) {
      db.prepare(`UPDATE bookings SET agreement_signed_by_renter = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
      db.prepare(`UPDATE rental_agreements SET renter_signature = ?, signed_at = datetime('now') WHERE booking_id = ?`).run(sig, id);
    } else if (booking.owner_id === req.user!.id) {
      db.prepare(`UPDATE bookings SET agreement_signed_by_owner = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
      db.prepare(`UPDATE rental_agreements SET owner_signature = ?, signed_at = datetime('now') WHERE booking_id = ?`).run(sig, id);
    } else {
      res.status(403).json({ error: 'Not a party to this agreement.' });
      return;
    }

    res.json({
      booking: db.prepare('SELECT * FROM bookings WHERE id = ?').get(id),
      agreement: db.prepare('SELECT * FROM rental_agreements WHERE booking_id = ?').get(id),
    });
  });

  router.patch('/bookings/:id/cancel', requireAuth, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as any;
    if (!booking) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }
    if (booking.renter_id !== req.user!.id && booking.owner_id !== req.user!.id && !req.user!.roles.some((r) => ADMIN_ROLES.has(r))) {
      res.status(403).json({ error: 'Not authorized.' });
      return;
    }
    if (['Completed', 'Active'].includes(booking.status)) {
      res.status(400).json({ error: 'Active or completed bookings cannot be cancelled directly.' });
      return;
    }
    db.prepare(`UPDATE bookings SET status = 'Cancelled', cancellation_reason = ?, updated_at = datetime('now') WHERE id = ?`).run(
      String(req.body?.reason || 'Cancelled by user'),
      id
    );
    res.json({ booking: db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) });
  });

  router.get('/bookings/:id/agreement', requireAuth, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as any;
    if (!booking) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }
    if (booking.renter_id !== req.user!.id && booking.owner_id !== req.user!.id && !req.user!.roles.some((r) => ADMIN_ROLES.has(r))) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    const agreement = db.prepare('SELECT * FROM rental_agreements WHERE booking_id = ?').get(id);
    res.json({ booking, agreement });
  });

  router.get('/bookings/:id/receipt', requireAuth, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const booking = db
      .prepare(
        `SELECT b.*, l.title as listing_title, l.city as listing_city,
                r.full_name as renter_name, o.full_name as owner_name
         FROM bookings b
         JOIN listings l ON l.id = b.listing_id
         JOIN users r ON r.id = b.renter_id
         JOIN users o ON o.id = b.owner_id
         WHERE b.id = ?`
      )
      .get(id) as any;
    if (!booking) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }
    if (booking.renter_id !== req.user!.id && booking.owner_id !== req.user!.id && !req.user!.roles.some((r) => ADMIN_ROLES.has(r))) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    const payments = db.prepare('SELECT * FROM payments WHERE booking_id = ? ORDER BY id DESC').all(id);
    const agreement = db.prepare('SELECT * FROM rental_agreements WHERE booking_id = ?').get(id);
    res.json({ booking, payments, agreement });
  });

  // ==================== 50 ETB MONTHLY SERVICE PASS ====================
  router.get('/subscription/config', (_req, res) => {
    const config = getServiceFeeConfig();
    res.json({ ...config, config });
  });

  router.get('/subscription/status', requireAuth, (req: AuthedRequest, res) => {
    const config = getServiceFeeConfig();
    const subscriptions = db
      .prepare(`SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 20`)
      .all(req.user!.id);
    const pendingPayments = db
      .prepare(
        `SELECT * FROM payments
         WHERE user_id = ? AND purpose IN ('registration_fee', 'monthly_service_renewal')
         ORDER BY id DESC LIMIT 15`
      )
      .all(req.user!.id);
    res.json({
      user: req.user,
      config,
      subscriptions,
      pendingPayments,
    });
  });

  router.post('/subscription/pay', requireAuth, async (req: AuthedRequest, res) => {
    const { provider } = req.body || {};
    if (!provider || !['telebirr', 'chapa', 'cbe_birr'].includes(provider)) {
      res.status(400).json({ error: 'Select a valid Ethiopian payment provider (Telebirr, Chapa, or CBE Birr).' });
      return;
    }
    if (req.user!.subscription_status === 'exempt') {
      res.status(400).json({ error: 'Administrator accounts do not require a monthly service pass.' });
      return;
    }

    const { amountEtb } = getServiceFeeConfig();
    const purpose = req.user!.has_prior_subscription ? 'monthly_service_renewal' : 'registration_fee';
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

    const result = await initiateEthiopianPayment({
      bookingId: null,
      userId: req.user!.id,
      provider,
      amount: amountEtb,
      purpose,
      email: req.user!.email || 'customer@azrental.et',
      phone: req.user!.phone || '+251900000000',
      fullName: req.user!.full_name,
      returnUrl: `${baseUrl}/?payment=return`,
      callbackUrl: `${baseUrl}/api/payments/webhook/${provider}`,
    });

    res.status(result.statusCode).json(result);
  });

  router.post(
    '/subscription/submit-receipt',
    requireAuth,
    uploadMemory.single('receipt'),
    (req: AuthedRequest, res) => {
      const { provider, providerRef, senderPhone, notes } = req.body || {};
      const cleanProvider = ['telebirr', 'chapa', 'cbe_birr'].includes(provider) ? provider : 'telebirr';
      const cleanRef = String(providerRef || '').trim();
      if (cleanRef.length < 4 || cleanRef.length > 80) {
        res.status(400).json({ error: 'Enter a valid Telebirr or CBE transaction reference (4–80 characters).' });
        return;
      }

      const duplicate = db
        .prepare(`SELECT id FROM payments WHERE provider_ref = ? AND status IN ('pending_verification', 'paid')`)
        .get(cleanRef) as any;
      if (duplicate) {
        res.status(409).json({ error: 'This transaction reference has already been submitted.' });
        return;
      }

      let receiptFile = '';
      if (req.file) {
        const allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
        if (!allowedMime.includes(req.file.mimetype)) {
          res.status(400).json({ error: 'Receipt must be JPG, PNG, WebP, or PDF.' });
          return;
        }
        const safeExt =
          req.file.mimetype === 'application/pdf'
            ? '.pdf'
            : req.file.mimetype === 'image/png'
            ? '.png'
            : req.file.mimetype === 'image/webp'
            ? '.webp'
            : '.jpg';
        receiptFile = `receipt-${crypto.randomUUID()}${safeExt}`;
        fs.writeFileSync(path.join(DOCS_DIR, receiptFile), req.file.buffer);
      }

      const { amountEtb, durationDays } = getServiceFeeConfig();
      const purpose = req.user!.has_prior_subscription ? 'monthly_service_renewal' : 'registration_fee';
      const txRef = `AZR-PASS-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const meta = {
        senderPhone: String(senderPhone || req.user!.phone || '').trim(),
        notes: String(notes || '').trim(),
        receiptFile,
        durationDays,
      };

      const ins = db
        .prepare(
          `INSERT INTO payments (booking_id, user_id, provider, amount, currency, purpose, tx_ref, provider_ref, status, metadata_json)
           VALUES (NULL, ?, ?, ?, 'ETB', ?, ?, ?, 'pending_verification', ?)`
        )
        .run(
          req.user!.id,
          cleanProvider,
          amountEtb,
          purpose,
          txRef,
          cleanRef,
          JSON.stringify(meta)
        );
      const paymentId = Number(ins.lastInsertRowid);

      const admins = db
        .prepare(`SELECT id FROM users WHERE role IN ('super_admin', 'admin', 'finance')`)
        .all() as Array<{ id: number }>;
      for (const adm of admins) {
        createNotification({
          userId: adm.id,
          type: 'service_pass_receipt',
          title: `50 ETB Service Pass Receipt Submitted (${cleanProvider.toUpperCase()})`,
          body: `${req.user!.full_name} submitted ref ${cleanRef} for ${amountEtb} ETB (${purpose === 'monthly_service_renewal' ? 'Renewal' : 'Registration'}).`,
          titleAm: `የ 50 ብር የአገልግሎት ክፍያ ደረሰኝ ቀርቧል`,
          bodyAm: `${req.user!.full_name} የማጣቀሻ ቁጥር ${cleanRef} ለ ${amountEtb} ብር ክፍያ ልከዋል።`,
          link: '/admin',
        });
      }

      writeAuditLog({
        actorId: req.user!.id,
        actorRole: req.user!.active_role,
        action: 'subscription.receipt_submitted',
        targetType: 'payment',
        targetId: paymentId,
        details: { provider: cleanProvider, providerRef: cleanRef, amountEtb, purpose },
      });

      const payment = db.prepare(`SELECT * FROM payments WHERE id = ?`).get(paymentId);
      res.status(201).json({
        ok: true,
        payment,
        message: 'Transfer receipt submitted. An administrator will verify and activate your 1-month service pass shortly.',
      });
    }
  );

  router.get('/subscription/verify/:txRef', requireAuth, async (req: AuthedRequest, res) => {
    const result = await verifyGatewayPaymentByTxRef(String(req.params.txRef || ''), req.user!.id);
    res.status(result.statusCode).json({
      ...result,
      user: loadUserById(req.user!.id),
    });
  });

  // ==================== PAYMENTS ====================
  router.get('/payments/providers', (_req, res) => {
    res.json({ providers: getPaymentProviders() });
  });

  router.get('/payments/history', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT p.*, b.listing_id, l.title as listing_title
         FROM payments p
         LEFT JOIN bookings b ON b.id = p.booking_id
         LEFT JOIN listings l ON l.id = b.listing_id
         WHERE p.user_id = ? OR b.owner_id = ?
         ORDER BY p.id DESC`
      )
      .all(req.user!.id, req.user!.id);
    res.json({ payments: rows });
  });

  router.post('/payments/initiate', requireAuth, requireActiveSubscription, async (req: AuthedRequest, res) => {
    const { bookingId, provider, purpose } = req.body || {};
    if (!provider || !['telebirr', 'chapa', 'cbe_birr'].includes(provider)) {
      res.status(400).json({ error: 'Select a valid Ethiopian payment provider (Telebirr, Chapa, or CBE Birr).' });
      return;
    }

    let amount = Number(req.body?.amount || 0);
    if (bookingId) {
      const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND renter_id = ?').get(Number(bookingId), req.user!.id) as any;
      if (!booking) {
        res.status(404).json({ error: 'Booking not found.' });
        return;
      }
      if (!booking.agreement_signed_by_renter) {
        res.status(400).json({
          error: 'Safety rule: You must sign the written rental agreement before making payment (ሳይዋዋሉ ገንዘብ አይክፈሉ).',
        });
        return;
      }
      amount = booking.total_amount;
    }

    if (amount <= 0) {
      res.status(400).json({ error: 'Payment amount must be greater than zero ETB.' });
      return;
    }

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const result = await initiateEthiopianPayment({
      bookingId: bookingId ? Number(bookingId) : null,
      userId: req.user!.id,
      provider,
      amount,
      purpose: String(purpose || 'booking_payment'),
      email: req.user!.email || 'customer@azrental.et',
      phone: req.user!.phone || '+251900000000',
      fullName: req.user!.full_name,
      returnUrl: `${baseUrl}/dashboard?payment=return`,
      callbackUrl: `${baseUrl}/api/payments/webhook/${provider}`,
    });

    res.status(result.statusCode).json(result);
  });

  router.post('/payments/webhook/:provider', async (req, res) => {
    const provider = req.params.provider as 'telebirr' | 'chapa' | 'cbe_birr';
    const rawBody = JSON.stringify(req.body || {});
    const sig =
      (req.headers['chapa-signature'] as string) ||
      (req.headers['x-chapa-signature'] as string) ||
      (req.headers['x-az-signature'] as string);
    const txRef = String(req.body?.tx_ref || req.body?.outTradeNo || req.body?.reference || '');
    const result = await verifyWebhookAndComplete({ provider, rawBody, signatureHeader: sig, txRef });
    res.status(result.statusCode).json(result);
  });

  // ==================== REAL-TIME CHAT & BLOCKING ====================
  router.get('/conversations', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT c.*,
                l.title as listing_title, l.city as listing_city,
                r.full_name as renter_name, r.identity_verified as renter_verified,
                o.full_name as owner_name, o.identity_verified as owner_verified,
                (SELECT content FROM messages m WHERE m.conversation_id = c.id AND m.is_deleted = 0 ORDER BY m.id DESC LIMIT 1) as last_message,
                (SELECT message_type FROM messages m WHERE m.conversation_id = c.id AND m.is_deleted = 0 ORDER BY m.id DESC LIMIT 1) as last_message_type,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.read_at IS NULL AND m.is_deleted = 0) as unread_count
         FROM conversations c
         LEFT JOIN listings l ON l.id = c.listing_id
         JOIN users r ON r.id = c.renter_id
         JOIN users o ON o.id = c.owner_id
         WHERE c.renter_id = ? OR c.owner_id = ?
         ORDER BY c.last_message_at DESC, c.id DESC`
      )
      .all(req.user!.id, req.user!.id, req.user!.id) as any[];

    const online = new Set(getOnlineUserIds());
    const conversations = rows.map((c) => {
      const peerId = c.renter_id === req.user!.id ? c.owner_id : c.renter_id;
      const peerName = c.renter_id === req.user!.id ? c.owner_name : c.renter_name;
      return {
        ...c,
        peerId,
        peerName,
        peerOnline: online.has(peerId),
      };
    });

    res.json({ conversations });
  });

  router.post('/conversations', requireAuth, requireActiveSubscription, (req: AuthedRequest, res) => {
    const { listingId, ownerId } = req.body || {};
    let targetOwnerId = Number(ownerId || 0);
    if (listingId && !targetOwnerId) {
      const listing = db.prepare('SELECT owner_id FROM listings WHERE id = ?').get(Number(listingId)) as any;
      if (listing) targetOwnerId = listing.owner_id;
    }
    if (!targetOwnerId || targetOwnerId === req.user!.id) {
      res.status(400).json({ error: 'Valid recipient user is required.' });
      return;
    }

    const blocked = db
      .prepare(`SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`)
      .get(req.user!.id, targetOwnerId, targetOwnerId, req.user!.id);
    if (blocked) {
      res.status(403).json({ error: 'Cannot message this user due to block settings.' });
      return;
    }

    const existing = db
      .prepare(
        `SELECT * FROM conversations WHERE COALESCE(listing_id, 0) = COALESCE(?, 0) AND renter_id = ? AND owner_id = ?`
      )
      .get(listingId ? Number(listingId) : null, req.user!.id, targetOwnerId) as any;

    if (existing) {
      res.json({ conversation: existing });
      return;
    }

    const ins = db
      .prepare(`INSERT INTO conversations (listing_id, renter_id, owner_id) VALUES (?, ?, ?)`)
      .run(listingId ? Number(listingId) : null, req.user!.id, targetOwnerId);

    res.status(201).json({
      conversation: db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(ins.lastInsertRowid)),
    });
  });

  router.get('/conversations/:id/messages', requireAuth, (req: AuthedRequest, res) => {
    const convId = Number(req.params.id);
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId) as any;
    if (!conv || (conv.renter_id !== req.user!.id && conv.owner_id !== req.user!.id)) {
      res.status(403).json({ error: 'Unauthorized conversation access.' });
      return;
    }
    const messages = db
      .prepare(
        `SELECT m.*, u.full_name as sender_name
         FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = ? ORDER BY m.id ASC`
      )
      .all(convId);
    res.json({ messages });
  });

  router.post(
    '/conversations/:id/messages',
    requireAuth,
    requireActiveSubscription,
    uploadMemory.single('attachment'),
    (req: AuthedRequest, res) => {
      const convId = Number(req.params.id);
      const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId) as any;
      if (!conv || (conv.renter_id !== req.user!.id && conv.owner_id !== req.user!.id)) {
        res.status(403).json({ error: 'Unauthorized conversation access.' });
        return;
      }

      const recipientId = conv.renter_id === req.user!.id ? conv.owner_id : conv.renter_id;
      const blocked = db
        .prepare(`SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`)
        .get(req.user!.id, recipientId, recipientId, req.user!.id);
      if (blocked) {
        res.status(403).json({ error: 'Messaging blocked between users.' });
        return;
      }

      const { content, messageType, replyToId } = req.body || {};
      let mediaUrl = '';
      let fileName = '';
      let cleanType = ['text', 'image', 'video', 'file', 'voice'].includes(messageType) ? messageType : 'text';

      if (req.file) {
        const ext = path.extname(req.file.originalname) || '.bin';
        const safeFile = `${crypto.randomUUID()}${ext}`;
        fs.writeFileSync(path.join(CHAT_MEDIA_DIR, safeFile), req.file.buffer);
        mediaUrl = `/media/chat/${safeFile}`;
        fileName = req.file.originalname;
        if (cleanType === 'text') {
          if (req.file.mimetype.startsWith('image/')) cleanType = 'image';
          else if (req.file.mimetype.startsWith('video/')) cleanType = 'video';
          else if (req.file.mimetype.startsWith('audio/')) cleanType = 'voice';
          else cleanType = 'file';
        }
      }

      if (!content && !mediaUrl) {
        res.status(400).json({ error: 'Message content or attachment is required.' });
        return;
      }

      const ins = db
        .prepare(
          `INSERT INTO messages (conversation_id, sender_id, message_type, content, media_url, file_name, reply_to_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          convId,
          req.user!.id,
          cleanType,
          String(content || '').trim(),
          mediaUrl,
          fileName,
          replyToId ? Number(replyToId) : null
        );

      db.prepare(`UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?`).run(convId);

      const message = db
        .prepare(
          `SELECT m.*, u.full_name as sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
        )
        .get(Number(ins.lastInsertRowid));

      pushRealtimeToUser(recipientId, 'chat:message', message);
      pushRealtimeToUser(req.user!.id, 'chat:message', message);

      createNotification({
        userId: recipientId,
        type: 'new_message',
        title: `New message from ${req.user!.full_name}`,
        body: cleanType === 'text' ? String(content).slice(0, 80) : `Sent a ${cleanType} attachment`,
        titleAm: `አዲስ መልዕክት ከ ${req.user!.full_name}`,
        bodyAm: cleanType === 'text' ? String(content).slice(0, 80) : `${cleanType} ተልኳል`,
        link: '/messages',
      });

      res.status(201).json({ message });
    }
  );

  router.patch('/messages/:id', requireAuth, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as any;
    if (!msg || msg.sender_id !== req.user!.id) {
      res.status(403).json({ error: 'Only the sender can edit this message.' });
      return;
    }
    const content = String(req.body?.content || '').trim();
    if (!content) {
      res.status(400).json({ error: 'Message content cannot be empty.' });
      return;
    }
    db.prepare(`UPDATE messages SET content = ?, is_edited = 1 WHERE id = ?`).run(content, id);
    const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(msg.conversation_id) as any;
    if (conv) {
      const peerId = conv.renter_id === req.user!.id ? conv.owner_id : conv.renter_id;
      pushRealtimeToUser(peerId, 'chat:edit', updated);
    }
    res.json({ message: updated });
  });

  router.delete('/messages/:id', requireAuth, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as any;
    if (!msg || msg.sender_id !== req.user!.id) {
      res.status(403).json({ error: 'Only the sender can delete this message.' });
      return;
    }
    db.prepare(`UPDATE messages SET is_deleted = 1, content = '[Message deleted]', media_url = '' WHERE id = ?`).run(id);
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(msg.conversation_id) as any;
    if (conv) {
      const peerId = conv.renter_id === req.user!.id ? conv.owner_id : conv.renter_id;
      pushRealtimeToUser(peerId, 'chat:delete', { id, conversation_id: msg.conversation_id });
    }
    res.json({ ok: true });
  });

  router.post('/conversations/:id/read', requireAuth, (req: AuthedRequest, res) => {
    const convId = Number(req.params.id);
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId) as any;
    if (!conv || (conv.renter_id !== req.user!.id && conv.owner_id !== req.user!.id)) {
      res.status(403).json({ error: 'Unauthorized.' });
      return;
    }
    db.prepare(
      `UPDATE messages SET read_at = datetime('now') WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL`
    ).run(convId, req.user!.id);
    const peerId = conv.renter_id === req.user!.id ? conv.owner_id : conv.renter_id;
    pushRealtimeToUser(peerId, 'chat:read', { conversationId: convId, readerId: req.user!.id });
    res.json({ ok: true });
  });

  router.post('/users/:id/block', requireAuth, (req: AuthedRequest, res) => {
    const targetId = Number(req.params.id);
    if (targetId === req.user!.id) {
      res.status(400).json({ error: 'Cannot block yourself.' });
      return;
    }
    db.prepare(`INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id, reason) VALUES (?, ?, ?)`).run(
      req.user!.id,
      targetId,
      String(req.body?.reason || '')
    );
    res.json({ ok: true });
  });

  router.delete('/users/:id/block', requireAuth, (req: AuthedRequest, res) => {
    db.prepare(`DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?`).run(
      req.user!.id,
      Number(req.params.id)
    );
    res.json({ ok: true });
  });

  // ==================== CALLS, NOTIFICATIONS, REVIEWS, REPORTS, VERIFICATION ====================
  router.get('/calls/history', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT c.*, u1.full_name as caller_name, u2.full_name as callee_name
         FROM calls c
         JOIN users u1 ON u1.id = c.caller_id
         JOIN users u2 ON u2.id = c.callee_id
         WHERE c.caller_id = ? OR c.callee_id = ?
         ORDER BY c.id DESC LIMIT 50`
      )
      .all(req.user!.id, req.user!.id);
    res.json({ calls: rows });
  });

  router.get('/notifications', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60')
      .all(req.user!.id);
    const unreadCount = (
      db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user!.id) as any
    ).c;
    res.json({ notifications: rows, unreadCount });
  });

  router.patch('/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(
      Number(req.params.id),
      req.user!.id
    );
    res.json({ ok: true });
  });

  router.post('/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
    res.json({ ok: true });
  });

  router.post('/reviews', requireAuth, (req: AuthedRequest, res) => {
    const { listingId, rating, comment } = req.body || {};
    const numRating = Number(rating);
    if (!listingId || !comment || Number.isNaN(numRating) || numRating < 1 || numRating > 5) {
      res.status(400).json({ error: 'Listing, rating (1-5), and comment are required.' });
      return;
    }
    const listing = db.prepare('SELECT owner_id FROM listings WHERE id = ?').get(Number(listingId)) as any;
    if (!listing) {
      res.status(404).json({ error: 'Listing not found.' });
      return;
    }

    db.transaction(() => {
      db.prepare(
        `INSERT INTO reviews (listing_id, reviewer_id, target_user_id, rating, comment) VALUES (?, ?, ?, ?, ?)`
      ).run(Number(listingId), req.user!.id, listing.owner_id, numRating, String(comment).trim());

      const stats = db
        .prepare('SELECT AVG(rating) as avgR, COUNT(*) as cnt FROM reviews WHERE target_user_id = ?')
        .get(listing.owner_id) as any;
      db.prepare(
        `INSERT INTO landlord_profiles (user_id, rating_avg, review_count) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET rating_avg = excluded.rating_avg, review_count = excluded.review_count`
      ).run(listing.owner_id, Number((stats.avgR || 0).toFixed(2)), stats.cnt);
    })();

    res.status(201).json({ ok: true });
  });

  router.post('/reports', requireAuth, (req: AuthedRequest, res) => {
    const { targetType, targetId, reason, details } = req.body || {};
    if (!['listing', 'user', 'booking'].includes(targetType) || !targetId || !reason) {
      res.status(400).json({ error: 'Valid report target and reason are required.' });
      return;
    }
    const ins = db
      .prepare(`INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?)`)
      .run(req.user!.id, targetType, Number(targetId), String(reason).trim(), String(details || '').trim());

    writeAuditLog({
      actorId: req.user!.id,
      actorRole: req.user!.active_role,
      action: 'report.submitted',
      targetType,
      targetId: Number(targetId),
      details: { reason },
    });

    res.status(201).json({ id: Number(ins.lastInsertRowid) });
  });

  router.post('/verification/request', requireAuth, uploadMemory.single('document'), (req: AuthedRequest, res) => {
    const { requestType, businessName, licenseNumber, notes } = req.body || {};
    const cleanType = ['identity', 'business'].includes(requestType) ? requestType : 'identity';
    let docUrl = '';
    if (req.file) {
      const safeFile = `${crypto.randomUUID()}${path.extname(req.file.originalname) || '.pdf'}`;
      fs.writeFileSync(path.join(DOCS_DIR, safeFile), req.file.buffer);
      docUrl = `private/docs/${safeFile}`;
    }

    const ins = db
      .prepare(
        `INSERT INTO verification_requests (user_id, request_type, document_url, business_name, license_number, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`
      )
      .run(
        req.user!.id,
        cleanType,
        docUrl,
        String(businessName || '').trim(),
        String(licenseNumber || '').trim(),
        String(notes || '').trim()
      );

    db.prepare(`UPDATE users SET verification_status = 'pending' WHERE id = ?`).run(req.user!.id);
    res.status(201).json({ id: Number(ins.lastInsertRowid), status: 'pending' });
  });

  router.get('/verification/my', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare('SELECT id, request_type, business_name, license_number, notes, status, reviewed_at, created_at FROM verification_requests WHERE user_id = ? ORDER BY id DESC')
      .all(req.user!.id);
    res.json({ requests: rows });
  });

  return router;
}

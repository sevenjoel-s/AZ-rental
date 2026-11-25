import express from 'express';
import fs from 'fs';
import path from 'path';
import { ADMIN_ROLES, AuthedRequest, requireAuth, requireRole } from './auth.ts';
import { db, getServiceFeeConfig, writeAuditLog } from './db.ts';
import { DOCS_DIR } from './media.ts';
import { activateUserServicePass } from './payments.ts';
import { createNotification } from './realtime.ts';

export function createAdminRouter(): express.Router {
  const router = express.Router();
  const anyAdmin = Array.from(ADMIN_ROLES);

  router.use(requireAuth, requireRole(anyAdmin));

  // ==================== ANALYTICS & CHARTS ====================
  router.get('/analytics', (req: AuthedRequest, res) => {
    const { fromDate, toDate } = req.query as Record<string, string>;
    const hasDates = Boolean(fromDate && toDate);
    const dateFilter = hasDates ? 'WHERE created_at >= ? AND created_at <= ?' : '';
    const dateParams = hasDates ? [String(fromDate), `${String(toDate)} 23:59:59`] : [];

    const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
    const totalLandlords = (db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'landlord' OR active_role = 'landlord'`).get() as any).c;
    const totalRenters = (db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'renter'`).get() as any).c;
    const activeListings = (db.prepare(`SELECT COUNT(*) as c FROM listings WHERE status = 'approved'`).get() as any).c;
    const pendingListings = (db.prepare(`SELECT COUNT(*) as c FROM listings WHERE status = 'pending'`).get() as any).c;
    const totalBookings = (db.prepare(`SELECT COUNT(*) as c FROM bookings`).get() as any).c;
    const completedBookings = (db.prepare(`SELECT COUNT(*) as c FROM bookings WHERE status = 'Completed'`).get() as any).c;
    const revenueRow = db
      .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'paid'`)
      .get() as any;
    const openReports = (db.prepare(`SELECT COUNT(*) as c FROM reports WHERE status = 'open'`).get() as any).c;
    const pendingVerifications = (db.prepare(`SELECT COUNT(*) as c FROM verification_requests WHERE status = 'pending'`).get() as any).c;

    const categoryBreakdown = db
      .prepare(
        `SELECT c.name_en as name, c.name_am as nameAm, COUNT(l.id) as listings
         FROM categories c LEFT JOIN listings l ON l.category_id = c.id
         GROUP BY c.id ORDER BY listings DESC`
      )
      .all();

    const cityBreakdown = db
      .prepare(
        `SELECT city as name, COUNT(*) as listings
         FROM listings GROUP BY city ORDER BY listings DESC LIMIT 8`
      )
      .all();

    const monthlyActivity = db
      .prepare(
        `SELECT strftime('%Y-%m', created_at) as month,
                COUNT(*) as bookings,
                COALESCE(SUM(total_amount), 0) as volume
         FROM bookings
         ${dateFilter}
         GROUP BY month ORDER BY month ASC LIMIT 12`
      )
      .all(...dateParams);

    res.json({
      kpis: {
        totalUsers,
        totalLandlords,
        totalRenters,
        activeListings,
        pendingListings,
        totalBookings,
        completedBookings,
        totalRevenueEtb: revenueRow.total,
        openReports,
        pendingVerifications,
      },
      charts: {
        categoryBreakdown,
        cityBreakdown,
        monthlyActivity,
      },
    });
  });

  // ==================== USER & ROLE MANAGEMENT ====================
  router.get('/users', (_req, res) => {
    const users = db
      .prepare(
        `SELECT id, full_name, email, phone, role, active_role, city, account_type,
                email_verified, phone_verified, identity_verified, business_verified,
                verification_status, is_blocked, created_at,
                subscription_status, subscription_expires_at,
                (SELECT COUNT(*) FROM subscriptions s WHERE s.user_id = users.id) as prior_subscriptions
         FROM users ORDER BY id DESC`
      )
      .all() as any[];

    const roleRequests = db
      .prepare(
        `SELECT ur.*, u.full_name, u.email, u.phone
         FROM user_roles ur JOIN users u ON u.id = ur.user_id
         WHERE ur.status = 'pending' ORDER BY ur.id DESC`
      )
      .all();

    res.json({ users, roleRequests });
  });

  router.patch('/users/:id', requireRole(['super_admin', 'admin', 'support']), (req: AuthedRequest, res) => {
    const targetId = Number(req.params.id);
    const { isBlocked, verificationStatus, identityVerified, businessVerified, assignRole } = req.body || {};

    db.prepare(
      `UPDATE users SET
        is_blocked = COALESCE(?, is_blocked),
        verification_status = COALESCE(?, verification_status),
        identity_verified = COALESCE(?, identity_verified),
        business_verified = COALESCE(?, business_verified),
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      isBlocked !== undefined ? (isBlocked ? 1 : 0) : null,
      verificationStatus || null,
      identityVerified !== undefined ? (identityVerified ? 1 : 0) : null,
      businessVerified !== undefined ? (businessVerified ? 1 : 0) : null,
      targetId
    );

    if (assignRole && req.user!.roles.includes('super_admin')) {
      db.prepare(
        `INSERT INTO user_roles (user_id, role_name, status, granted_by) VALUES (?, ?, 'approved', ?)
         ON CONFLICT(user_id, role_name) DO UPDATE SET status = 'approved', granted_by = excluded.granted_by`
      ).run(targetId, assignRole, req.user!.id);
    }

    writeAuditLog({
      actorId: req.user!.id,
      actorRole: req.user!.active_role,
      action: 'admin.user_updated',
      targetType: 'user',
      targetId,
      details: req.body,
    });

    res.json({ ok: true });
  });

  router.patch('/role-requests/:id', requireRole(['super_admin', 'admin']), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { decision } = req.body || {};
    const reqRow = db.prepare('SELECT * FROM user_roles WHERE id = ?').get(id) as any;
    if (!reqRow) {
      res.status(404).json({ error: 'Role request not found.' });
      return;
    }
    const status = decision === 'approve' ? 'approved' : 'rejected';
    db.prepare('UPDATE user_roles SET status = ?, granted_by = ? WHERE id = ?').run(status, req.user!.id, id);

    createNotification({
      userId: reqRow.user_id,
      type: 'account_verification',
      title: `Role Request ${status === 'approved' ? 'Approved' : 'Declined'}`,
      body: `Your request for ${reqRow.role_name} access was ${status}.`,
      titleAm: `የሚና ጥያቄዎ ${status === 'approved' ? 'ጸድቋል' : 'ውድቅ ተደርጓል'}`,
      bodyAm: `የ ${reqRow.role_name} ሚና ጥያቄዎ ${status === 'approved' ? 'ተፈቅዷል' : 'አልተፈቀደም'}።`,
      link: '/dashboard',
    });

    writeAuditLog({
      actorId: req.user!.id,
      actorRole: req.user!.active_role,
      action: `admin.role_request_${status}`,
      targetType: 'user_roles',
      targetId: id,
    });

    res.json({ ok: true });
  });

  // ==================== VERIFICATION REQUESTS ====================
  router.get('/verifications', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT vr.*, u.full_name, u.email, u.phone, u.city
         FROM verification_requests vr JOIN users u ON u.id = vr.user_id
         ORDER BY vr.id DESC`
      )
      .all();
    res.json({ verifications: rows });
  });

  router.patch('/verifications/:id', requireRole(['super_admin', 'admin', 'moderator']), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { decision } = req.body || {};
    const vr = db.prepare('SELECT * FROM verification_requests WHERE id = ?').get(id) as any;
    if (!vr) {
      res.status(404).json({ error: 'Verification request not found.' });
      return;
    }
    const status = decision === 'approve' ? 'approved' : 'rejected';
    db.transaction(() => {
      db.prepare(`UPDATE verification_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`).run(
        status,
        req.user!.id,
        id
      );
      if (status === 'approved') {
        if (vr.request_type === 'business') {
          db.prepare(`UPDATE users SET business_verified = 1, identity_verified = 1, verification_status = 'verified' WHERE id = ?`).run(vr.user_id);
        } else {
          db.prepare(`UPDATE users SET identity_verified = 1, verification_status = 'verified' WHERE id = ?`).run(vr.user_id);
        }
        db.prepare(`UPDATE listings SET is_verified = 1 WHERE owner_id = ?`).run(vr.user_id);
      } else {
        db.prepare(`UPDATE users SET verification_status = 'rejected' WHERE id = ?`).run(vr.user_id);
      }
    })();

    createNotification({
      userId: vr.user_id,
      type: 'account_verification',
      title: `Account Verification ${status === 'approved' ? 'Approved' : 'Rejected'}`,
      body: status === 'approved' ? 'Your verified AZ RENTAL badge is now active.' : 'Please resubmit valid verification documents.',
      titleAm: `የማረጋገጫ ጥያቄዎ ${status === 'approved' ? 'ጸድቋል' : 'ተመልሷል'}`,
      bodyAm: status === 'approved' ? 'የተረጋገጠ ባለንብረት ምልክት አግኝተዋል።' : 'እባክዎ ትክክለኛ ሰነዶችን በድጋሚ ያስገቡ።',
      link: '/dashboard',
    });

    writeAuditLog({
      actorId: req.user!.id,
      actorRole: req.user!.active_role,
      action: `admin.verification_${status}`,
      targetType: 'verification_request',
      targetId: id,
    });

    res.json({ ok: true });
  });

  // ==================== LISTING MODERATION ====================
  router.get('/listings', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT l.*, c.name_en as category_name, u.full_name as owner_name, u.verification_status as owner_verification
         FROM listings l
         JOIN categories c ON c.id = l.category_id
         JOIN users u ON u.id = l.owner_id
         ORDER BY CASE WHEN l.status = 'pending' THEN 0 ELSE 1 END, l.id DESC`
      )
      .all();
    res.json({ listings: rows });
  });

  router.patch('/listings/:id/moderate', requireRole(['super_admin', 'admin', 'moderator']), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { status, isVerified, reason } = req.body || {};
    if (!['approved', 'rejected', 'paused', 'pending'].includes(status)) {
      res.status(400).json({ error: 'Invalid status.' });
      return;
    }
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id) as any;
    if (!listing) {
      res.status(404).json({ error: 'Listing not found.' });
      return;
    }
    db.prepare(`UPDATE listings SET status = ?, is_verified = COALESCE(?, is_verified), updated_at = datetime('now') WHERE id = ?`).run(
      status,
      isVerified !== undefined ? (isVerified ? 1 : 0) : null,
      id
    );

    createNotification({
      userId: listing.owner_id,
      type: status === 'approved' ? 'listing_approval' : 'listing_rejection',
      title: `Listing ${status === 'approved' ? 'Approved' : 'Updated'}: ${listing.title}`,
      body: reason || `Listing status changed to ${status}.`,
      titleAm: `ማስታወቂያዎ ${status === 'approved' ? 'ጸድቋል' : 'ተሻሽሏል'}`,
      bodyAm: reason || `የማስታወቂያዎ ሁኔታ ወደ ${status} ተቀይሯል።`,
      link: `/listings/${id}`,
    });

    writeAuditLog({
      actorId: req.user!.id,
      actorRole: req.user!.active_role,
      action: `admin.listing_${status}`,
      targetType: 'listing',
      targetId: id,
      details: { reason },
    });

    res.json({ ok: true });
  });

  // ==================== CATEGORIES & SUBCATEGORIES ====================
  router.post('/categories', requireRole(['super_admin', 'admin']), (req: AuthedRequest, res) => {
    const { slug, nameEn, nameAm, nameOm, nameTi, nameSo, icon } = req.body || {};
    if (!slug || !nameEn || !nameAm) {
      res.status(400).json({ error: 'Slug, English name, and Amharic name are required.' });
      return;
    }
    const ins = db
      .prepare(
        `INSERT INTO categories (slug, name_en, name_am, name_om, name_ti, name_so, icon)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(slug, nameEn, nameAm, nameOm || nameEn, nameTi || nameEn, nameSo || nameEn, icon || 'Package');
    writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.active_role, action: 'admin.category_created', targetType: 'category', targetId: Number(ins.lastInsertRowid) });
    res.status(201).json({ id: Number(ins.lastInsertRowid) });
  });

  router.post('/subcategories', requireRole(['super_admin', 'admin']), (req: AuthedRequest, res) => {
    const { categoryId, groupName, slug, nameEn, nameAm } = req.body || {};
    if (!categoryId || !slug || !nameEn || !nameAm) {
      res.status(400).json({ error: 'Category, slug, English name, and Amharic name are required.' });
      return;
    }
    const ins = db
      .prepare(
        `INSERT INTO subcategories (category_id, group_name, slug, name_en, name_am) VALUES (?, ?, ?, ?, ?)`
      )
      .run(Number(categoryId), groupName || 'General', slug, nameEn, nameAm);
    writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.active_role, action: 'admin.subcategory_created', targetType: 'subcategory', targetId: Number(ins.lastInsertRowid) });
    res.status(201).json({ id: Number(ins.lastInsertRowid) });
  });

  // ==================== ETHIOPIAN LOCATIONS CRUD ====================
  router.post('/locations', requireRole(['super_admin', 'admin']), (req: AuthedRequest, res) => {
    const { region, zone, city, woreda, subCity, neighborhood, latitude, longitude, isRegionalCapital } = req.body || {};
    if (!region || !city || latitude === undefined || longitude === undefined) {
      res.status(400).json({ error: 'Region, city, latitude, and longitude are required.' });
      return;
    }
    const ins = db
      .prepare(
        `INSERT INTO locations (region, zone, city, woreda, sub_city, neighborhood, latitude, longitude, is_regional_capital)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        region,
        zone || '',
        city,
        woreda || '',
        subCity || '',
        neighborhood || '',
        Number(latitude),
        Number(longitude),
        isRegionalCapital ? 1 : 0
      );
    writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.active_role, action: 'admin.location_created', targetType: 'location', targetId: Number(ins.lastInsertRowid) });
    res.status(201).json({ id: Number(ins.lastInsertRowid) });
  });

  router.delete('/locations/:id', requireRole(['super_admin', 'admin']), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    db.prepare('UPDATE locations SET is_active = 0 WHERE id = ?').run(id);
    writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.active_role, action: 'admin.location_disabled', targetType: 'location', targetId: id });
    res.json({ ok: true });
  });

  // ==================== BANNERS CRUD ====================
  router.get('/banners', (_req, res) => {
    res.json({ banners: db.prepare('SELECT * FROM banners ORDER BY sort_order ASC').all() });
  });

  router.patch('/banners/:id', requireRole(['super_admin', 'admin']), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { titleAm, titleEn, subtitleAm, subtitleEn, isActive, imageUrl } = req.body || {};
    db.prepare(
      `UPDATE banners SET
        title_am = COALESCE(?, title_am),
        title_en = COALESCE(?, title_en),
        subtitle_am = COALESCE(?, subtitle_am),
        subtitle_en = COALESCE(?, subtitle_en),
        is_active = COALESCE(?, is_active),
        image_url = COALESCE(?, image_url),
        updated_by = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      titleAm || null,
      titleEn || null,
      subtitleAm || null,
      subtitleEn || null,
      isActive !== undefined ? (isActive ? 1 : 0) : null,
      imageUrl !== undefined ? imageUrl : null,
      req.user!.id,
      id
    );
    writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.active_role, action: 'admin.banner_updated', targetType: 'banner', targetId: id });
    res.json({ ok: true });
  });

  // ==================== PAYMENTS, REFUNDS & BOOKINGS ====================
  router.get('/payments', requireRole(['super_admin', 'admin', 'finance']), (_req, res) => {
    const payments = db
      .prepare(
        `SELECT p.*, u.full_name as user_name, u.email as user_email, u.phone as user_phone
         FROM payments p JOIN users u ON u.id = p.user_id ORDER BY p.id DESC`
      )
      .all();
    const transactions = db.prepare('SELECT * FROM transactions ORDER BY id DESC LIMIT 100').all();
    const subscriptions = db
      .prepare(
        `SELECT s.*, u.full_name as user_name, u.email as user_email, u.phone as user_phone
         FROM subscriptions s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 100`
      )
      .all();
    const bookings = db
      .prepare(
        `SELECT b.*, l.title as listing_title, r.full_name as renter_name, o.full_name as owner_name
         FROM bookings b JOIN listings l ON l.id = b.listing_id
         JOIN users r ON r.id = b.renter_id JOIN users o ON o.id = b.owner_id
         ORDER BY b.id DESC LIMIT 100`
      )
      .all();
    res.json({ payments, transactions, subscriptions, bookings });
  });

  router.post(
    '/subscriptions/approve-payment/:paymentId',
    requireRole(['super_admin', 'admin', 'finance']),
    (req: AuthedRequest, res) => {
      const paymentId = Number(req.params.paymentId);
      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as any;
      if (!payment) {
        res.status(404).json({ error: 'Payment record not found.' });
        return;
      }
      if (!['pending_verification', 'pending'].includes(payment.status)) {
        res.status(400).json({ error: `Cannot approve payment in status "${payment.status}".` });
        return;
      }
      if (!['registration_fee', 'monthly_service_renewal'].includes(payment.purpose)) {
        res.status(400).json({ error: 'Payment is not a monthly service pass payment.' });
        return;
      }

      db.transaction(() => {
        db.prepare(
          `UPDATE payments SET status = 'paid', verified_at = datetime('now') WHERE id = ?`
        ).run(paymentId);
        db.prepare(
          `INSERT INTO transactions (payment_id, type, amount, currency, reference, status, notes)
           VALUES (?, 'credit', ?, 'ETB', ?, 'completed', ?)`
        ).run(
          paymentId,
          payment.amount,
          payment.provider_ref || payment.tx_ref,
          `Admin approved 50 ETB ${payment.provider} service pass transfer`
        );
      })();

      const pass = activateUserServicePass({
        userId: payment.user_id,
        paymentId,
        amount: Number(payment.amount),
        kind: payment.purpose === 'monthly_service_renewal' ? 'renewal' : 'initial',
      });

      writeAuditLog({
        actorId: req.user!.id,
        actorRole: req.user!.active_role,
        action: 'admin.subscription_payment_approved',
        targetType: 'payment',
        targetId: paymentId,
        details: { targetUserId: payment.user_id, providerRef: payment.provider_ref, endsAt: pass.endsAt },
      });

      res.json({ ok: true, pass });
    }
  );

  router.post(
    '/subscriptions/reject-payment/:paymentId',
    requireRole(['super_admin', 'admin', 'finance']),
    (req: AuthedRequest, res) => {
      const paymentId = Number(req.params.paymentId);
      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as any;
      if (!payment) {
        res.status(404).json({ error: 'Payment record not found.' });
        return;
      }
      const reason = String(req.body?.reason || 'Transfer reference could not be verified.').trim();
      db.prepare(
        `UPDATE payments SET status = 'failed', failure_reason = ? WHERE id = ?`
      ).run(reason, paymentId);

      createNotification({
        userId: payment.user_id,
        type: 'service_pass_rejected',
        title: '50 ETB Payment Verification Declined',
        body: `Your transfer reference ${payment.provider_ref || payment.tx_ref} was declined: ${reason}`,
        titleAm: 'የ 50 ብር ክፍያ ማረጋገጫ አልተቀበለም',
        bodyAm: `ያስገቡት የክፍያ ማጣቀሻ (${payment.provider_ref || payment.tx_ref}) ውድቅ ሆኗል: ${reason}`,
        link: '/dashboard',
      });

      writeAuditLog({
        actorId: req.user!.id,
        actorRole: req.user!.active_role,
        action: 'admin.subscription_payment_rejected',
        targetType: 'payment',
        targetId: paymentId,
        details: { targetUserId: payment.user_id, reason },
      });

      res.json({ ok: true });
    }
  );

  router.post(
    '/users/:id/grant-pass',
    requireRole(['super_admin', 'admin', 'finance']),
    (req: AuthedRequest, res) => {
      const targetId = Number(req.params.id);
      const userRow = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId) as any;
      if (!userRow) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }
      const cfg = getServiceFeeConfig();
      const rawDays = Number(req.body?.durationDays || cfg.durationDays);
      const durationDays = Math.min(365, Math.max(1, Number.isFinite(rawDays) ? rawDays : cfg.durationDays));

      const pass = activateUserServicePass({
        userId: targetId,
        amount: cfg.amountEtb,
        durationDays,
        kind: 'admin_grant',
        notes: String(req.body?.notes || 'Admin granted monthly service pass'),
      });

      writeAuditLog({
        actorId: req.user!.id,
        actorRole: req.user!.active_role,
        action: 'admin.user_service_pass_granted',
        targetType: 'user',
        targetId,
        details: { durationDays, endsAt: pass.endsAt },
      });

      res.json({ ok: true, pass });
    }
  );

  router.get(
    '/subscriptions/receipt/:paymentId',
    requireRole(['super_admin', 'admin', 'finance']),
    (req: AuthedRequest, res) => {
      const paymentId = Number(req.params.paymentId);
      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as any;
      if (!payment) {
        res.status(404).json({ error: 'Payment not found.' });
        return;
      }
      let receiptFile = '';
      try {
        receiptFile = path.basename(String(JSON.parse(payment.metadata_json || '{}').receiptFile || ''));
      } catch {
        receiptFile = '';
      }
      if (!receiptFile) {
        res.status(404).json({ error: 'No receipt file uploaded for this payment.' });
        return;
      }
      const fullPath = path.resolve(DOCS_DIR, receiptFile);
      if (!fullPath.startsWith(path.resolve(DOCS_DIR)) || !fs.existsSync(fullPath)) {
        res.status(404).json({ error: 'Receipt file missing.' });
        return;
      }
      res.sendFile(fullPath);
    }
  );

  router.post('/payments/:id/refund', requireRole(['super_admin', 'finance']), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as any;
    if (!payment || payment.status !== 'paid') {
      res.status(400).json({ error: 'Only paid transactions can be refunded.' });
      return;
    }
    db.transaction(() => {
      db.prepare(`UPDATE payments SET status = 'refunded' WHERE id = ?`).run(id);
      db.prepare(
        `INSERT INTO transactions (payment_id, type, amount, currency, reference, status, notes)
         VALUES (?, 'refund', ?, 'ETB', ?, 'completed', ?)`
      ).run(id, payment.amount, `REF-${payment.tx_ref}`, String(req.body?.reason || 'Admin refund'));
      if (payment.booking_id) {
        db.prepare(`UPDATE bookings SET status = 'Cancelled' WHERE id = ?`).run(payment.booking_id);
      }
    })();
    writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.active_role, action: 'admin.payment_refunded', targetType: 'payment', targetId: id });
    res.json({ ok: true });
  });

  // ==================== REPORTS & DISPUTES ====================
  router.get('/reports', (_req, res) => {
    const reports = db
      .prepare(
        `SELECT r.*, u.full_name as reporter_name FROM reports r JOIN users u ON u.id = r.reporter_id ORDER BY r.id DESC`
      )
      .all();
    res.json({ reports });
  });

  router.patch('/reports/:id', requireRole(['super_admin', 'admin', 'support', 'moderator']), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { status, resolutionNotes } = req.body || {};
    db.prepare(`UPDATE reports SET status = ?, resolution_notes = ?, resolved_by = ? WHERE id = ?`).run(
      status || 'resolved',
      String(resolutionNotes || ''),
      req.user!.id,
      id
    );
    writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.active_role, action: 'admin.report_resolved', targetType: 'report', targetId: id });
    res.json({ ok: true });
  });

  // ==================== SETTINGS, TRANSLATIONS, AUDIT LOGS ====================
  router.get('/settings', (_req, res) => {
    const rows = db.prepare('SELECT * FROM system_settings').all() as any[];
    const settings: Record<string, any> = {};
    for (const r of rows) {
      try {
        settings[r.key] = JSON.parse(r.value_json);
      } catch {
        settings[r.key] = r.value_json;
      }
    }
    res.json({ settings });
  });

  router.put('/settings', requireRole(['super_admin', 'admin']), (req: AuthedRequest, res) => {
    const entries = Object.entries(req.body || {});
    const upsert = db.prepare(
      `INSERT INTO system_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = datetime('now')`
    );
    db.transaction(() => {
      for (const [k, v] of entries) {
        upsert.run(k, JSON.stringify(v), req.user!.id);
      }
    })();
    writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.active_role, action: 'admin.settings_updated', details: req.body });
    res.json({ ok: true });
  });

  router.post('/translations', requireRole(['super_admin', 'admin']), (req: AuthedRequest, res) => {
    const { langCode, key, value } = req.body || {};
    if (!langCode || !key || !value) {
      res.status(400).json({ error: 'langCode, key, and value are required.' });
      return;
    }
    db.prepare(
      `INSERT INTO translations (lang_code, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(lang_code, key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`
    ).run(langCode, key, value, req.user!.id);
    writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.active_role, action: 'admin.translation_updated', details: { langCode, key } });
    res.json({ ok: true });
  });

  router.get('/audit-logs', (_req, res) => {
    const logs = db
      .prepare(
        `SELECT al.*, u.full_name as actor_name
         FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id
         ORDER BY al.id DESC LIMIT 150`
      )
      .all();
    res.json({ logs });
  });

  return router;
}

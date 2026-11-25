import fs from 'fs';
import http from 'http';
import path from 'path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = path.resolve(process.cwd(), 'data', `test-az-${Date.now()}.db`);
process.env.AZ_DB_PATH = TEST_DB;
process.env.VITEST = 'true';

let server: http.Server;
let baseUrl = '';
let dbRef: typeof import('../src/server/db.ts').db;

async function req(urlPath: string, opts: RequestInit = {}, token?: string) {
  const headers = new Headers(opts.headers || {});
  headers.set('X-Requested-With', 'AZRental');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (opts.body && !(opts.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${baseUrl}${urlPath}`, { ...opts, headers });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

describe('AZ RENTAL Full-Stack Integration Suite', () => {
  let renterToken = '';
  let renterId = 0;
  let landlordToken = '';
  let landlordId = 0;
  let adminToken = '';
  let createdListingId = 0;
  let createdBookingId = 0;

  beforeAll(async () => {
    const dbMod = await import('../src/server/db.ts');
    dbRef = dbMod.db;
    const { createApp } = await import('../server.ts');
    const app = await createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  }, 30_000);

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  it('seeds all 6 categories, Ethiopian locations, 3 Amharic safety banners, and 50 ETB service fee config', async () => {
    const catRes = await req('/api/categories');
    expect(catRes.status).toBe(200);
    expect(catRes.json.categories.length).toBeGreaterThanOrEqual(6);

    const locRes = await req('/api/locations');
    expect(locRes.status).toBe(200);
    expect(locRes.json.locations.length).toBeGreaterThanOrEqual(25);

    const banRes = await req('/api/banners');
    expect(banRes.status).toBe(200);
    const titles = banRes.json.banners.map((b: any) => b.title_am);
    expect(titles).toContain('በውል የከራዩ');
    expect(titles).toContain('ሳይዋዋሉ ገንዘብ አይክፈሉ');
    expect(titles).toContain('ከአጭበርባሪዎች ይጠንቀቁ');

    const cfgRes = await req('/api/subscription/config');
    expect(cfgRes.status).toBe(200);
    expect(cfgRes.json.amountEtb).toBe(50);
    expect(cfgRes.json.durationDays).toBe(30);
  });

  it('registers renter & landlord, verifies OTP, requires 50 ETB 1-month pass, and enforces auth boundaries', async () => {
    // Unauthorized check
    const unauth = await req('/api/bookings');
    expect(unauth.status).toBe(401);

    // Renter registration with Ethiopian 09 phone
    const renterReg = await req('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'Sara Tadesse',
        contact: '0911223344',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        role: 'renter',
        city: 'Addis Ababa',
        termsAccepted: true,
      }),
    });
    expect(renterReg.status).toBe(201);
    expect(renterReg.json.user.phone).toBe('+251911223344');
    expect(renterReg.json.requiresServicePassPayment).toBe(true);
    expect(renterReg.json.servicePassAmountEtb).toBe(50);
    expect(renterReg.json.servicePassDurationDays).toBe(30);
    expect(renterReg.json.user.subscription_status).toBe('pending_payment');
    expect(renterReg.json.user.subscription_active).toBe(false);
    renterToken = renterReg.json.token;
    renterId = renterReg.json.user.id;

    // OTP send & wrong attempt & valid verify
    const otpSend = await req('/api/auth/otp/send', {
      method: 'POST',
      body: JSON.stringify({ contact: '0911223344', purpose: 'verify' }),
    });
    expect(otpSend.status).toBe(200);
    expect(otpSend.json.previewCode).toHaveLength(6);

    const wrongOtp = await req('/api/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ contact: '0911223344', code: '000000' }),
    });
    expect(wrongOtp.status).toBe(400);

    const rightOtp = await req('/api/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ contact: '0911223344', code: otpSend.json.previewCode }),
    });
    expect(rightOtp.status).toBe(200);
    expect(rightOtp.json.user.phone_verified).toBe(1);

    // Unpaid renter cannot book or start chat (402 SUBSCRIPTION_REQUIRED)
    const unpaidBook = await req(
      '/api/bookings',
      {
        method: 'POST',
        body: JSON.stringify({ listingId: 1, startDate: '2026-12-01', endDate: '2026-12-03' }),
      },
      renterToken
    );
    expect(unpaidBook.status).toBe(402);
    expect(unpaidBook.json.code).toBe('SUBSCRIPTION_REQUIRED');

    const unpaidConv = await req(
      '/api/conversations',
      { method: 'POST', body: JSON.stringify({ listingId: 1 }) },
      renterToken
    );
    expect(unpaidConv.status).toBe(402);
    expect(unpaidConv.json.code).toBe('SUBSCRIPTION_REQUIRED');

    // Landlord registration
    const llReg = await req('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'Kebede Alemu',
        contact: 'kebede.landlord@example.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        role: 'landlord',
        city: 'Adama',
        accountType: 'business',
        businessName: 'Kebede Properties',
        termsAccepted: true,
      }),
    });
    expect(llReg.status).toBe(201);
    expect(llReg.json.user.subscription_active).toBe(false);
    landlordToken = llReg.json.token;
    landlordId = llReg.json.user.id;

    // Unpaid landlord cannot post a listing (402 SUBSCRIPTION_REQUIRED)
    const unpaidPost = await req(
      '/api/listings',
      { method: 'POST', body: new FormData() },
      landlordToken
    );
    expect(unpaidPost.status).toBe(402);
    expect(unpaidPost.json.code).toBe('SUBSCRIPTION_REQUIRED');

    // Renter cannot access admin routes
    const forbiddenAdmin = await req('/api/admin/analytics', {}, renterToken);
    expect(forbiddenAdmin.status).toBe(403);
  });

  it('claims Super Admin once, activates 50 ETB 1-month passes via receipt approval, enforces image limits, and moderates listing', async () => {
    const boot = await req('/api/auth/admin-bootstrap', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'AZ Super Admin',
        email: 'super@azrental.et',
        password: 'AdminPassword123!',
      }),
    });
    expect(boot.status).toBe(200);
    expect(boot.json.user.subscription_status).toBe('exempt');
    expect(boot.json.user.subscription_active).toBe(true);
    adminToken = boot.json.token;

    // Second claim must fail
    const secondBoot = await req('/api/auth/admin-bootstrap', {
      method: 'POST',
      body: JSON.stringify({ fullName: 'Hacker', email: 'h@x.com', password: 'AdminPassword123!' }),
    });
    expect(secondBoot.status).toBe(409);

    // Renter & Landlord submit 50 ETB Telebirr transfer receipts
    const rReceiptFd = new FormData();
    rReceiptFd.append('provider', 'telebirr');
    rReceiptFd.append('providerRef', 'TB-RENTER-50ETB-001');
    rReceiptFd.append('senderPhone', '0911223344');
    const rReceipt = await req('/api/subscription/submit-receipt', { method: 'POST', body: rReceiptFd }, renterToken);
    expect(rReceipt.status).toBe(201);
    expect(rReceipt.json.payment.amount).toBe(50);
    expect(rReceipt.json.payment.purpose).toBe('registration_fee');

    const lReceiptFd = new FormData();
    lReceiptFd.append('provider', 'cbe_birr');
    lReceiptFd.append('providerRef', 'CBE-OWNER-50ETB-002');
    lReceiptFd.append('senderPhone', '0922334455');
    const lReceipt = await req('/api/subscription/submit-receipt', { method: 'POST', body: lReceiptFd }, landlordToken);
    expect(lReceipt.status).toBe(201);
    expect(lReceipt.json.payment.amount).toBe(50);

    // Admin approves both 50 ETB payments -> 30-day active passes
    const approveR = await req(
      `/api/admin/subscriptions/approve-payment/${rReceipt.json.payment.id}`,
      { method: 'POST' },
      adminToken
    );
    expect(approveR.status).toBe(200);

    const approveL = await req(
      `/api/admin/subscriptions/approve-payment/${lReceipt.json.payment.id}`,
      { method: 'POST' },
      adminToken
    );
    expect(approveL.status).toBe(200);

    const rStatus = await req('/api/subscription/status', {}, renterToken);
    expect(rStatus.status).toBe(200);
    expect(rStatus.json.user.subscription_status).toBe('active');
    expect(rStatus.json.user.subscription_active).toBe(true);
    expect(rStatus.json.user.subscription_days_remaining).toBeGreaterThanOrEqual(29);

    const lStatus = await req('/api/subscription/status', {}, landlordToken);
    expect(lStatus.status).toBe(200);
    expect(lStatus.json.user.subscription_active).toBe(true);

    // Create sample JPEG buffer
    const jpegBuf = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 30, g: 80, b: 140 } },
    })
      .jpeg()
      .toBuffer();

    // Reject 0 images
    const zeroForm = new FormData();
    zeroForm.append('title', 'No Image Listing');
    zeroForm.append('categoryId', '1');
    zeroForm.append('description', 'Should fail without image');
    zeroForm.append('city', 'Addis Ababa');
    const zeroRes = await req('/api/listings', { method: 'POST', body: zeroForm }, landlordToken);
    expect(zeroRes.status).toBe(400);

    // Reject > 10 images
    const elevenForm = new FormData();
    elevenForm.append('title', 'Too Many Images');
    elevenForm.append('categoryId', '1');
    elevenForm.append('description', 'Should fail with 11 images');
    elevenForm.append('city', 'Addis Ababa');
    for (let i = 0; i < 11; i++) {
      elevenForm.append('images', new File([jpegBuf], `img${i}.jpg`, { type: 'image/jpeg' }));
    }
    const elevenRes = await req('/api/listings', { method: 'POST', body: elevenForm }, landlordToken);
    expect(elevenRes.status).toBe(400);

    // Valid 1-image listing upload with AZ RENTAL watermark
    const validForm = new FormData();
    validForm.append('title', 'Sunny Bole Condo');
    validForm.append('categoryId', '1');
    validForm.append('description', 'Clean modern condo in Bole');
    validForm.append('priceDaily', '2500');
    validForm.append('priceMonthly', '45000');
    validForm.append('city', 'Addis Ababa');
    validForm.append('subCity', 'Bole');
    validForm.append('images', new File([jpegBuf], 'bole.jpg', { type: 'image/jpeg' }));

    const createRes = await req('/api/listings', { method: 'POST', body: validForm }, landlordToken);
    expect(createRes.status).toBe(201);
    createdListingId = createRes.json.listing.id;
    expect(createRes.json.listing.images[0].is_watermarked).toBe(1);

    // Admin approves listing
    const modRes = await req(
      `/api/admin/listings/${createdListingId}/moderate`,
      { method: 'PATCH', body: JSON.stringify({ status: 'approved', isVerified: true }) },
      adminToken
    );
    expect(modRes.status).toBe(200);
  });

  it('prevents double booking, enforces written agreement before payment, and blocks unconfigured fake payments', async () => {
    // Renter requests booking
    const b1 = await req(
      '/api/bookings',
      {
        method: 'POST',
        body: JSON.stringify({
          listingId: createdListingId,
          startDate: '2026-12-01',
          endDate: '2026-12-05',
          durationType: 'daily',
        }),
      },
      renterToken
    );
    expect(b1.status).toBe(201);
    createdBookingId = b1.json.booking.id;

    // Landlord accepts booking
    const acc = await req(
      `/api/bookings/${createdBookingId}/respond`,
      { method: 'PATCH', body: JSON.stringify({ decision: 'accept' }) },
      landlordToken
    );
    expect(acc.status).toBe(200);
    expect(acc.json.booking.status).toBe('Awaiting Payment');

    // Overlapping booking must be rejected with 409 Conflict
    const overlap = await req(
      '/api/bookings',
      {
        method: 'POST',
        body: JSON.stringify({
          listingId: createdListingId,
          startDate: '2026-12-03',
          endDate: '2026-12-07',
          durationType: 'daily',
        }),
      },
      renterToken
    );
    expect(overlap.status).toBe(409);

    // Payment before signing agreement must be rejected (400)
    const payBeforeSign = await req(
      '/api/payments/initiate',
      {
        method: 'POST',
        body: JSON.stringify({ bookingId: createdBookingId, provider: 'chapa' }),
      },
      renterToken
    );
    expect(payBeforeSign.status).toBe(400);

    // Sign agreement
    const sign = await req(
      `/api/bookings/${createdBookingId}/sign`,
      { method: 'PATCH', body: JSON.stringify({ signatureName: 'Sara Tadesse' }) },
      renterToken
    );
    expect(sign.status).toBe(200);
    expect(sign.json.booking.agreement_signed_by_renter).toBe(1);

    // Payment with unconfigured Chapa must truthfully return 503 (no simulated fake success)
    const payUnconfigured = await req(
      '/api/payments/initiate',
      {
        method: 'POST',
        body: JSON.stringify({ bookingId: createdBookingId, provider: 'chapa' }),
      },
      renterToken
    );
    expect(payUnconfigured.status).toBe(503);

    // Search with overlapping date range excludes booked listing
    const availSearch = await req('/api/listings?startDate=2026-12-02&endDate=2026-12-04');
    expect(availSearch.status).toBe(200);
    expect(availSearch.json.listings.some((l: any) => l.id === createdListingId)).toBe(false);
  });

  it('supports real-time conversations, messaging, admin audit logs, and monthly 50 ETB renewal without re-registration', async () => {
    const conv = await req(
      '/api/conversations',
      { method: 'POST', body: JSON.stringify({ listingId: createdListingId }) },
      renterToken
    );
    expect(conv.status).toBe(201);

    const msg = await req(
      `/api/conversations/${conv.json.conversation.id}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'Selam, is Bole condo available?' }) },
      renterToken
    );
    expect(msg.status).toBe(201);

    const logs = await req('/api/admin/audit-logs', {}, adminToken);
    expect(logs.status).toBe(200);
    expect(logs.json.logs.length).toBeGreaterThan(0);

    // Simulate 1 month elapsing on renter's pass
    dbRef
      .prepare(`UPDATE users SET subscription_expires_at = datetime('now', '-2 days') WHERE id = ?`)
      .run(renterId);
    dbRef
      .prepare(`UPDATE subscriptions SET ends_at = datetime('now', '-2 days') WHERE user_id = ?`)
      .run(renterId);

    // Same existing user logs in (NO new registration)
    const reLogin = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ contact: '0911223344', password: 'Password123!' }),
    });
    expect(reLogin.status).toBe(200);
    expect(reLogin.json.user.id).toBe(renterId);
    expect(reLogin.json.user.subscription_status).toBe('expired');
    expect(reLogin.json.user.subscription_active).toBe(false);
    expect(reLogin.json.user.has_prior_subscription).toBe(true);
    const renewedToken = reLogin.json.token;

    // Expired user gets 402 with needsRenewal: true
    const expiredChat = await req(
      `/api/conversations/${conv.json.conversation.id}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'Should fail until renewed' }) },
      renewedToken
    );
    expect(expiredChat.status).toBe(402);
    expect(expiredChat.json.code).toBe('SUBSCRIPTION_REQUIRED');
    expect(expiredChat.json.needsRenewal).toBe(true);
    expect(expiredChat.json.amountEtb).toBe(50);

    // Pay 50 ETB monthly service renewal on existing account
    const renewFd = new FormData();
    renewFd.append('provider', 'telebirr');
    renewFd.append('providerRef', 'TB-RENEWAL-50ETB-003');
    const renewReceipt = await req('/api/subscription/submit-receipt', { method: 'POST', body: renewFd }, renewedToken);
    expect(renewReceipt.status).toBe(201);
    expect(renewReceipt.json.payment.purpose).toBe('monthly_service_renewal');
    expect(renewReceipt.json.payment.amount).toBe(50);

    const approveRenew = await req(
      `/api/admin/subscriptions/approve-payment/${renewReceipt.json.payment.id}`,
      { method: 'POST' },
      adminToken
    );
    expect(approveRenew.status).toBe(200);

    // Service restored for another 30 days on the same user account
    const restoredStatus = await req('/api/subscription/status', {}, renewedToken);
    expect(restoredStatus.status).toBe(200);
    expect(restoredStatus.json.user.subscription_status).toBe('active');
    expect(restoredStatus.json.user.subscription_active).toBe(true);

    const msgAfterRenew = await req(
      `/api/conversations/${conv.json.conversation.id}/messages`,
      { method: 'POST', body: JSON.stringify({ content: 'Renewed 50 ETB pass — still interested!' }) },
      renewedToken
    );
    expect(msgAfterRenew.status).toBe(201);
    expect(landlordId).toBeGreaterThan(0);
  });
});

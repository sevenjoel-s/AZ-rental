import crypto from 'crypto';
import { db, getServiceFeeConfig, writeAuditLog } from './db.ts';
import { createNotification } from './realtime.ts';

export interface PaymentProviderStatus {
  id: 'telebirr' | 'chapa' | 'cbe_birr';
  name: string;
  nameAm: string;
  configured: boolean;
  requiredEnvVars: string[];
  description: string;
}

export function getPaymentProviders(): PaymentProviderStatus[] {
  const telebirrConfigured = Boolean(
    process.env.TELEBIRR_APP_ID &&
      process.env.TELEBIRR_APP_KEY &&
      process.env.TELEBIRR_SHORT_CODE
  );
  const chapaConfigured = Boolean(process.env.CHAPA_SECRET_KEY);
  const cbeConfigured = Boolean(
    process.env.CBE_BIRR_MERCHANT_ID && process.env.CBE_BIRR_API_KEY
  );

  return [
    {
      id: 'telebirr',
      name: 'Telebirr Merchant Pay',
      nameAm: 'ቴሌብር (Telebirr)',
      configured: telebirrConfigured,
      requiredEnvVars: ['TELEBIRR_APP_ID', 'TELEBIRR_APP_KEY', 'TELEBIRR_SHORT_CODE'],
      description: 'Ethio Telecom Telebirr H5 / App merchant checkout in ETB.',
    },
    {
      id: 'chapa',
      name: 'Chapa Ethiopia',
      nameAm: 'ቻፓ (Chapa)',
      configured: chapaConfigured,
      requiredEnvVars: ['CHAPA_SECRET_KEY', 'CHAPA_WEBHOOK_SECRET'],
      description: 'Chapa unified checkout (CBE, Telebirr, Amole, Visa/Mastercard) in ETB.',
    },
    {
      id: 'cbe_birr',
      name: 'CBE Birr Direct',
      nameAm: 'ሲቢኢ ብር (CBE Birr)',
      configured: cbeConfigured,
      requiredEnvVars: ['CBE_BIRR_MERCHANT_ID', 'CBE_BIRR_API_KEY'],
      description: 'Commercial Bank of Ethiopia authorized merchant gateway.',
    },
  ];
}

export function activateUserServicePass(params: {
  userId: number;
  paymentId?: number | null;
  amount: number;
  durationDays?: number;
  kind?: 'initial' | 'renewal' | 'admin_grant';
  notes?: string;
}): { startsAt: string; endsAt: string; subscriptionId: number } {
  const cfg = getServiceFeeConfig();
  const durationDays = params.durationDays ?? cfg.durationDays;
  const userRow = db
    .prepare(`SELECT id, subscription_expires_at FROM users WHERE id = ?`)
    .get(params.userId) as any;
  const priorCountRow = db
    .prepare(`SELECT COUNT(*) as c FROM subscriptions WHERE user_id = ?`)
    .get(params.userId) as any;
  const isRenewal = Number(priorCountRow?.c || 0) > 0;
  const kind = params.kind || (isRenewal ? 'renewal' : 'initial');

  const nowMs = Date.now();
  let baseMs = nowMs;
  if (userRow?.subscription_expires_at) {
    const iso = userRow.subscription_expires_at.includes('T')
      ? userRow.subscription_expires_at
      : `${userRow.subscription_expires_at.replace(' ', 'T')}Z`;
    const curMs = Date.parse(iso);
    if (!Number.isNaN(curMs) && curMs > nowMs) {
      baseMs = curMs;
    }
  }

  const startsAt = new Date(nowMs).toISOString();
  const endsAt = new Date(baseMs + durationDays * 86_400_000).toISOString();

  const subscriptionId = db.transaction(() => {
    // Idempotency guard if paymentId was already activated
    if (params.paymentId) {
      const existingSub = db
        .prepare(`SELECT id, starts_at, ends_at FROM subscriptions WHERE payment_id = ?`)
        .get(params.paymentId) as any;
      if (existingSub) {
        return Number(existingSub.id);
      }
    }

    db.prepare(
      `UPDATE subscriptions SET status = 'superseded' WHERE user_id = ? AND status = 'active'`
    ).run(params.userId);

    const ins = db
      .prepare(
        `INSERT INTO subscriptions (user_id, plan_name, amount, currency, status, starts_at, ends_at, payment_id, kind)
         VALUES (?, ?, ?, 'ETB', 'active', ?, ?, ?, ?)`
      )
      .run(
        params.userId,
        `Monthly Service Pass (${durationDays} days)`,
        params.amount,
        startsAt,
        endsAt,
        params.paymentId ?? null,
        kind
      );

    db.prepare(
      `UPDATE users SET subscription_status = 'active', subscription_expires_at = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(endsAt, params.userId);

    return Number(ins.lastInsertRowid);
  })();

  const formattedDate = endsAt.slice(0, 10);
  createNotification({
    userId: params.userId,
    type: 'service_pass_active',
    title: kind === 'renewal' ? 'Monthly Service Pass Renewed (50 ETB)' : '1-Month AZ RENTAL Service Pass Active',
    body: `Your ${durationDays}-day AZ RENTAL service pass is active until ${formattedDate}.`,
    titleAm: kind === 'renewal' ? 'የወር አገልግሎት ክፍያዎ ታድሷል (50 ብር)' : 'የ1 ወር AZ RENTAL አገልግሎትዎ ተከፍቷል',
    bodyAm: `የ ${durationDays} ቀን የ AZ RENTAL አገልግሎትዎ እስከ ${formattedDate} ድረስ ክፍት ነው።`,
    link: '/dashboard',
  });

  return { startsAt, endsAt, subscriptionId };
}

function appendTxRef(urlStr: string, txRef: string): string {
  const sep = urlStr.includes('?') ? '&' : '?';
  return `${urlStr}${sep}tx_ref=${encodeURIComponent(txRef)}`;
}

export async function initiateEthiopianPayment(params: {
  bookingId?: number | null;
  userId: number;
  provider: 'telebirr' | 'chapa' | 'cbe_birr';
  amount: number;
  purpose: string;
  email: string;
  phone: string;
  fullName: string;
  returnUrl: string;
  callbackUrl: string;
}): Promise<{
  ok: boolean;
  statusCode: number;
  paymentId?: number;
  txRef?: string;
  checkoutUrl?: string;
  error?: string;
  missingEnvVars?: string[];
}> {
  const providers = getPaymentProviders();
  const adapter = providers.find((p) => p.id === params.provider);
  if (!adapter) {
    return { ok: false, statusCode: 400, error: 'Unsupported payment provider.' };
  }

  const txRef = `AZR-${params.provider.toUpperCase()}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const fullReturnUrl = appendTxRef(params.returnUrl, txRef);

  if (!adapter.configured) {
    // Record honest failed/unconfigured payment attempt audit without simulating success
    const res = db
      .prepare(
        `INSERT INTO payments (booking_id, user_id, provider, amount, currency, purpose, tx_ref, status, failure_reason)
         VALUES (?, ?, ?, ?, 'ETB', ?, ?, 'failed', ?)`
      )
      .run(
        params.bookingId ?? null,
        params.userId,
        params.provider,
        params.amount,
        params.purpose,
        txRef,
        `Merchant credentials not configured (${adapter.requiredEnvVars.join(', ')})`
      );

    writeAuditLog({
      actorId: params.userId,
      action: 'payment.initiate_blocked_unconfigured',
      targetType: 'payment',
      targetId: Number(res.lastInsertRowid),
      details: { provider: params.provider, amount: params.amount, purpose: params.purpose, missing: adapter.requiredEnvVars },
    });

    return {
      ok: false,
      statusCode: 503,
      paymentId: Number(res.lastInsertRowid),
      txRef,
      missingEnvVars: adapter.requiredEnvVars,
      error: `${adapter.name} merchant API credentials are not configured on the server yet. Submit a Telebirr/CBE transfer reference below for admin verification, or configure ${adapter.requiredEnvVars.join(', ')}.`,
    };
  }

  // Create pending payment record first to prevent duplicates
  const payRes = db
    .prepare(
      `INSERT INTO payments (booking_id, user_id, provider, amount, currency, purpose, tx_ref, status)
       VALUES (?, ?, ?, ?, 'ETB', ?, ?, 'pending')`
    )
    .run(params.bookingId ?? null, params.userId, params.provider, params.amount, params.purpose, txRef);
  const paymentId = Number(payRes.lastInsertRowid);

  try {
    if (params.provider === 'chapa') {
      const [firstName, ...rest] = (params.fullName || 'AZ User').split(' ');
      const response = await fetch('https://api.chapa.co/v1/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: String(params.amount),
          currency: 'ETB',
          email: params.email || 'customer@azrental.et',
          first_name: firstName,
          last_name: rest.join(' ') || 'Renter',
          phone_number: params.phone,
          tx_ref: txRef,
          callback_url: params.callbackUrl,
          return_url: fullReturnUrl,
          customization: {
            title: 'AZ RENTAL Payment',
            description: params.purpose,
          },
        }),
      });
      const data = (await response.json()) as any;
      if (!response.ok || data.status !== 'success' || !data.data?.checkout_url) {
        db.prepare(`UPDATE payments SET status = 'failed', failure_reason = ? WHERE id = ?`).run(
          data.message || 'Chapa initialization failed',
          paymentId
        );
        return {
          ok: false,
          statusCode: 502,
          paymentId,
          txRef,
          error: data.message || 'Chapa gateway rejected initialization.',
        };
      }
      db.prepare(`UPDATE payments SET metadata_json = ? WHERE id = ?`).run(JSON.stringify(data), paymentId);
      return {
        ok: true,
        statusCode: 200,
        paymentId,
        txRef,
        checkoutUrl: data.data.checkout_url,
      };
    }

    if (params.provider === 'telebirr') {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = crypto.randomBytes(16).toString('hex');
      const payload = {
        appId: process.env.TELEBIRR_APP_ID,
        shortCode: process.env.TELEBIRR_SHORT_CODE,
        outTradeNo: txRef,
        subject: `AZ RENTAL ${params.purpose}`,
        totalAmount: String(params.amount),
        notifyUrl: params.callbackUrl,
        returnUrl: fullReturnUrl,
        timestamp,
        nonce,
      };
      const endpoint = process.env.TELEBIRR_API_URL || 'https://api.ethiotelecom.et/payment/v1/h5/createOrder';
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-APP-Key': process.env.TELEBIRR_APP_KEY || '',
        },
        body: JSON.stringify(payload),
      });
      const data = (await resp.json()) as any;
      if (!resp.ok || !data.toPayUrl) {
        db.prepare(`UPDATE payments SET status = 'failed', failure_reason = ? WHERE id = ?`).run(
          data.msg || 'Telebirr gateway error',
          paymentId
        );
        return { ok: false, statusCode: 502, paymentId, txRef, error: data.msg || 'Telebirr rejected request.' };
      }
      return { ok: true, statusCode: 200, paymentId, txRef, checkoutUrl: data.toPayUrl };
    }

    // CBE Birr adapter
    const cbeEndpoint = process.env.CBE_BIRR_API_URL || 'https://api.cbe.com.et/cbebirr/v1/checkout';
    const resp = await fetch(cbeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Merchant-Id': process.env.CBE_BIRR_MERCHANT_ID || '',
        Authorization: `Bearer ${process.env.CBE_BIRR_API_KEY}`,
      },
      body: JSON.stringify({
        reference: txRef,
        amount: params.amount,
        currency: 'ETB',
        callbackUrl: params.callbackUrl,
        returnUrl: fullReturnUrl,
      }),
    });
    const data = (await resp.json()) as any;
    if (!resp.ok || !data.checkoutUrl) {
      db.prepare(`UPDATE payments SET status = 'failed', failure_reason = ? WHERE id = ?`).run(
        data.message || 'CBE Birr error',
        paymentId
      );
      return { ok: false, statusCode: 502, paymentId, txRef, error: data.message || 'CBE Birr rejected request.' };
    }
    return { ok: true, statusCode: 200, paymentId, txRef, checkoutUrl: data.checkoutUrl };
  } catch (err: any) {
    db.prepare(`UPDATE payments SET status = 'failed', failure_reason = ? WHERE id = ?`).run(
      err?.message || 'Network error',
      paymentId
    );
    return {
      ok: false,
      statusCode: 502,
      paymentId,
      txRef,
      error: `Payment gateway unreachable: ${err?.message || 'network error'}`,
    };
  }
}

function finalizePaidPayment(payment: any, providerRef: string, note: string): void {
  db.transaction(() => {
    db.prepare(`UPDATE payments SET status = 'paid', provider_ref = ?, verified_at = datetime('now') WHERE id = ?`).run(
      providerRef,
      payment.id
    );
    db.prepare(
      `INSERT INTO transactions (payment_id, type, amount, currency, reference, status, notes)
       VALUES (?, 'credit', ?, 'ETB', ?, 'completed', ?)`
    ).run(payment.id, payment.amount, providerRef, note);
    if (payment.booking_id) {
      db.prepare(`UPDATE bookings SET status = 'Confirmed', updated_at = datetime('now') WHERE id = ?`).run(
        payment.booking_id
      );
    }
  })();

  if (payment.purpose === 'registration_fee' || payment.purpose === 'monthly_service_renewal') {
    activateUserServicePass({
      userId: payment.user_id,
      paymentId: payment.id,
      amount: Number(payment.amount),
      kind: payment.purpose === 'monthly_service_renewal' ? 'renewal' : 'initial',
      notes: note,
    });
  }
}

export async function verifyWebhookAndComplete(params: {
  provider: 'telebirr' | 'chapa' | 'cbe_birr';
  rawBody: string;
  signatureHeader: string | undefined;
  txRef: string;
}): Promise<{ ok: boolean; statusCode: number; message: string }> {
  const payment = db.prepare('SELECT * FROM payments WHERE tx_ref = ?').get(params.txRef) as any;
  if (!payment) {
    return { ok: false, statusCode: 404, message: 'Transaction reference not found' };
  }
  if (payment.status === 'paid') {
    if (payment.purpose === 'registration_fee' || payment.purpose === 'monthly_service_renewal') {
      activateUserServicePass({
        userId: payment.user_id,
        paymentId: payment.id,
        amount: Number(payment.amount),
        kind: payment.purpose === 'monthly_service_renewal' ? 'renewal' : 'initial',
      });
    }
    return { ok: true, statusCode: 200, message: 'Already verified (idempotent)' };
  }

  if (params.provider === 'chapa') {
    const secret = process.env.CHAPA_WEBHOOK_SECRET || process.env.CHAPA_SECRET_KEY;
    if (!secret || !params.signatureHeader) {
      return { ok: false, statusCode: 401, message: 'Missing webhook signature or secret' };
    }
    const expected = crypto.createHmac('sha256', secret).update(params.rawBody).digest('hex');
    if (
      expected.length !== params.signatureHeader.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(params.signatureHeader))
    ) {
      return { ok: false, statusCode: 401, message: 'Invalid webhook signature' };
    }

    const verifyResp = await fetch(`https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(params.txRef)}`, {
      headers: { Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}` },
    });
    const verifyJson = (await verifyResp.json()) as any;
    if (!verifyResp.ok || verifyJson.status !== 'success' || Number(verifyJson.data?.amount) < Number(payment.amount)) {
      return { ok: false, statusCode: 400, message: 'Server-side verification failed' };
    }

    finalizePaidPayment(
      payment,
      verifyJson.data?.reference || params.txRef,
      'Verified Chapa webhook payment'
    );
    return { ok: true, statusCode: 200, message: 'Payment verified and activated' };
  }

  // Telebirr / CBE Birr signature verification
  const sharedKey =
    params.provider === 'telebirr' ? process.env.TELEBIRR_APP_KEY : process.env.CBE_BIRR_API_KEY;
  if (!sharedKey || !params.signatureHeader) {
    return { ok: false, statusCode: 401, message: 'Missing provider signature or key' };
  }
  const expected = crypto.createHmac('sha256', sharedKey).update(params.rawBody).digest('hex');
  if (
    expected.length !== params.signatureHeader.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(params.signatureHeader))
  ) {
    return { ok: false, statusCode: 401, message: 'Invalid provider signature' };
  }

  finalizePaidPayment(payment, params.txRef, `Verified ${params.provider} payment`);
  return { ok: true, statusCode: 200, message: 'Payment verified' };
}

export async function verifyGatewayPaymentByTxRef(
  txRef: string,
  userId: number
): Promise<{ ok: boolean; statusCode: number; status: string; message: string }> {
  const payment = db.prepare('SELECT * FROM payments WHERE tx_ref = ? AND user_id = ?').get(txRef, userId) as any;
  if (!payment) {
    return { ok: false, statusCode: 404, status: 'not_found', message: 'Payment transaction not found.' };
  }
  if (payment.status === 'paid') {
    if (payment.purpose === 'registration_fee' || payment.purpose === 'monthly_service_renewal') {
      activateUserServicePass({
        userId: payment.user_id,
        paymentId: payment.id,
        amount: Number(payment.amount),
        kind: payment.purpose === 'monthly_service_renewal' ? 'renewal' : 'initial',
      });
    }
    return { ok: true, statusCode: 200, status: 'paid', message: 'Payment verified and service pass active.' };
  }

  if (payment.provider === 'chapa' && process.env.CHAPA_SECRET_KEY) {
    try {
      const verifyResp = await fetch(`https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(txRef)}`, {
        headers: { Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}` },
      });
      const verifyJson = (await verifyResp.json()) as any;
      if (verifyResp.ok && verifyJson.status === 'success' && Number(verifyJson.data?.amount) >= Number(payment.amount)) {
        finalizePaidPayment(payment, verifyJson.data?.reference || txRef, 'Verified Chapa return checkout');
        return { ok: true, statusCode: 200, status: 'paid', message: 'Chapa payment verified and service pass activated.' };
      }
      return { ok: false, statusCode: 400, status: payment.status, message: verifyJson.message || 'Chapa payment not yet confirmed.' };
    } catch {
      return { ok: false, statusCode: 502, status: payment.status, message: 'Unable to reach Chapa verification API.' };
    }
  }

  return {
    ok: false,
    statusCode: 202,
    status: payment.status,
    message:
      payment.status === 'pending_verification'
        ? 'Transfer receipt is awaiting administrator verification.'
        : 'Payment is awaiting gateway webhook confirmation.',
  };
}

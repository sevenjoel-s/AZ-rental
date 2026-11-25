import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  CreditCard,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { LanguageCode, PaymentProvider, ServiceFeeConfig, User } from '../types';

interface PanelProps {
  user: User;
  lang: LanguageCode;
  onUserUpdated: (user: User) => void;
  onDone?: () => void;
}

export const ServicePassPanel: React.FC<PanelProps> = ({ user, lang, onUserUpdated, onDone }) => {
  const [config, setConfig] = useState<ServiceFeeConfig>({ amountEtb: 50, durationDays: 30 });
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<'telebirr' | 'chapa' | 'cbe_birr'>('telebirr');

  const [manualProvider, setManualProvider] = useState<'telebirr' | 'cbe_birr' | 'chapa'>('telebirr');
  const [providerRef, setProviderRef] = useState('');
  const [senderPhone, setSenderPhone] = useState(user.phone || '');
  const [notes, setNotes] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const loadStatus = async () => {
    try {
      const [sRes, pRes] = await Promise.all([
        apiFetch<{
          user: User;
          config: ServiceFeeConfig;
          subscriptions: any[];
          pendingPayments: any[];
        }>('/api/subscription/status'),
        apiFetch<{ providers: PaymentProvider[] }>('/api/payments/providers'),
      ]);
      if (sRes.user) onUserUpdated(sRes.user);
      if (sRes.config) setConfig(sRes.config);
      setSubscriptions(sRes.subscriptions || []);
      setPayments(sRes.pendingPayments || []);
      setProviders(pRes.providers || []);
    } catch {
      // handled gracefully
    }
  };

  useEffect(() => {
    loadStatus();
  }, [user.id]);

  const isRenewal = user.has_prior_subscription || user.subscription_status === 'expired';
  const hasPendingVerification = payments.some((p) => p.status === 'pending_verification');

  const handleOnlinePay = async () => {
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await apiFetch<{ checkoutUrl?: string; txRef?: string; error?: string }>('/api/subscription/pay', {
        method: 'POST',
        body: JSON.stringify({ provider: selectedProvider }),
      });
      if (res.checkoutUrl) {
        window.location.assign(res.checkoutUrl);
      } else {
        setInfo('Checkout initialized. Complete payment in the gateway window.');
      }
    } catch (err: any) {
      setError(err.message);
      loadStatus();
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setSubmittingReceipt(true);
    try {
      const fd = new FormData();
      fd.append('provider', manualProvider);
      fd.append('providerRef', providerRef.trim());
      fd.append('senderPhone', senderPhone.trim());
      fd.append('notes', notes.trim());
      if (receiptFile) fd.append('receipt', receiptFile);

      const res = await apiFetch<{ message: string }>('/api/subscription/submit-receipt', {
        method: 'POST',
        body: fd,
      });
      setInfo(res.message);
      setProviderRef('');
      setNotes('');
      setReceiptFile(null);
      await loadStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmittingReceipt(false);
    }
  };

  const expiryDisplay = user.subscription_expires_at
    ? new Date(
        user.subscription_expires_at.includes('T')
          ? user.subscription_expires_at
          : `${user.subscription_expires_at.replace(' ', 'T')}Z`
      ).toLocaleDateString()
    : null;

  return (
    <div className="space-y-5">
      {/* Status Banner */}
      <div
        className={`rounded-2xl border p-4 ${
          user.subscription_active
            ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/30'
            : user.subscription_status === 'expired'
            ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
            : 'border-[#123B65]/20 bg-[#123B65]/5 dark:border-slate-700 dark:bg-slate-800/60'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            {user.subscription_active ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-[#F5A623] shrink-0 mt-0.5" />
            )}
            <div>
              <h3 className="text-sm font-bold text-[#123B65] dark:text-white">
                {user.subscription_status === 'exempt'
                  ? 'Administrator Exempt Access'
                  : user.subscription_active
                  ? `Active 1-Month Service Pass (${user.subscription_days_remaining} days left)`
                  : isRenewal
                  ? `Service Pass Expired — Pay ${config.amountEtb} ETB to Continue`
                  : `Registration Fee Required: ${config.amountEtb} ETB for 1 Month (${config.durationDays} Days)`}
              </h3>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {user.subscription_active
                  ? `Your account can post rentals, send booking/viewing requests, chat, and place audio/video calls${expiryDisplay ? ` until ${expiryDisplay}` : ''}. Paying ${config.amountEtb} ETB adds another ${config.durationDays} days to your pass.`
                  : isRenewal
                  ? `No new registration is needed. Sign in to your existing account and pay ${config.amountEtb} ETB for the next ${config.durationDays} days to continue using AZ RENTAL.`
                  : lang === 'am'
                  ? `ሲመዘገቡ ${config.amountEtb} ብር ለ ${config.durationDays} ቀን (1 ወር) አገልግሎት ይከፍላሉ። ከ1 ወር በኋላ አዲስ ምዝገባ ሳያስፈልግ ${config.amountEtb} ብር በመክፈል አገልግሎቱን ይቀጥላሉ።`
                  : `Every member pays ${config.amountEtb} ETB on registration for 1 month (${config.durationDays} days). After 1 month, pay ${config.amountEtb} ETB service renewal to continue — no new registration required.`}
              </p>
            </div>
          </div>

          <div className="shrink-0 text-right tabular-nums">
            <div className="text-lg font-extrabold text-[#123B65] dark:text-[#F5A623]">
              ETB {config.amountEtb}
            </div>
            <div className="text-[11px] text-slate-500">per {config.durationDays} days</div>
          </div>
        </div>
      </div>

      {hasPendingVerification && !user.subscription_active && (
        <div className="flex items-center gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
          <Clock className="h-4 w-4 shrink-0" />
          <span>
            You have a transfer receipt pending administrator verification. Once approved, your {config.durationDays}-day service pass activates automatically.
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
          {info}
        </div>
      )}

      {user.subscription_status !== 'exempt' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Method 1: Online Ethiopian Gateway Checkout */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-xs font-bold text-[#123B65] dark:text-white">
                <CreditCard className="h-4 w-4 text-[#F5A623]" />
                {isRenewal ? `Option 1: Instant Renewal (${config.amountEtb} ETB)` : `Option 1: Online Gateway (${config.amountEtb} ETB)`}
              </h4>
            </div>
            <div className="space-y-2">
              {providers.map((p) => (
                <label
                  key={p.id}
                  className={`flex items-center justify-between rounded-xl border p-2.5 text-xs cursor-pointer ${
                    selectedProvider === p.id
                      ? 'border-[#123B65] bg-[#123B65]/5 dark:border-[#F5A623]'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="passProvider"
                      checked={selectedProvider === p.id}
                      onChange={() => setSelectedProvider(p.id)}
                    />
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">{p.name}</div>
                      <div className="text-[10px] text-slate-500">{p.nameAm}</div>
                    </div>
                  </div>
                  <span className={`text-[10px] font-semibold ${p.configured ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {p.configured ? 'Live Ready' : 'Needs Merchant Keys'}
                  </span>
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={handleOnlinePay}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#123B65] py-2.5 text-xs font-bold text-white hover:bg-[#0e2e4f] disabled:opacity-60"
            >
              <CreditCard className="h-4 w-4 text-[#F5A623]" />
              {loading
                ? 'Connecting Gateway...'
                : isRenewal
                ? `Renew ${config.amountEtb} ETB Service Pass`
                : `Pay ${config.amountEtb} ETB Registration Pass`}
            </button>
          </div>

          {/* Method 2: Telebirr / CBE Direct Transfer Reference Submission */}
          <form
            onSubmit={handleSubmitReceipt}
            className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <h4 className="flex items-center gap-2 text-xs font-bold text-[#123B65] dark:text-white">
              <Receipt className="h-4 w-4 text-[#F5A623]" />
              Option 2: Submit Telebirr / CBE Transfer Receipt ({config.amountEtb} ETB)
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Send <strong>{config.amountEtb} ETB</strong> via Telebirr or CBE Birr and submit your transaction reference ID below for verification.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={manualProvider}
                onChange={(e) => setManualProvider(e.target.value as any)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="telebirr">Telebirr Transfer</option>
                <option value="cbe_birr">CBE Birr / Bank</option>
                <option value="chapa">Chapa Receipt</option>
              </select>
              <input
                type="text"
                value={senderPhone}
                onChange={(e) => setSenderPhone(e.target.value)}
                placeholder="Sender phone (09...)"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <input
              type="text"
              required
              minLength={4}
              value={providerRef}
              onChange={(e) => setProviderRef(e.target.value)}
              placeholder="Transaction Reference (e.g. TXN98273451)"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono dark:border-slate-700 dark:bg-slate-800"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
                <Upload className="h-3.5 w-3.5" />
                {receiptFile ? receiptFile.name : 'Upload Screenshot (Optional)'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                />
              </label>
              <button
                type="submit"
                disabled={submittingReceipt}
                className="rounded-xl bg-[#F5A623] px-4 py-2 text-xs font-bold text-[#123B65] hover:bg-[#e59816] disabled:opacity-60"
              >
                {submittingReceipt ? 'Submitting...' : `Submit ${config.amountEtb} ETB Reference`}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Pass & Payment History */}
      {(subscriptions.length > 0 || payments.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {subscriptions.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between mb-2">
                <h4 className="flex items-center gap-1.5 text-xs font-bold text-[#123B65] dark:text-white">
                  <CalendarClock className="h-4 w-4 text-[#F5A623]" /> Monthly Pass History
                </h4>
                <button type="button" onClick={loadStatus} className="text-[11px] text-[#123B65] dark:text-[#F5A623] inline-flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" /> Refresh
                </button>
              </div>
              <div className="space-y-1.5 text-xs">
                {subscriptions.slice(0, 5).map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
                    <div>
                      <div className="font-semibold">
                        {s.kind === 'renewal' ? 'Monthly Renewal' : s.kind === 'admin_grant' ? 'Admin Activated' : 'Initial Pass'} · ETB {s.amount}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {String(s.starts_at).slice(0, 10)} → {String(s.ends_at).slice(0, 10)}
                      </div>
                    </div>
                    <span className="font-semibold uppercase text-[11px] text-emerald-600">{s.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {payments.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h4 className="flex items-center gap-1.5 text-xs font-bold text-[#123B65] dark:text-white mb-2">
                <ShieldCheck className="h-4 w-4 text-[#F5A623]" /> Service Fee Transactions
              </h4>
              <div className="space-y-1.5 text-xs">
                {payments.slice(0, 5).map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] truncate">{p.provider_ref || p.tx_ref}</div>
                      <div className="text-[11px] text-slate-500">
                        {p.provider.toUpperCase()} · ETB {p.amount} · {p.purpose === 'monthly_service_renewal' ? 'Renewal' : 'Registration'}
                      </div>
                    </div>
                    <span
                      className={`text-[11px] font-bold uppercase shrink-0 ml-2 ${
                        p.status === 'paid'
                          ? 'text-emerald-600'
                          : p.status === 'pending_verification'
                          ? 'text-blue-600'
                          : 'text-amber-600'
                      }`}
                    >
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {onDone && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onDone}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
          >
            {user.subscription_active ? 'Continue Using AZ RENTAL' : 'Close & Browse Listings'}
          </button>
        </div>
      )}
    </div>
  );
};

export const ServicePassModal: React.FC<{
  isOpen: boolean;
  user: User;
  lang: LanguageCode;
  onClose: () => void;
  onUserUpdated: (user: User) => void;
}> = ({ isOpen, user, lang, onClose, onUserUpdated }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-3xl rounded-2xl border border-slate-200 bg-[#F8FAFC] p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 my-8">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-5 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <img
              src="/assets/aistudio/Glossy_AZ_Rental_App_Icon_2ee6fab8.png"
              alt="AZ RENTAL"
              className="h-9 w-9 rounded-xl object-cover"
            />
            <div>
              <h2 className="text-lg font-bold text-[#123B65] dark:text-white">
                AZ RENTAL Monthly Service Pass (50 ETB)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                50 ETB for 1 Month · Renew monthly without creating a new registration
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close service pass modal"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <ServicePassPanel user={user} lang={lang} onUserUpdated={onUserUpdated} onDone={onClose} />
      </div>
    </div>
  );
};

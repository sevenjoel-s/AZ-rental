import React, { useEffect, useState } from 'react';
import {
  BadgeCheck,
  Bell,
  Bookmark,
  CheckCircle2,
  CreditCard,
  Download,
  Heart,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCog,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { Booking, LanguageCode, Listing, NotificationItem, PaymentProvider, User } from '../types';
import { ServicePassPanel } from './ServicePassModal';

interface Props {
  user: User;
  lang: LanguageCode;
  soundEnabled: boolean;
  soundVolume: number;
  onSoundConfigChange: (enabled: boolean, volume: number) => void;
  onUserUpdated: (user: User) => void;
  onOpenListing: (listingId: number) => void;
  onOpenPostRental: () => void;
  onOpenServicePass: () => void;
  onAccountDeleted: () => void;
}

export const UserDashboard: React.FC<Props> = ({
  user,
  lang,
  soundEnabled,
  soundVolume,
  onSoundConfigChange,
  onUserUpdated,
  onOpenListing,
  onOpenPostRental,
  onOpenServicePass,
  onAccountDeleted,
}) => {
  const isLandlordView = user.active_role === 'landlord';
  const [tab, setTab] = useState<'overview' | 'service_pass' | 'bookings' | 'listings' | 'favorites' | 'payments' | 'profile'>('overview');

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [myListings, setMyListings] = useState<Listing[]>([]);
  const [favorites, setFavorites] = useState<Listing[]>([]);
  const [savedSearches, setSavedSearches] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [verifications, setVerifications] = useState<any[]>([]);
  const [compareIds, setCompareIds] = useState<number[]>([]);

  const [fullName, setFullName] = useState(user.full_name);
  const [city, setCity] = useState(user.city);
  const [address, setAddress] = useState(user.address);
  const [verifType, setVerifType] = useState<'identity' | 'business'>('identity');
  const [verifBizName, setVerifBizName] = useState('');
  const [verifLicense, setVerifLicense] = useState('');
  const [verifDoc, setVerifDoc] = useState<File | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    try {
      const [bRes, fRes, ssRes, pRes, prRes, nRes, vRes] = await Promise.all([
        apiFetch<{ bookings: Booking[] }>(`/api/bookings?role=${isLandlordView ? 'landlord' : 'renter'}`),
        apiFetch<{ favorites: Listing[] }>('/api/favorites'),
        apiFetch<{ savedSearches: any[] }>('/api/saved-searches'),
        apiFetch<{ payments: any[] }>('/api/payments/history'),
        apiFetch<{ providers: PaymentProvider[] }>('/api/payments/providers'),
        apiFetch<{ notifications: NotificationItem[] }>('/api/notifications'),
        apiFetch<{ requests: any[] }>('/api/verification/my'),
      ]);
      setBookings(bRes.bookings || []);
      setFavorites(fRes.favorites || []);
      setSavedSearches(ssRes.savedSearches || []);
      setPayments(pRes.payments || []);
      setProviders(prRes.providers || []);
      setNotifications(nRes.notifications || []);
      setVerifications(vRes.requests || []);

      if (user.roles.includes('landlord')) {
        const lRes = await apiFetch<{ listings: Listing[] }>(`/api/listings?ownerId=${user.id}&limit=50`);
        setMyListings(lRes.listings || []);
      }
    } catch {
      // handled individually
    }
  };

  useEffect(() => {
    loadData();
  }, [user.id, user.active_role]);

  const handleSwitchRole = async (targetRole: 'renter' | 'landlord') => {
    setErrorMsg('');
    setStatusMsg('');
    if (user.roles.includes(targetRole)) {
      const res = await apiFetch<{ user: User }>('/api/auth/switch-role', {
        method: 'POST',
        body: JSON.stringify({ targetRole }),
      });
      onUserUpdated(res.user);
      setStatusMsg(`Switched active dashboard to ${targetRole}.`);
    } else {
      const res = await apiFetch<{ message: string }>('/api/auth/request-role', {
        method: 'POST',
        body: JSON.stringify({ requestedRole: targetRole }),
      });
      setStatusMsg(res.message);
    }
  };

  const handleBookingDecision = async (bookingId: number, decision: 'accept' | 'reject' | 'complete') => {
    setErrorMsg('');
    try {
      await apiFetch(`/api/bookings/${bookingId}/respond`, {
        method: 'PATCH',
        body: JSON.stringify({ decision }),
      });
      loadData();
    } catch (err: any) {
      setErrorMsg(err.message);
      if (err?.status === 402 || err?.data?.code === 'SUBSCRIPTION_REQUIRED') onOpenServicePass();
    }
  };

  const handleSignAgreement = async (bookingId: number) => {
    await apiFetch(`/api/bookings/${bookingId}/sign`, {
      method: 'PATCH',
      body: JSON.stringify({ signatureName: user.full_name }),
    });
    loadData();
  };

  const handlePayBooking = async (booking: Booking, provider: 'telebirr' | 'chapa' | 'cbe_birr') => {
    setErrorMsg('');
    try {
      const res = await apiFetch<{ checkoutUrl?: string }>('/api/payments/initiate', {
        method: 'POST',
        body: JSON.stringify({ bookingId: booking.id, provider, purpose: 'booking_payment' }),
      });
      if (res.checkoutUrl) window.location.assign(res.checkoutUrl);
    } catch (err: any) {
      setErrorMsg(err.message);
      if (err?.status === 402 || err?.data?.code === 'SUBSCRIPTION_REQUIRED') onOpenServicePass();
    }
  };

  const handleDownloadReceipt = async (bookingId: number) => {
    const res = await apiFetch<any>(`/api/bookings/${bookingId}/receipt`);
    const lines = [
      `AZ RENTAL — OFFICIAL BOOKING RECEIPT`,
      `Booking ID: #${res.booking.id}`,
      `Listing: ${res.booking.listing_title} (${res.booking.listing_city})`,
      `Renter: ${res.booking.renter_name}`,
      `Owner: ${res.booking.owner_name}`,
      `Dates: ${res.booking.start_date} to ${res.booking.end_date}`,
      `Status: ${res.booking.status}`,
      `Base Amount: ETB ${res.booking.base_amount}`,
      `Service Fee: ETB ${res.booking.service_fee}`,
      `Total Amount: ETB ${res.booking.total_amount}`,
      `Agreement: ${res.agreement?.agreement_number || 'N/A'}`,
      `Payments: ${(res.payments || []).map((p: any) => `${p.tx_ref} (${p.status})`).join(', ') || 'Pending'}`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `azrental-receipt-${bookingId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleToggleListingPause = async (l: Listing) => {
    const nextAvail = l.availability_status === 'paused' ? 'available' : 'paused';
    await apiFetch(`/api/listings/${l.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ availabilityStatus: nextAvail }),
    });
    loadData();
  };

  const handleDeleteListing = async (id: number) => {
    await apiFetch(`/api/listings/${id}`, { method: 'DELETE' });
    loadData();
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch<{ user: User }>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        fullName,
        city,
        address,
        notificationPrefs: { inApp: true, sound: soundEnabled, volume: soundVolume },
      }),
    });
    onUserUpdated(res.user);
    setStatusMsg('Profile and notification preferences saved.');
  };

  const handleSubmitVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('requestType', verifType);
    fd.append('businessName', verifBizName);
    fd.append('licenseNumber', verifLicense);
    if (verifDoc) fd.append('document', verifDoc);
    await apiFetch('/api/verification/request', { method: 'POST', body: fd });
    setStatusMsg('Verification request submitted for administrator review.');
    loadData();
  };

  const handleDeleteAccount = async () => {
    await apiFetch('/api/auth/account', { method: 'DELETE' });
    onAccountDeleted();
  };

  const totalViews = myListings.reduce((acc, l) => acc + (l.views_count || 0), 0);
  const confirmedBookings = bookings.filter((b) => ['Confirmed', 'Paid', 'Completed', 'Active'].includes(b.status));
  const pendingBookings = bookings.filter((b) => ['Pending', 'Awaiting Payment'].includes(b.status));
  const totalEarnings = payments.filter((p) => p.status === 'paid').reduce((acc, p) => acc + Number(p.amount || 0), 0);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header & Role Switcher */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#123B65] dark:text-white">
              {isLandlordView ? 'Landlord / Owner Dashboard' : 'Renter Dashboard'}
            </h1>
            {(user.identity_verified === 1 || user.business_verified === 1) && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                <BadgeCheck className="h-4 w-4" /> Verified
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {user.full_name} · {user.city} · Active Role: {user.active_role}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleSwitchRole(isLandlordView ? 'renter' : 'landlord')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-[#123B65] hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {user.roles.includes(isLandlordView ? 'renter' : 'landlord')
              ? `Switch to ${isLandlordView ? 'Renter' : 'Landlord'}`
              : `Request ${isLandlordView ? 'Renter' : 'Landlord'} Access`}
          </button>
          {isLandlordView && (
            <button
              type="button"
              onClick={onOpenPostRental}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#F5A623] px-4 py-2 text-xs font-bold text-[#123B65] hover:bg-[#e59816]"
            >
              <Plus className="h-4 w-4" /> Post Rental
            </button>
          )}
        </div>
      </div>

      {statusMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-1.5 rounded-xl bg-white p-1.5 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
        {[
          { id: 'overview', label: 'Overview' },
          {
            id: 'service_pass',
            label: user.subscription_active
              ? `Service Pass (${user.subscription_days_remaining}d)`
              : 'Service Pass (50 ETB Due)',
          },
          { id: 'bookings', label: `Bookings (${bookings.length})` },
          ...(isLandlordView ? [{ id: 'listings', label: `My Listings (${myListings.length})` }] : []),
          { id: 'favorites', label: `Favorites (${favorites.length})` },
          { id: 'payments', label: `Payments (${payments.length})` },
          { id: 'profile', label: 'Profile & Verification' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as any)}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === t.id
                ? 'bg-[#123B65] text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Monthly 50 ETB Service Pass Summary */}
          <div
            className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border p-4 ${
              user.subscription_active
                ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-950/20'
                : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
            }`}
          >
            <div className="text-xs">
              <div className="font-bold text-[#123B65] dark:text-white">
                {user.subscription_status === 'exempt'
                  ? 'Administrator Exempt Access'
                  : user.subscription_active
                  ? `Active 1-Month Service Pass · ${user.subscription_days_remaining} days remaining`
                  : user.subscription_status === 'expired'
                  ? 'Monthly Service Pass Expired — Pay 50 ETB to Continue (No New Registration Needed)'
                  : '50 ETB Registration Pass Pending — Activate Your 1-Month Access'}
              </div>
              <p className="mt-0.5 text-slate-600 dark:text-slate-300">
                Members pay 50 ETB on registration for 1 month (30 days), then renew 50 ETB monthly on the same account.
              </p>
            </div>
            {user.subscription_status !== 'exempt' && (
              <button
                type="button"
                onClick={() => setTab('service_pass')}
                className="shrink-0 rounded-xl bg-[#123B65] px-4 py-2 text-xs font-bold text-white hover:bg-[#0e2e4f]"
              >
                {user.subscription_active ? 'Extend / View Pass' : 'Pay 50 ETB Now'}
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs text-slate-500">{isLandlordView ? 'Active Listings' : 'Pending Requests'}</div>
              <div className="mt-1 text-2xl font-bold text-[#123B65] dark:text-white">
                {isLandlordView ? myListings.filter((l) => l.status === 'approved').length : pendingBookings.length}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs text-slate-500">Confirmed Bookings</div>
              <div className="mt-1 text-2xl font-bold text-[#123B65] dark:text-white">{confirmedBookings.length}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs text-slate-500">{isLandlordView ? 'Total Listing Views' : 'Saved Favorites'}</div>
              <div className="mt-1 text-2xl font-bold text-[#123B65] dark:text-white">
                {isLandlordView ? totalViews : favorites.length}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs text-slate-500">{isLandlordView ? 'Verified Revenue (ETB)' : 'Unread Notifications'}</div>
              <div className="mt-1 text-2xl font-bold text-[#123B65] dark:text-white">
                {isLandlordView ? totalEarnings.toLocaleString() : notifications.filter((n) => !n.is_read).length}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Notifications */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between mb-3">
                <h3 className="flex items-center gap-2 text-sm font-bold text-[#123B65] dark:text-white">
                  <Bell className="h-4 w-4 text-[#F5A623]" /> Recent Notifications
                </h3>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/api/notifications/read-all', { method: 'POST' });
                    loadData();
                  }}
                  className="text-xs font-semibold text-[#123B65] hover:underline dark:text-[#F5A623]"
                >
                  Mark all read
                </button>
              </div>
              <div className="space-y-2.5 max-h-72 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="text-xs text-slate-500">No notifications yet.</p>
                ) : (
                  notifications.slice(0, 8).map((n) => (
                    <div key={n.id} className={`rounded-xl border p-3 text-xs ${n.is_read ? 'border-slate-100 dark:border-slate-800' : 'border-[#F5A623]/50 bg-amber-50/40 dark:bg-amber-950/20'}`}>
                      <div className="font-semibold text-slate-900 dark:text-white">{lang === 'am' ? n.title_am : n.title}</div>
                      <div className="mt-0.5 text-slate-600 dark:text-slate-300">{lang === 'am' ? n.body_am : n.body}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Saved Searches */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="flex items-center gap-2 text-sm font-bold text-[#123B65] dark:text-white mb-3">
                <Bookmark className="h-4 w-4 text-[#F5A623]" /> Saved Searches & Alerts
              </h3>
              <div className="space-y-2.5">
                {savedSearches.length === 0 ? (
                  <p className="text-xs text-slate-500">Save any search filter on the Explore page to receive alerts.</p>
                ) : (
                  savedSearches.map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800">
                      <div>
                        <div className="font-semibold">{s.name}</div>
                        <div className="text-[11px] text-slate-500">{s.filters_json}</div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/saved-searches/${s.id}`, { method: 'DELETE' });
                          loadData();
                        }}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Service Pass Tab */}
      {tab === 'service_pass' && (
        <ServicePassPanel user={user} lang={lang} onUserUpdated={onUserUpdated} />
      )}

      {/* Bookings Tab */}
      {tab === 'bookings' && (
        <div className="space-y-3">
          {bookings.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
              No bookings yet.
            </div>
          ) : (
            bookings.map((b) => (
              <div key={b.id} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-xs text-slate-500">
                      #{b.id} · {b.request_type.toUpperCase()} · {b.start_date} to {b.end_date} · {b.status}
                    </div>
                    <h4 className="text-sm font-bold text-[#123B65] dark:text-white mt-0.5">{b.listing_title}</h4>
                    <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                      {isLandlordView ? `Renter: ${b.renter_name}` : `Owner: ${b.owner_name}`} · Total: <strong className="font-mono">ETB {b.total_amount.toLocaleString()}</strong>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {isLandlordView && b.status === 'Pending' && (
                      <>
                        <button type="button" onClick={() => handleBookingDecision(b.id, 'accept')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">Accept</button>
                        <button type="button" onClick={() => handleBookingDecision(b.id, 'reject')} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">Reject</button>
                      </>
                    )}
                    {isLandlordView && ['Confirmed', 'Paid', 'Active'].includes(b.status) && (
                      <button type="button" onClick={() => handleBookingDecision(b.id, 'complete')} className="rounded-lg bg-[#123B65] px-3 py-1.5 text-xs font-semibold text-white">Mark Completed</button>
                    )}
                    {!isLandlordView && !b.agreement_signed_by_renter && !['Rejected', 'Cancelled'].includes(b.status) && (
                      <button type="button" onClick={() => handleSignAgreement(b.id)} className="inline-flex items-center gap-1 rounded-lg bg-[#123B65] px-3 py-1.5 text-xs font-semibold text-white">
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#F5A623]" /> Sign Agreement
                      </button>
                    )}
                    {!isLandlordView && b.agreement_signed_by_renter === 1 && ['Awaiting Payment', 'Accepted'].includes(b.status) && (
                      <div className="flex items-center gap-1.5">
                        {providers.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => handlePayBooking(b, p.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#F5A623] px-2.5 py-1.5 text-[11px] font-bold text-[#123B65]"
                          >
                            <CreditCard className="h-3 w-3" /> Pay ({p.id})
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDownloadReceipt(b.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold dark:border-slate-700"
                    >
                      <Download className="h-3.5 w-3.5" /> Receipt
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Landlord Listings Tab */}
      {tab === 'listings' && isLandlordView && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {myListings.map((l) => (
            <div key={l.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-slate-900">
              <div className="aspect-[16/10] bg-slate-100 dark:bg-slate-800">
                {l.images[0] && <img src={l.images[0].url} alt={l.title} className="h-full w-full object-cover" />}
              </div>
              <div className="p-4 space-y-2">
                <div className="text-xs text-slate-500">
                  {l.status.toUpperCase()} · {l.availability_status} · {l.views_count} views
                </div>
                <h4 className="font-bold text-sm text-[#123B65] dark:text-white line-clamp-1">{l.title}</h4>
                <div className="flex items-center gap-2 pt-2">
                  <button type="button" onClick={() => onOpenListing(l.id)} className="flex-1 rounded-lg border border-slate-200 py-1.5 text-xs font-semibold dark:border-slate-700">
                    View
                  </button>
                  <button type="button" onClick={() => handleToggleListingPause(l)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold dark:border-slate-700">
                    {l.availability_status === 'paused' ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                    {l.availability_status === 'paused' ? 'Resume' : 'Pause'}
                  </button>
                  <button type="button" onClick={() => handleDeleteListing(l.id)} className="rounded-lg border border-red-200 p-1.5 text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Favorites & Price Comparison Tab */}
      {tab === 'favorites' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {favorites.map((l) => {
              const selectedForCompare = compareIds.includes(l.id);
              return (
                <div key={l.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-slate-900">
                  <div className="aspect-[16/10] bg-slate-100">
                    {l.images[0] && <img src={l.images[0].url} alt={l.title} className="h-full w-full object-cover" />}
                  </div>
                  <div className="p-4 space-y-2">
                    <div className="text-xs text-slate-500">{l.city} · {l.category_name_en}</div>
                    <h4 className="font-bold text-sm text-[#123B65] dark:text-white">{l.title}</h4>
                    <div className="flex items-center gap-2 pt-2">
                      <button type="button" onClick={() => onOpenListing(l.id)} className="flex-1 rounded-lg bg-[#123B65] py-1.5 text-xs font-semibold text-white">
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCompareIds((prev) =>
                            prev.includes(l.id) ? prev.filter((x) => x !== l.id) : prev.length < 3 ? [...prev, l.id] : prev
                          )
                        }
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                          selectedForCompare ? 'border-[#F5A623] bg-[#F5A623]/15 text-[#123B65]' : 'border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {selectedForCompare ? 'Comparing' : 'Compare'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/favorites/${l.id}`, { method: 'DELETE' });
                          loadData();
                        }}
                        className="rounded-lg border border-red-200 p-1.5 text-red-600"
                      >
                        <Heart className="h-4 w-4 fill-current" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {compareIds.length >= 2 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 overflow-x-auto dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-bold text-[#123B65] dark:text-white mb-3">Price & Feature Comparison</h3>
              <table className="w-full text-xs text-left tabular-nums">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="py-2 pr-4">Listing</th>
                    <th className="py-2 pr-4">City</th>
                    <th className="py-2 pr-4">Daily (ETB)</th>
                    <th className="py-2 pr-4">Weekly (ETB)</th>
                    <th className="py-2 pr-4">Monthly (ETB)</th>
                    <th className="py-2">Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {favorites
                    .filter((f) => compareIds.includes(f.id))
                    .map((f) => (
                      <tr key={f.id} className="border-b border-slate-100 dark:border-slate-800/60">
                        <td className="py-2.5 pr-4 font-semibold">{f.title}</td>
                        <td className="py-2.5 pr-4">{f.city}</td>
                        <td className="py-2.5 pr-4">{f.price_daily?.toLocaleString() || '—'}</td>
                        <td className="py-2.5 pr-4">{f.price_weekly?.toLocaleString() || '—'}</td>
                        <td className="py-2.5 pr-4">{f.price_monthly?.toLocaleString() || '—'}</td>
                        <td className="py-2.5">{f.is_verified ? 'Yes' : 'No'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Payments Tab */}
      {tab === 'payments' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 overflow-x-auto dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-bold text-[#123B65] dark:text-white mb-3">Payment & Transaction History (ETB)</h3>
          <table className="w-full text-xs text-left tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                <th className="py-2 pr-4">Reference</th>
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2 pr-4">Listing</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800/60">
                  <td className="py-2.5 pr-4 font-mono">{p.tx_ref}</td>
                  <td className="py-2.5 pr-4 uppercase">{p.provider}</td>
                  <td className="py-2.5 pr-4">{p.listing_title || p.purpose}</td>
                  <td className="py-2.5 pr-4 font-bold">ETB {Number(p.amount).toLocaleString()}</td>
                  <td className="py-2.5 pr-4">{p.status}</td>
                  <td className="py-2.5 text-slate-500">{p.failure_reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Profile, Notification Sound & Verification Tab */}
      {tab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form onSubmit={handleSaveProfile} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="flex items-center gap-2 text-sm font-bold text-[#123B65] dark:text-white">
              <UserCog className="h-4 w-4 text-[#F5A623]" /> Profile & Alert Settings
            </h3>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full Name" className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
            <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />

            <div className="rounded-xl border border-slate-200 p-3 space-y-2 dark:border-slate-800">
              <label className="flex items-center justify-between text-xs font-semibold">
                <span>Sound Alerts for Messages & Calls</span>
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => onSoundConfigChange(e.target.checked, soundVolume)}
                />
              </label>
              <div className="flex items-center gap-3 text-xs">
                <span>Volume</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={soundVolume}
                  onChange={(e) => onSoundConfigChange(soundEnabled, Number(e.target.value))}
                  className="flex-1"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button type="submit" className="rounded-xl bg-[#123B65] px-5 py-2.5 text-xs font-bold text-white">
                Save Changes
              </button>
              <button type="button" onClick={handleDeleteAccount} className="text-xs font-semibold text-red-600 hover:underline">
                Delete Account
              </button>
            </div>
          </form>

          <form onSubmit={handleSubmitVerification} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="flex items-center gap-2 text-sm font-bold text-[#123B65] dark:text-white">
              <ShieldCheck className="h-4 w-4 text-[#F5A623]" /> Identity & Business Verification
            </h3>
            <div className="text-xs text-slate-500">
              Status: <strong className="uppercase text-slate-900 dark:text-white">{user.verification_status}</strong>
            </div>
            <select value={verifType} onChange={(e) => setVerifType(e.target.value as any)} className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800">
              <option value="identity">Personal Identity (Kebele ID / National ID / Passport)</option>
              <option value="business">Business License & TIN Verification</option>
            </select>
            <input type="text" value={verifBizName} onChange={(e) => setVerifBizName(e.target.value)} placeholder="Legal / Business Name" className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
            <input type="text" value={verifLicense} onChange={(e) => setVerifLicense(e.target.value)} placeholder="ID or Trade License Number" className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
            <input type="file" onChange={(e) => setVerifDoc(e.target.files?.[0] || null)} className="text-xs" />
            <button type="submit" className="rounded-xl bg-[#F5A623] px-5 py-2.5 text-xs font-bold text-[#123B65]">
              Submit Verification Documents
            </button>
            {verifications.length > 0 && (
              <div className="border-t border-slate-200 pt-3 space-y-1.5 text-xs dark:border-slate-800">
                {verifications.map((v) => (
                  <div key={v.id} className="flex justify-between">
                    <span>{v.request_type} · {v.license_number || v.business_name}</span>
                    <span className="font-semibold uppercase">{v.status}</span>
                  </div>
                ))}
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
};

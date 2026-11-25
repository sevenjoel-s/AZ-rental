import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch, getAccessToken } from '../lib/api';
import type { Banner, Category, LocationItem, User } from '../types';

interface Props {
  user: User;
  categories: Category[];
  locations: LocationItem[];
  onRefreshPublicData: () => void;
}

export const AdminDashboard: React.FC<Props> = ({
  categories,
  locations,
  onRefreshPublicData,
}) => {
  const [section, setSection] = useState<
    'analytics' | 'users' | 'verifications' | 'listings' | 'taxonomy' | 'locations' | 'banners' | 'payments' | 'reports' | 'settings' | 'logs'
  >('analytics');

  const [analytics, setAnalytics] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [roleRequests, setRoleRequests] = useState<any[]>([]);
  const [verifications, setVerifications] = useState<any[]>([]);
  const [listings, setListings] = useState<any[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [paymentsData, setPaymentsData] = useState<{
    payments: any[];
    transactions: any[];
    subscriptions: any[];
    bookings: any[];
  }>({
    payments: [],
    transactions: [],
    subscriptions: [],
    bookings: [],
  });
  const [receiptPreview, setReceiptPreview] = useState<{ url: string; isPdf: boolean; txRef: string } | null>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  const [newCatSlug, setNewCatSlug] = useState('');
  const [newCatEn, setNewCatEn] = useState('');
  const [newCatAm, setNewCatAm] = useState('');

  const [newLocRegion, setNewLocRegion] = useState('Oromia');
  const [newLocCity, setNewLocCity] = useState('');
  const [newLocSubCity, setNewLocSubCity] = useState('');
  const [newLocNeighborhood, setNewLocNeighborhood] = useState('');
  const [newLocLat, setNewLocLat] = useState('9.0054');
  const [newLocLng, setNewLocLng] = useState('38.7636');

  const [msg, setMsg] = useState('');

  const loadAll = async () => {
    try {
      const [aRes, uRes, vRes, lRes, bRes, pRes, rRes, sRes, logRes] = await Promise.all([
        apiFetch('/api/admin/analytics'),
        apiFetch('/api/admin/users'),
        apiFetch('/api/admin/verifications'),
        apiFetch('/api/admin/listings'),
        apiFetch('/api/admin/banners'),
        apiFetch('/api/admin/payments').catch(() => ({ payments: [], transactions: [], bookings: [] })),
        apiFetch('/api/admin/reports'),
        apiFetch('/api/admin/settings'),
        apiFetch('/api/admin/audit-logs'),
      ]);
      setAnalytics(aRes);
      setUsers(uRes.users || []);
      setRoleRequests(uRes.roleRequests || []);
      setVerifications(vRes.verifications || []);
      setListings(lRes.listings || []);
      setBanners(bRes.banners || []);
      setPaymentsData({
        payments: pRes.payments || [],
        transactions: pRes.transactions || [],
        subscriptions: pRes.subscriptions || [],
        bookings: pRes.bookings || [],
      });
      setReports(rRes.reports || []);
      setSettings(sRes.settings || {});
      setAuditLogs(logRes.logs || []);
    } catch {
      // role-restricted sections handled gracefully
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const pendingPassReceipts = paymentsData.payments.filter(
    (p) =>
      p.status === 'pending_verification' &&
      ['registration_fee', 'monthly_service_renewal'].includes(p.purpose)
  );

  const openReceiptPreview = async (paymentId: number, txRef: string) => {
    try {
      const token = getAccessToken();
      const res = await fetch(`/api/admin/subscriptions/receipt/${paymentId}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        setMsg('Unable to load receipt attachment.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setReceiptPreview({ url, isPdf: blob.type.includes('pdf'), txRef });
    } catch {
      setMsg('Unable to load receipt attachment.');
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-bold text-[#123B65] dark:text-white">AZ RENTAL Administration Console</h1>
        <p className="text-xs text-slate-500">All administrative mutations are recorded in the immutable audit log.</p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {[
            ['analytics', 'Analytics'],
            ['users', `Users (${users.length})`],
            ['verifications', `Verifications (${verifications.filter((v) => v.status === 'pending').length})`],
            ['listings', `Listings (${listings.length})`],
            ['taxonomy', 'Categories'],
            ['locations', `Locations (${locations.length})`],
            ['banners', 'Safety Banners'],
            [
              'payments',
              pendingPassReceipts.length > 0
                ? `Payments & Refunds (${pendingPassReceipts.length} Pending)`
                : 'Payments & Refunds',
            ],
            ['reports', `Reports (${reports.filter((r) => r.status === 'open').length})`],
            ['settings', 'Settings'],
            ['logs', 'Audit Logs'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id as any)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${
                section === id
                  ? 'bg-[#123B65] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {msg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          {msg}
        </div>
      )}

      {section === 'analytics' && analytics && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 tabular-nums">
            {[
              ['Registered Users', analytics.kpis.totalUsers],
              ['Active Listings', analytics.kpis.activeListings],
              ['Pending Listings', analytics.kpis.pendingListings],
              ['Total Bookings', analytics.kpis.totalBookings],
              ['Revenue (ETB)', Number(analytics.kpis.totalRevenueEtb || 0).toLocaleString()],
            ].map(([label, val]) => (
              <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="text-[11px] text-slate-500">{label}</div>
                <div className="mt-1 text-xl font-bold text-[#123B65] dark:text-white">{val}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-bold text-[#123B65] dark:text-white mb-4">Listings by Category</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.charts.categoryBreakdown}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="listings" fill="#123B65" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-bold text-[#123B65] dark:text-white mb-4">Popular Ethiopian Cities</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.charts.cityBreakdown}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="listings" fill="#F5A623" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {section === 'users' && (
        <div className="space-y-6">
          {roleRequests.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2 dark:border-amber-900/50 dark:bg-amber-950/30">
              <h3 className="text-xs font-bold text-amber-900 dark:text-amber-200">Pending Role-Switch Requests</h3>
              {roleRequests.map((rr) => (
                <div key={rr.id} className="flex items-center justify-between text-xs bg-white dark:bg-slate-900 p-3 rounded-xl">
                  <span>{rr.full_name} requests <strong>{rr.role_name}</strong> access</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={async () => { await apiFetch(`/api/admin/role-requests/${rr.id}`, { method: 'PATCH', body: JSON.stringify({ decision: 'approve' }) }); loadAll(); }} className="rounded-lg bg-emerald-600 px-3 py-1 text-white font-semibold">Approve</button>
                    <button type="button" onClick={async () => { await apiFetch(`/api/admin/role-requests/${rr.id}`, { method: 'PATCH', body: JSON.stringify({ decision: 'reject' }) }); loadAll(); }} className="rounded-lg bg-red-600 px-3 py-1 text-white font-semibold">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-5 overflow-x-auto dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                  <th className="py-2 pr-4">User</th>
                  <th className="py-2 pr-4">Contact</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">City</th>
                  <th className="py-2 pr-4">Verified</th>
                  <th className="py-2 pr-4">Service Pass</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800/60">
                    <td className="py-2.5 pr-4 font-semibold">{u.full_name}</td>
                    <td className="py-2.5 pr-4">{u.email || u.phone}</td>
                    <td className="py-2.5 pr-4">{u.active_role}</td>
                    <td className="py-2.5 pr-4">{u.city}</td>
                    <td className="py-2.5 pr-4">{u.verification_status}</td>
                    <td className="py-2.5 pr-4">
                      <span className="font-semibold uppercase text-[11px]">{u.subscription_status || 'pending_payment'}</span>
                      {u.subscription_expires_at && (
                        <div className="text-[10px] text-slate-500">
                          until {String(u.subscription_expires_at).slice(0, 10)}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 flex flex-wrap gap-2">
                      {u.subscription_status !== 'exempt' && (
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/users/${u.id}/grant-pass`, {
                              method: 'POST',
                              body: JSON.stringify({ durationDays: 30 }),
                            });
                            setMsg(`Activated 30-day service pass for ${u.full_name}.`);
                            loadAll();
                          }}
                          className="rounded-lg bg-[#123B65] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#0e2e4f]"
                        >
                          Grant 30d Pass
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/admin/users/${u.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ isBlocked: !u.is_blocked }),
                          });
                          loadAll();
                        }}
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${u.is_blocked ? 'bg-emerald-600 text-white' : 'bg-red-50 text-red-700'}`}
                      >
                        {u.is_blocked ? 'Unblock' : 'Suspend'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === 'verifications' && (
        <div className="space-y-3">
          {verifications.map((v) => (
            <div key={v.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900">
              <div>
                <div className="font-bold">{v.full_name} ({v.request_type})</div>
                <div className="text-slate-500">Business: {v.business_name || 'N/A'} · License/ID: {v.license_number || 'N/A'} · Status: {v.status}</div>
              </div>
              {v.status === 'pending' && (
                <div className="flex gap-2">
                  <button type="button" onClick={async () => { await apiFetch(`/api/admin/verifications/${v.id}`, { method: 'PATCH', body: JSON.stringify({ decision: 'approve' }) }); loadAll(); }} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white">Approve</button>
                  <button type="button" onClick={async () => { await apiFetch(`/api/admin/verifications/${v.id}`, { method: 'PATCH', body: JSON.stringify({ decision: 'reject' }) }); loadAll(); }} className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white">Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {section === 'listings' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 overflow-x-auto dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                <th className="py-2 pr-4">Listing</th>
                <th className="py-2 pr-4">Owner</th>
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 pr-4">City</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Moderation</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 dark:border-slate-800/60">
                  <td className="py-2.5 pr-4 font-semibold">{l.title}</td>
                  <td className="py-2.5 pr-4">{l.owner_name}</td>
                  <td className="py-2.5 pr-4">{l.category_name}</td>
                  <td className="py-2.5 pr-4">{l.city}</td>
                  <td className="py-2.5 pr-4 font-semibold">{l.status}</td>
                  <td className="py-2.5 flex flex-wrap gap-1.5">
                    <button type="button" onClick={async () => { await apiFetch(`/api/admin/listings/${l.id}/moderate`, { method: 'PATCH', body: JSON.stringify({ status: 'approved', isVerified: true }) }); loadAll(); onRefreshPublicData(); }} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-white font-semibold">Approve</button>
                    <button type="button" onClick={async () => { await apiFetch(`/api/admin/listings/${l.id}/moderate`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected' }) }); loadAll(); onRefreshPublicData(); }} className="rounded-lg bg-red-600 px-2.5 py-1 text-white font-semibold">Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {section === 'taxonomy' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiFetch('/api/admin/categories', {
                method: 'POST',
                body: JSON.stringify({ slug: newCatSlug, nameEn: newCatEn, nameAm: newCatAm }),
              });
              setNewCatSlug(''); setNewCatEn(''); setNewCatAm('');
              setMsg('Category created.');
              onRefreshPublicData();
            }}
            className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-sm font-bold text-[#123B65] dark:text-white">Add New Rental Category</h3>
            <input type="text" required value={newCatSlug} onChange={(e) => setNewCatSlug(e.target.value)} placeholder="Slug (e.g. agriculture)" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
            <input type="text" required value={newCatEn} onChange={(e) => setNewCatEn(e.target.value)} placeholder="English Name" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
            <input type="text" required value={newCatAm} onChange={(e) => setNewCatAm(e.target.value)} placeholder="Amharic Name" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
            <button type="submit" className="rounded-xl bg-[#123B65] px-4 py-2 text-xs font-bold text-white">Add Category</button>
          </form>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-2.5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-bold text-[#123B65] dark:text-white">Active Categories ({categories.length})</h3>
            {categories.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800">
                <div className="font-bold">{c.name_en} · {c.name_am}</div>
                <div className="text-slate-500 mt-1">{c.subcategories.length} subcategories</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {section === 'locations' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiFetch('/api/admin/locations', {
                method: 'POST',
                body: JSON.stringify({
                  region: newLocRegion,
                  city: newLocCity,
                  subCity: newLocSubCity,
                  neighborhood: newLocNeighborhood,
                  latitude: Number(newLocLat),
                  longitude: Number(newLocLng),
                }),
              });
              setNewLocCity(''); setNewLocSubCity(''); setNewLocNeighborhood('');
              setMsg('Ethiopian location added.');
              onRefreshPublicData();
            }}
            className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-sm font-bold text-[#123B65] dark:text-white">Add Ethiopian City / Sub-City / Neighborhood</h3>
            <input type="text" required value={newLocRegion} onChange={(e) => setNewLocRegion(e.target.value)} placeholder="Region" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
            <input type="text" required value={newLocCity} onChange={(e) => setNewLocCity(e.target.value)} placeholder="City / Town" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
            <input type="text" value={newLocSubCity} onChange={(e) => setNewLocSubCity(e.target.value)} placeholder="Sub-City / Woreda" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
            <input type="text" value={newLocNeighborhood} onChange={(e) => setNewLocNeighborhood(e.target.value)} placeholder="Neighborhood" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
            <div className="grid grid-cols-2 gap-2">
              <input type="text" required value={newLocLat} onChange={(e) => setNewLocLat(e.target.value)} placeholder="Latitude" className="rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
              <input type="text" required value={newLocLng} onChange={(e) => setNewLocLng(e.target.value)} placeholder="Longitude" className="rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
            </div>
            <button type="submit" className="rounded-xl bg-[#123B65] px-4 py-2 text-xs font-bold text-white">Save Location</button>
          </form>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 max-h-96 overflow-y-auto space-y-2 dark:border-slate-800 dark:bg-slate-900">
            {locations.map((loc) => (
              <div key={loc.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-2.5 text-xs dark:border-slate-800">
                <span>{loc.region} · <strong>{loc.city}</strong> {loc.sub_city ? `· ${loc.sub_city}` : ''} {loc.neighborhood ? `· ${loc.neighborhood}` : ''}</span>
                <button type="button" onClick={async () => { await apiFetch(`/api/admin/locations/${loc.id}`, { method: 'DELETE' }); onRefreshPublicData(); }} className="text-red-500 text-[11px] font-semibold">Disable</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {section === 'banners' && (
        <div className="space-y-4">
          {banners.map((b) => (
            <div key={b.id} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-2.5 dark:border-slate-800 dark:bg-slate-900">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  defaultValue={b.title_am}
                  onBlur={(e) => apiFetch(`/api/admin/banners/${b.id}`, { method: 'PATCH', body: JSON.stringify({ titleAm: e.target.value }) }).then(onRefreshPublicData)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-800"
                />
                <input
                  type="text"
                  defaultValue={b.title_en}
                  onBlur={(e) => apiFetch(`/api/admin/banners/${b.id}`, { method: 'PATCH', body: JSON.stringify({ titleEn: e.target.value }) }).then(onRefreshPublicData)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">{b.subtitle_am}</span>
                <button
                  type="button"
                  onClick={() => apiFetch(`/api/admin/banners/${b.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !b.is_active }) }).then(() => { loadAll(); onRefreshPublicData(); })}
                  className={`rounded-lg px-3 py-1 font-semibold ${b.is_active ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}`}
                >
                  {b.is_active ? 'Visible' : 'Hidden'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {section === 'payments' && (
        <div className="space-y-6">
          {/* Pending 50 ETB Service Pass Receipt Approvals */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 dark:border-amber-900/50 dark:bg-amber-950/20">
            <h3 className="text-sm font-bold text-[#123B65] dark:text-amber-200 mb-3">
              Pending 50 ETB Service Pass Receipts ({pendingPassReceipts.length})
            </h3>
            {pendingPassReceipts.length === 0 ? (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                No pending Telebirr or CBE transfer receipts awaiting verification.
              </p>
            ) : (
              <div className="space-y-2.5">
                {pendingPassReceipts.map((p) => {
                  let meta: any = {};
                  try {
                    meta = JSON.parse(p.metadata_json || '{}');
                  } catch {
                    meta = {};
                  }
                  return (
                    <div
                      key={p.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-[#123B65] dark:text-white">
                          {p.user_name} ({p.user_phone || p.user_email}) ·{' '}
                          {p.purpose === 'monthly_service_renewal' ? 'Monthly Renewal' : 'Registration Pass'} · ETB{' '}
                          {Number(p.amount).toLocaleString()}
                        </div>
                        <div className="text-slate-500">
                          {p.provider.toUpperCase()} Ref: <span className="font-mono font-semibold">{p.provider_ref || p.tx_ref}</span>
                          {meta.senderPhone ? ` · Sender: ${meta.senderPhone}` : ''}
                          {meta.notes ? ` · ${meta.notes}` : ''}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {meta.receiptFile && (
                          <button
                            type="button"
                            onClick={() => openReceiptPreview(p.id, p.provider_ref || p.tx_ref)}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-[#123B65] hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                          >
                            View Receipt
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/subscriptions/approve-payment/${p.id}`, { method: 'POST' });
                            setMsg(`Approved 50 ETB pass for ${p.user_name}.`);
                            loadAll();
                          }}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500"
                        >
                          Approve (Activate 30 Days)
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/subscriptions/reject-payment/${p.id}`, {
                              method: 'POST',
                              body: JSON.stringify({ reason: 'Reference could not be verified by finance team.' }),
                            });
                            setMsg(`Declined receipt ${p.provider_ref || p.tx_ref}.`);
                            loadAll();
                          }}
                          className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-500"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 overflow-x-auto dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-bold mb-3">Platform Payments & Refunds</h3>
            <table className="w-full text-xs text-left tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                  <th className="py-2 pr-4">Tx Ref</th>
                  <th className="py-2 pr-4">User</th>
                  <th className="py-2 pr-4">Purpose</th>
                  <th className="py-2 pr-4">Provider</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {paymentsData.payments.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800/60">
                    <td className="py-2.5 pr-4 font-mono">{p.provider_ref || p.tx_ref}</td>
                    <td className="py-2.5 pr-4">{p.user_name}</td>
                    <td className="py-2.5 pr-4">{p.purpose}</td>
                    <td className="py-2.5 pr-4 uppercase">{p.provider}</td>
                    <td className="py-2.5 pr-4">ETB {Number(p.amount).toLocaleString()}</td>
                    <td className="py-2.5 pr-4">{p.status}</td>
                    <td className="py-2.5">
                      {p.status === 'paid' && (
                        <button type="button" onClick={() => apiFetch(`/api/admin/payments/${p.id}/refund`, { method: 'POST', body: JSON.stringify({ reason: 'Admin refund' }) }).then(loadAll)} className="rounded-lg bg-red-600 px-2.5 py-1 text-white font-semibold">Refund</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {paymentsData.subscriptions.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 overflow-x-auto dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-bold mb-3">Monthly Service Pass Log</h3>
              <table className="w-full text-xs text-left tabular-nums">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                    <th className="py-2 pr-4">User</th>
                    <th className="py-2 pr-4">Kind</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Valid From</th>
                    <th className="py-2 pr-4">Expires</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentsData.subscriptions.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 dark:border-slate-800/60">
                      <td className="py-2.5 pr-4 font-semibold">{s.user_name}</td>
                      <td className="py-2.5 pr-4">{s.kind}</td>
                      <td className="py-2.5 pr-4">ETB {Number(s.amount).toLocaleString()}</td>
                      <td className="py-2.5 pr-4 font-mono">{String(s.starts_at).slice(0, 10)}</td>
                      <td className="py-2.5 pr-4 font-mono">{String(s.ends_at).slice(0, 10)}</td>
                      <td className="py-2.5 uppercase font-semibold">{s.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {receiptPreview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-[#123B65] dark:text-white">
                Transfer Receipt · {receiptPreview.txRef}
              </h4>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(receiptPreview.url);
                  setReceiptPreview(null);
                }}
                className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold dark:border-slate-700"
              >
                Close
              </button>
            </div>
            {receiptPreview.isPdf ? (
              <div className="space-y-2">
                <iframe src={receiptPreview.url} title="Receipt PDF" className="h-96 w-full rounded-xl border" />
                <a
                  href={receiptPreview.url}
                  download={`receipt-${receiptPreview.txRef}.pdf`}
                  className="inline-block text-xs font-semibold text-[#123B65] underline dark:text-[#F5A623]"
                >
                  Download PDF Receipt
                </a>
              </div>
            ) : (
              <img src={receiptPreview.url} alt="Transfer receipt" className="max-h-[70vh] w-full rounded-xl object-contain bg-slate-100" />
            )}
          </div>
        </div>
      )}

      {section === 'reports' && (
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900">
              <div>
                <div className="font-bold">{r.reason} ({r.target_type} #{r.target_id})</div>
                <div className="text-slate-500">Reporter: {r.reporter_name} · {r.details} · Status: {r.status}</div>
              </div>
              {r.status === 'open' && (
                <button type="button" onClick={() => apiFetch(`/api/admin/reports/${r.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved', resolutionNotes: 'Reviewed by moderation' }) }).then(loadAll)} className="rounded-lg bg-[#123B65] px-3 py-1.5 font-semibold text-white">Resolve</button>
              )}
            </div>
          ))}
        </div>
      )}

      {section === 'settings' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 max-w-xl dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-bold text-[#123B65] dark:text-white">Platform System Settings</h3>
          <div>
            <label className="block text-xs font-semibold mb-1">Monthly Registration & Renewal Fee (ETB)</label>
            <input
              type="number"
              min="1"
              step="1"
              value={settings.monthly_service_fee_etb ?? 50}
              onChange={(e) => setSettings({ ...settings, monthly_service_fee_etb: Number(e.target.value) })}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Service Pass Duration (Days)</label>
            <input
              type="number"
              min="1"
              step="1"
              value={settings.service_pass_duration_days ?? 30}
              onChange={(e) => setSettings({ ...settings, service_pass_duration_days: Number(e.target.value) })}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Platform Service Fee (%)</label>
            <input
              type="number"
              step="0.5"
              value={settings.platform_fee_percent ?? 3.5}
              onChange={(e) => setSettings({ ...settings, platform_fee_percent: Number(e.target.value) })}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">AZ RENTAL Watermark Opacity (0.15 – 0.85)</label>
            <input
              type="number"
              step="0.05"
              min="0.15"
              max="0.85"
              value={settings.watermark_opacity ?? 0.42}
              onChange={(e) => setSettings({ ...settings, watermark_opacity: Number(e.target.value) })}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <button
            type="button"
            onClick={async () => {
              await apiFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify(settings) });
              setMsg('System settings saved.');
            }}
            className="rounded-xl bg-[#123B65] px-5 py-2.5 text-xs font-bold text-white"
          >
            Save Settings
          </button>
        </div>
      )}

      {section === 'logs' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 overflow-x-auto dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-xs text-left tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                <th className="py-2 pr-4">Time</th>
                <th className="py-2 pr-4">Actor</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2">Target</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 dark:border-slate-800/60">
                  <td className="py-2 pr-4 font-mono text-[11px]">{l.created_at}</td>
                  <td className="py-2 pr-4">{l.actor_name || 'System'} ({l.actor_role})</td>
                  <td className="py-2 pr-4 font-semibold">{l.action}</td>
                  <td className="py-2 text-slate-500">{l.target_type} #{l.target_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

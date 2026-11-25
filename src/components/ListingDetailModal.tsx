import React, { useEffect, useState } from 'react';
import {
  BadgeCheck,
  Calendar,
  CheckCircle2,
  CreditCard,
  Flag,
  Heart,
  MapPin,
  MessageSquare,
  Phone,
  ShieldAlert,
  Star,
  Video,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { Booking, LanguageCode, Listing, PaymentProvider, User } from '../types';
import { MapDiscovery } from './MapDiscovery';

interface Props {
  listingId: number | null;
  user: User | null;
  lang: LanguageCode;
  userCoords: { lat: number; lng: number } | null;
  onClose: () => void;
  onRequireAuth: () => void;
  onRequireServicePass?: () => void;
  onStartChat: (listing: Listing) => void;
  onStartCall: (peerId: number, peerName: string, callType: 'audio' | 'video') => void;
  onFavoriteChanged: (listingId: number, isFav: boolean) => void;
}

export const ListingDetailModal: React.FC<Props> = ({
  listingId,
  user,
  lang,
  userCoords,
  onClose,
  onRequireAuth,
  onRequireServicePass,
  onStartChat,
  onStartCall,
  onFavoriteChanged,
}) => {
  const [listing, setListing] = useState<Listing | null>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [bookedDates, setBookedDates] = useState<any[]>([]);
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [activePhoto, setActivePhoto] = useState(0);
  const [showVideo, setShowVideo] = useState(false);

  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [durationType, setDurationType] = useState('daily');
  const [requestType, setRequestType] = useState<'rental' | 'viewing'>('rental');
  const [viewingTime, setViewingTime] = useState('');
  const [notes, setNotes] = useState('');

  const [createdBooking, setCreatedBooking] = useState<Booking | null>(null);
  const [agreement, setAgreement] = useState<any>(null);
  const [selectedProvider, setSelectedProvider] = useState<'telebirr' | 'chapa' | 'cbe_birr'>('chapa');
  const [paymentError, setPaymentError] = useState('');
  const [bookingMsg, setBookingMsg] = useState('');
  const [error, setError] = useState('');

  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState('Suspected scam or fake listing');
  const [reportDetails, setReportDetails] = useState('');

  const [rating, setRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');

  useEffect(() => {
    if (!listingId) return;
    setListing(null);
    setCreatedBooking(null);
    setAgreement(null);
    setError('');
    setPaymentError('');
    setBookingMsg('');
    setActivePhoto(0);
    setShowVideo(false);

    const qs = userCoords ? `?lat=${userCoords.lat}&lng=${userCoords.lng}` : '';
    apiFetch<{ listing: Listing; reviews: any[]; bookedDates: any[] }>(`/api/listings/${listingId}${qs}`)
      .then((res) => {
        setListing(res.listing);
        setReviews(res.reviews || []);
        setBookedDates(res.bookedDates || []);
        setDurationType(res.listing.primary_duration || 'daily');
      })
      .catch((err) => setError(err.message));

    apiFetch<{ providers: PaymentProvider[] }>('/api/payments/providers')
      .then((res) => setProviders(res.providers || []))
      .catch(() => {});
  }, [listingId, userCoords?.lat, userCoords?.lng]);

  if (!listingId) return null;

  const estimateCost = () => {
    if (!listing || requestType === 'viewing') return { units: 0, base: 0, fee: 0, total: 0 };
    const d1 = new Date(startDate).getTime();
    const d2 = new Date(endDate).getTime();
    const days = Math.max(1, Math.ceil((d2 - d1) / 86400000) + 1);
    let units = days;
    let rate = listing.price_daily || Math.round((listing.price_monthly || 10000) / 30);
    if (durationType === 'weekly') {
      units = Math.max(1, Math.ceil(days / 7));
      rate = listing.price_weekly || rate * 7;
    } else if (durationType === 'monthly') {
      units = Math.max(1, Math.ceil(days / 30));
      rate = listing.price_monthly || rate * 30;
    } else if (durationType === 'hourly') {
      units = days;
      rate = listing.price_hourly || Math.round(rate / 8);
    }
    const base = Math.round(units * rate);
    const fee = Math.round(base * 0.035);
    return { units, base, fee, total: base + fee };
  };

  const handleToggleFav = async () => {
    if (!user) return onRequireAuth();
    if (!listing) return;
    if (listing.isFavorite) {
      await apiFetch(`/api/favorites/${listing.id}`, { method: 'DELETE' });
      setListing({ ...listing, isFavorite: false });
      onFavoriteChanged(listing.id, false);
    } else {
      await apiFetch(`/api/favorites/${listing.id}`, { method: 'POST' });
      setListing({ ...listing, isFavorite: true });
      onFavoriteChanged(listing.id, true);
    }
  };

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onRequireAuth();
    if (!listing) return;
    setError('');
    setBookingMsg('');
    try {
      const res = await apiFetch<{ booking: Booking }>('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          listingId: listing.id,
          startDate,
          endDate,
          durationType,
          requestType,
          viewingRequestedAt: viewingTime,
          notes,
        }),
      });
      setCreatedBooking(res.booking);
      const agrRes = await apiFetch<{ agreement: any }>(`/api/bookings/${res.booking.id}/agreement`);
      setAgreement(agrRes.agreement);
      setBookingMsg('Request submitted. Review and sign the written agreement below.');
    } catch (err: any) {
      setError(err.message);
      if (err?.status === 402 || err?.data?.code === 'SUBSCRIPTION_REQUIRED') onRequireServicePass?.();
    }
  };

  const handleSignAgreement = async () => {
    if (!createdBooking || !user) return;
    setError('');
    try {
      const res = await apiFetch<{ booking: Booking; agreement: any }>(`/api/bookings/${createdBooking.id}/sign`, {
        method: 'PATCH',
        body: JSON.stringify({ signatureName: user.full_name }),
      });
      setCreatedBooking(res.booking);
      setAgreement(res.agreement);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handlePay = async () => {
    if (!createdBooking) return;
    setPaymentError('');
    try {
      const res = await apiFetch<{ checkoutUrl?: string; error?: string }>('/api/payments/initiate', {
        method: 'POST',
        body: JSON.stringify({
          bookingId: createdBooking.id,
          provider: selectedProvider,
          purpose: 'booking_payment',
        }),
      });
      if (res.checkoutUrl) {
        window.location.assign(res.checkoutUrl);
      }
    } catch (err: any) {
      setPaymentError(err.message);
      if (err?.status === 402 || err?.data?.code === 'SUBSCRIPTION_REQUIRED') onRequireServicePass?.();
    }
  };

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onRequireAuth();
    if (!listing) return;
    await apiFetch('/api/reports', {
      method: 'POST',
      body: JSON.stringify({
        targetType: 'listing',
        targetId: listing.id,
        reason: reportReason,
        details: reportDetails,
      }),
    });
    setShowReport(false);
    setBookingMsg('Report submitted to AZ RENTAL moderation team.');
  };

  const handleReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onRequireAuth();
    if (!listing) return;
    await apiFetch('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({ listingId: listing.id, rating, comment: reviewComment }),
    });
    setReviewComment('');
    const refreshed = await apiFetch<{ reviews: any[] }>(`/api/listings/${listing.id}`);
    setReviews(refreshed.reviews || []);
  };

  const est = estimateCost();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/65 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-5xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 my-6 overflow-hidden">
        {/* Top Modal Bar */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {listing ? `${listing.category_name_en} · ${listing.city}${listing.sub_city ? ' · ' + listing.sub_city : ''}` : 'Loading...'}
            </p>
            <h2 className="truncate text-lg font-bold text-[#123B65] dark:text-white">
              {listing ? (lang === 'am' && listing.title_am ? listing.title_am : listing.title) : 'Listing Details'}
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {listing && (
              <>
                <button
                  type="button"
                  onClick={handleToggleFav}
                  aria-label="Save favorite"
                  className={`rounded-lg border p-2 ${
                    listing.isFavorite
                      ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/40'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  <Heart className={`h-4 w-4 ${listing.isFavorite ? 'fill-current' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowReport(!showReport)}
                  aria-label="Report suspicious listing"
                  className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  <Flag className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close detail"
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {!listing ? (
          <div className="p-10 text-center text-sm text-slate-500">
            {error || 'Loading rental details...'}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
            {/* Left Column: Gallery, Specs, Map, Reviews */}
            <div className="lg:col-span-7 space-y-6">
              {/* Media Gallery */}
              <div>
                <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-800">
                  {showVideo && listing.video ? (
                    <video src={listing.video.url} controls autoPlay className="h-full w-full object-cover" />
                  ) : listing.images[activePhoto] ? (
                    <img
                      src={listing.images[activePhoto].url}
                      alt={listing.title}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                  {listing.images[activePhoto]?.is_watermarked === 1 && !showVideo && (
                    <span className="absolute bottom-3 left-3 rounded-md bg-slate-950/75 px-2.5 py-1 text-[11px] font-semibold text-white">
                      Protected by AZ RENTAL Watermark
                    </span>
                  )}
                </div>

                {/* Thumbnails */}
                <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
                  {listing.images.map((im, idx) => (
                    <button
                      key={im.id}
                      type="button"
                      onClick={() => { setShowVideo(false); setActivePhoto(idx); }}
                      className={`h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 ${
                        !showVideo && activePhoto === idx
                          ? 'border-[#F5A623]'
                          : 'border-transparent opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img src={im.url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                  {listing.video && (
                    <button
                      type="button"
                      onClick={() => setShowVideo(true)}
                      className={`flex h-16 w-24 shrink-0 flex-col items-center justify-center rounded-lg border-2 bg-slate-900 text-white text-[11px] font-semibold ${
                        showVideo ? 'border-[#F5A623]' : 'border-transparent opacity-80'
                      }`}
                    >
                      <Video className="h-4 w-4 text-[#F5A623]" />
                      <span>Video</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Description & Specs */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
                  {listing.is_verified === 1 && (
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                      <BadgeCheck className="h-4 w-4" /> Verified Listing
                    </span>
                  )}
                  <span>·</span>
                  <span>{listing.views_count} views</span>
                  {listing.distanceKm != null && (
                    <>
                      <span>·</span>
                      <span>{listing.distanceKm} km away</span>
                    </>
                  )}
                </div>

                <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {lang === 'am' && listing.description_am ? listing.description_am : listing.description}
                </p>

                {Object.keys(listing.specs || {}).length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2">
                    {Object.entries(listing.specs).map(([k, v]) => (
                      <div key={k} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/50">
                        <div className="text-[11px] capitalize text-slate-500">{k.replace(/([A-Z])/g, ' $1')}</div>
                        <div className="text-xs font-semibold text-slate-900 dark:text-white">{String(v)}</div>
                      </div>
                    ))}
                  </div>
                )}

                {listing.rental_conditions && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                    <strong className="block mb-1">Owner Rental Conditions</strong>
                    {listing.rental_conditions}
                  </div>
                )}
              </div>

              {/* Location Map */}
              <div>
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-[#123B65] dark:text-white mb-2">
                  <MapPin className="h-4 w-4 text-[#F5A623]" />
                  {listing.region} · {listing.city} {listing.sub_city ? `· ${listing.sub_city}` : ''} {listing.neighborhood ? `· ${listing.neighborhood}` : ''}
                </h3>
                <MapDiscovery
                  listings={[listing]}
                  userCoords={userCoords}
                  onSelectListing={() => {}}
                  heightClass="h-56"
                />
              </div>

              {/* Reviews */}
              <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
                <h3 className="text-sm font-bold text-[#123B65] dark:text-white mb-3">
                  Reviews ({reviews.length})
                </h3>
                {user && (
                  <form onSubmit={handleReview} className="mb-4 flex flex-col sm:flex-row gap-2">
                    <select
                      value={rating}
                      onChange={(e) => setRating(Number(e.target.value))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                    >
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>{n} Stars</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      required
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      placeholder="Share your rental experience..."
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                    />
                    <button type="submit" className="rounded-xl bg-[#123B65] px-4 py-2 text-xs font-semibold text-white">
                      Submit
                    </button>
                  </form>
                )}
                <div className="space-y-2.5">
                  {reviews.map((r) => (
                    <div key={r.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-900 dark:text-white">{r.reviewer_name}</span>
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
                          <Star className="h-3.5 w-3.5 fill-current" /> {r.rating}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{r.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Pricing, Owner Contact, Booking, Agreement & Payment */}
            <div className="lg:col-span-5 space-y-5">
              {/* Price Card */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-800/50">
                <div className="grid grid-cols-2 gap-3 tabular-nums">
                  {listing.price_daily && (
                    <div>
                      <div className="text-[11px] text-slate-500">Daily Rate</div>
                      <div className="text-lg font-bold text-[#123B65] dark:text-white">ETB {listing.price_daily.toLocaleString()}</div>
                    </div>
                  )}
                  {listing.price_weekly && (
                    <div>
                      <div className="text-[11px] text-slate-500">Weekly Rate</div>
                      <div className="text-lg font-bold text-[#123B65] dark:text-white">ETB {listing.price_weekly.toLocaleString()}</div>
                    </div>
                  )}
                  {listing.price_monthly && (
                    <div>
                      <div className="text-[11px] text-slate-500">Monthly Rate</div>
                      <div className="text-lg font-bold text-[#123B65] dark:text-white">ETB {listing.price_monthly.toLocaleString()}</div>
                    </div>
                  )}
                  {listing.price_hourly && (
                    <div>
                      <div className="text-[11px] text-slate-500">Hourly Rate</div>
                      <div className="text-lg font-bold text-[#123B65] dark:text-white">ETB {listing.price_hourly.toLocaleString()}</div>
                    </div>
                  )}
                </div>

                {/* Owner & Direct Communication */}
                {listing.owner && (
                  <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
                          {listing.owner.business_name || listing.owner.full_name}
                          {(listing.owner.identity_verified === 1 || listing.owner.business_verified === 1) && (
                            <BadgeCheck className="h-4 w-4 text-emerald-600" />
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          {listing.owner.city} · {(listing.owner.identity_verified === 1 || listing.owner.business_verified === 1) ? 'Verified Owner' : 'Unverified Owner'}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => (user ? onStartChat(listing) : onRequireAuth())}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#123B65] py-2.5 text-xs font-semibold text-white hover:bg-[#0f3154]"
                      >
                        <MessageSquare className="h-3.5 w-3.5" /> Chat
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          user
                            ? onStartCall(listing.owner_id, listing.owner!.full_name, 'audio')
                            : onRequireAuth()
                        }
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      >
                        <Phone className="h-3.5 w-3.5 text-emerald-600" /> Audio
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          user
                            ? onStartCall(listing.owner_id, listing.owner!.full_name, 'video')
                            : onRequireAuth()
                        }
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      >
                        <Video className="h-3.5 w-3.5 text-[#F5A623]" /> Video
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {showReport && (
                <form onSubmit={handleReport} className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-2.5 dark:border-red-900/50 dark:bg-red-950/30">
                  <div className="flex items-center gap-2 text-xs font-bold text-red-700 dark:text-red-300">
                    <ShieldAlert className="h-4 w-4" /> Report Suspicious Listing
                  </div>
                  <select
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-xs dark:bg-slate-900"
                  >
                    <option>Suspected scam or fake listing</option>
                    <option>Owner demanded payment before written agreement</option>
                    <option>Misleading photos or inaccurate price</option>
                    <option>Duplicate or spam post</option>
                  </select>
                  <textarea
                    rows={2}
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    placeholder="Provide details for AZ RENTAL moderators..."
                    className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-xs dark:bg-slate-900"
                  />
                  <button type="submit" className="w-full rounded-lg bg-red-600 py-2 text-xs font-semibold text-white">
                    Submit Fraud Report
                  </button>
                </form>
              )}

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </div>
              )}
              {bookingMsg && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {bookingMsg}
                </div>
              )}

              {/* Booking / Viewing Request Form */}
              {!createdBooking ? (
                <form onSubmit={handleBook} className="rounded-2xl border border-slate-200 p-5 space-y-3.5 dark:border-slate-800">
                  <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                    <button
                      type="button"
                      onClick={() => setRequestType('rental')}
                      className={`rounded-lg py-2 text-xs font-semibold ${
                        requestType === 'rental' ? 'bg-white text-[#123B65] shadow-sm dark:bg-slate-900 dark:text-white' : 'text-slate-600'
                      }`}
                    >
                      Request Rental
                    </button>
                    <button
                      type="button"
                      onClick={() => setRequestType('viewing')}
                      className={`rounded-lg py-2 text-xs font-semibold ${
                        requestType === 'viewing' ? 'bg-white text-[#123B65] shadow-sm dark:bg-slate-900 dark:text-white' : 'text-slate-600'
                      }`}
                    >
                      Request Viewing
                    </button>
                  </div>

                  {bookedDates.length > 0 && (
                    <div className="text-[11px] text-amber-700 dark:text-amber-300">
                      Reserved ranges: {bookedDates.map((b) => `${b.start_date} to ${b.end_date}`).join(', ')}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">Start Date</label>
                      <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">End Date</label>
                      <input type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                    </div>
                  </div>

                  {requestType === 'rental' ? (
                    <>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">Billing Unit</label>
                        <select value={durationType} onChange={(e) => setDurationType(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800">
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          {listing.price_hourly && <option value="hourly">Hourly</option>}
                        </select>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 text-xs space-y-1.5 tabular-nums dark:bg-slate-800/50">
                        <div className="flex justify-between"><span>Base Rent ({est.units} {durationType})</span><span>ETB {est.base.toLocaleString()}</span></div>
                        <div className="flex justify-between text-slate-500"><span>AZ RENTAL Service Fee (3.5%)</span><span>ETB {est.fee.toLocaleString()}</span></div>
                        <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-[#123B65] dark:border-slate-700 dark:text-white">
                          <span>Estimated Total</span>
                          <span>ETB {est.total.toLocaleString()}</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">Preferred Viewing Time</label>
                      <input type="text" value={viewingTime} onChange={(e) => setViewingTime(e.target.value)} placeholder="e.g. Tomorrow at 10:00 AM" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                    </div>
                  )}

                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Message or special requests to owner..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                  />

                  <button
                    type="submit"
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#F5A623] py-3 text-xs font-bold text-[#123B65] hover:bg-[#e59816]"
                  >
                    <Calendar className="h-4 w-4" />
                    {requestType === 'viewing' ? 'Send Viewing Request' : 'Send Rental Request'}
                  </button>
                </form>
              ) : (
                /* Agreement & Payment Workflow */
                <div className="rounded-2xl border border-slate-200 p-5 space-y-4 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#123B65] dark:text-white">
                      Booking #{createdBooking.id} — {createdBooking.status}
                    </span>
                    <span className="font-mono text-xs font-bold">ETB {createdBooking.total_amount.toLocaleString()}</span>
                  </div>

                  {agreement && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] whitespace-pre-wrap leading-relaxed dark:border-slate-700 dark:bg-slate-800">
                      {lang === 'am' ? agreement.terms_am : agreement.terms_en}
                    </div>
                  )}

                  {!createdBooking.agreement_signed_by_renter ? (
                    <button
                      type="button"
                      onClick={handleSignAgreement}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#123B65] py-2.5 text-xs font-bold text-white"
                    >
                      <CheckCircle2 className="h-4 w-4 text-[#F5A623]" />
                      Sign Written Agreement (በውል የከራዩ)
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        Agreement signed by you. Select Ethiopian payment gateway:
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
                                name="provider"
                                checked={selectedProvider === p.id}
                                onChange={() => setSelectedProvider(p.id)}
                              />
                              <div>
                                <div className="font-semibold">{p.name}</div>
                                <div className="text-[10px] text-slate-500">{p.nameAm}</div>
                              </div>
                            </div>
                            <span className={`text-[10px] font-semibold ${p.configured ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {p.configured ? 'Live Ready' : 'Needs Merchant Keys'}
                            </span>
                          </label>
                        ))}
                      </div>
                      {paymentError && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                          {paymentError}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={handlePay}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#F5A623] py-2.5 text-xs font-bold text-[#123B65]"
                      >
                        <CreditCard className="h-4 w-4" />
                        Proceed to {selectedProvider.toUpperCase()} Checkout
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

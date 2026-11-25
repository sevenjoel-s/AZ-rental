import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Bell,
  BookmarkPlus,
  Car,
  ChevronLeft,
  ChevronRight,
  Compass,
  Globe,
  Hammer,
  Heart,
  Home,
  LayoutDashboard,
  LogOut,
  MapPin,
  MessageSquare,
  Moon,
  Package,
  PartyPopper,
  Plus,
  Search,
  Shield,
  SlidersHorizontal,
  Sun,
  Truck,
  User as UserIcon,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthModal } from './components/AuthModal';
import { ChatAndCallsView, WebRTCCallOverlay } from './components/ChatAndCallsView';
import { ListingDetailModal } from './components/ListingDetailModal';
import { MapDiscovery } from './components/MapDiscovery';
import { PostRentalModal } from './components/PostRentalModal';
import { SafetyBanners } from './components/SafetyBanners';
import { ServicePassModal } from './components/ServicePassModal';
import { UserDashboard } from './components/UserDashboard';
import { OfflineIndicator, PWAInstallButton } from './hooks/usePWAInstall';
import { useRealtime } from './hooks/useRealtime';
import { createTranslator } from './i18n/translations';
import { apiFetch, setAccessToken } from './lib/api';
import type {
  Banner,
  Category,
  ChatMessage,
  LanguageCode,
  Listing,
  LocationItem,
  NotificationItem,
  User,
} from './types';

type AppView = 'explore' | 'map' | 'messages' | 'dashboard' | 'admin';

const ADMIN_ROLE_SET = new Set(['super_admin', 'admin', 'support', 'finance', 'moderator']);

function CategoryIcon({ slug, className }: { slug: string; className?: string }) {
  if (slug === 'house') return <Home className={className} />;
  if (slug === 'car') return <Car className={className} />;
  if (slug === 'construction') return <Hammer className={className} />;
  if (slug === 'machinery') return <Truck className={className} />;
  if (slug === 'event') return <PartyPopper className={className} />;
  return <Package className={className} />;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<AppView>('explore');
  const [lang, setLang] = useState<LanguageCode>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('az_lang') : null;
    return (saved as LanguageCode) || 'en';
  });
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return typeof localStorage !== 'undefined' && localStorage.getItem('az_theme') === 'dark';
  });

  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [translationOverrides, setTranslationOverrides] = useState<Record<string, string>>({});

  // Search & Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ label: string; kind: string }>>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>('');
  const [cityFilter, setCityFilter] = useState('');
  const [subCityFilter, setSubCityFilter] = useState('');
  const [neighborhoodFilter, setNeighborhoodFilter] = useState('');
  const [durationFilter, setDurationFilter] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>('monthly');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sortBy, setSortBy] = useState('newest');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

  const [listings, setListings] = useState<Listing[]>([]);
  const [loadingListings, setLoadingListings] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Modals & Interactive Overlays
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register_renter' | 'register_landlord' | 'admin_setup'>('login');
  const [postModalOpen, setPostModalOpen] = useState(false);
  const [servicePassModalOpen, setServicePassModalOpen] = useState(false);
  const [servicePassNotice, setServicePassNotice] = useState('');
  const [selectedListingId, setSelectedListingId] = useState<number | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);

  // Notifications & Sound
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(0.7);
  const [showNotifPermissionPopup, setShowNotifPermissionPopup] = useState(false);

  // Real-time messaging events forwarded to ChatAndCallsView
  const [incomingMessage, setIncomingMessage] = useState<ChatMessage | null>(null);
  const [editedMessage, setEditedMessage] = useState<ChatMessage | null>(null);
  const [deletedMessage, setDeletedMessage] = useState<{ id: number; conversation_id: number } | null>(null);
  const [readPayload, setReadPayload] = useState<{ conversationId: number; readerId: number } | null>(null);
  const [typingPayload, setTypingPayload] = useState<{ conversationId: number; userId: number; isTyping: boolean } | null>(null);

  const t = useMemo(() => createTranslator(lang, translationOverrides), [lang, translationOverrides]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem('az_theme', darkMode ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [darkMode]);

  useEffect(() => {
    try {
      localStorage.setItem('az_lang', lang);
    } catch {
      // ignore
    }
    apiFetch<{ translations: Array<{ key: string; value: string }> }>(`/api/translations?lang=${lang}`)
      .then((res) => {
        const map: Record<string, string> = {};
        (res.translations || []).forEach((item) => {
          map[item.key] = item.value;
        });
        setTranslationOverrides(map);
      })
      .catch(() => {});
  }, [lang]);

  // Delayed notification permission prompt (never an arrival popup on page load)
  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
    const dismissed = typeof localStorage !== 'undefined' && localStorage.getItem('az_notif_prompt_handled') === '1';
    if (dismissed) return;
    const timer = setTimeout(() => {
      setShowNotifPermissionPopup(true);
    }, 12000);
    return () => clearTimeout(timer);
  }, []);

  const loadPublicBootstrap = useCallback(async () => {
    try {
      const [cRes, lRes, bRes] = await Promise.all([
        apiFetch<{ categories: Category[] }>('/api/categories'),
        apiFetch<{ locations: LocationItem[] }>('/api/locations'),
        apiFetch<{ banners: Banner[] }>('/api/banners'),
      ]);
      setCategories(cRes.categories || []);
      setLocations(lRes.locations || []);
      setBanners(bRes.banners || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadPublicBootstrap();
    apiFetch<{ user: User | null; token?: string }>('/api/auth/me')
      .then((res) => {
        if (res.user) {
          if (res.token) setAccessToken(res.token);
          setUser(res.user);
        }
      })
      .catch(() => {});
  }, [loadPublicBootstrap]);

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch<{ notifications: NotificationItem[]; unreadCount: number }>('/api/notifications');
      setNotifications(res.notifications || []);
      setUnreadNotifs(res.unreadCount || 0);
    } catch {
      // ignore
    }
  }, [user?.id]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const txRef = params.get('tx_ref');
    if (params.get('payment') === 'return' && txRef) {
      apiFetch<{ paid?: boolean; user?: User; message?: string }>(
        `/api/subscription/verify/${encodeURIComponent(txRef)}`
      )
        .then((res) => {
          if (res.user) setUser(res.user);
          if (res.message) setServicePassNotice(res.message);
        })
        .catch(() => {})
        .finally(() => {
          const cleanUrl = window.location.pathname;
          window.history.replaceState({}, '', cleanUrl);
        });
    }
  }, [user?.id]);

  const realtime = useRealtime({
    user,
    soundEnabled,
    soundVolume,
    onNewMessage: (msg) => setIncomingMessage(msg),
    onMessageEdit: (msg) => setEditedMessage(msg),
    onMessageDelete: (payload) => setDeletedMessage(payload),
    onMessagesRead: (payload) => setReadPayload(payload),
    onTyping: (payload) => setTypingPayload(payload),
    onNewNotification: (notif) => {
      setNotifications((prev) => [notif, ...prev]);
      setUnreadNotifs((c) => c + 1);
    },
    onCallError: (err) => {
      setServicePassNotice(err.error);
      if (err.code === 'SUBSCRIPTION_REQUIRED') {
        setServicePassModalOpen(true);
      }
    },
  });

  const fetchListings = useCallback(
    async (targetPage = page) => {
      setLoadingListings(true);
      try {
        const params = new URLSearchParams();
        if (searchQuery.trim()) params.set('q', searchQuery.trim());
        if (selectedCategory) params.set('category', selectedCategory);
        if (selectedSubcategory) params.set('subcategory', selectedSubcategory);
        if (cityFilter) params.set('city', cityFilter);
        if (subCityFilter) params.set('subCity', subCityFilter);
        if (neighborhoodFilter) params.set('neighborhood', neighborhoodFilter);
        if (durationFilter !== 'custom') params.set('duration', durationFilter);
        if (startDate && endDate) {
          params.set('startDate', startDate);
          params.set('endDate', endDate);
        }
        if (minPrice) params.set('minPrice', minPrice);
        if (maxPrice) params.set('maxPrice', maxPrice);
        if (verifiedOnly) params.set('verifiedOnly', 'true');
        if (sortBy) params.set('sort', sortBy);
        if (userCoords) {
          params.set('lat', String(userCoords.lat));
          params.set('lng', String(userCoords.lng));
        }
        params.set('page', String(targetPage));
        params.set('limit', '9');

        const res = await apiFetch<{
          listings: Listing[];
          pagination: { page: number; totalPages: number; total: number };
        }>(`/api/listings?${params.toString()}`);

        setListings(res.listings || []);
        setTotalPages(res.pagination?.totalPages || 1);
        setTotalCount(res.pagination?.total || 0);
      } catch {
        setListings([]);
      } finally {
        setLoadingListings(false);
      }
    },
    [
      page,
      searchQuery,
      selectedCategory,
      selectedSubcategory,
      cityFilter,
      subCityFilter,
      neighborhoodFilter,
      durationFilter,
      startDate,
      endDate,
      minPrice,
      maxPrice,
      verifiedOnly,
      sortBy,
      userCoords,
    ]
  );

  useEffect(() => {
    fetchListings(page);
  }, [fetchListings, page]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch<{ suggestions: Array<{ label: string; kind: string }> }>(
        `/api/listings/suggestions?q=${encodeURIComponent(searchQuery.trim())}`
      )
        .then((res) => setSuggestions(res.suggestions || []))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleUseGps = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setSortBy('nearest');
      setPage(1);
    });
  };

  const handleSaveCurrentSearch = async () => {
    if (!user) {
      setAuthModalMode('login');
      setAuthModalOpen(true);
      return;
    }
    await apiFetch('/api/saved-searches', {
      method: 'POST',
      body: JSON.stringify({
        name: `${selectedCategory || 'All'} in ${cityFilter || 'Ethiopia'}`,
        filters: { searchQuery, selectedCategory, cityFilter, minPrice, maxPrice, durationFilter },
        alertEnabled: true,
      }),
    });
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('');
    setSelectedSubcategory('');
    setCityFilter('');
    setSubCityFilter('');
    setNeighborhoodFilter('');
    setStartDate('');
    setEndDate('');
    setMinPrice('');
    setMaxPrice('');
    setVerifiedOnly(false);
    setSortBy('newest');
    setPage(1);
  };

  const handlePostRentalClick = () => {
    if (!user) {
      setAuthModalMode('register_landlord');
      setAuthModalOpen(true);
      return;
    }
    if (!user.subscription_active) {
      setServicePassModalOpen(true);
      return;
    }
    if (!user.roles.includes('landlord') && !user.roles.some((r) => ADMIN_ROLE_SET.has(r))) {
      setView('dashboard');
      return;
    }
    setPostModalOpen(true);
  };

  const handleStartChatForListing = async (listing: Listing) => {
    if (!user) {
      setAuthModalMode('login');
      setAuthModalOpen(true);
      return;
    }
    if (!user.subscription_active) {
      setServicePassModalOpen(true);
      return;
    }
    try {
      const res = await apiFetch<{ conversation: { id: number } }>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ listingId: listing.id, ownerId: listing.owner_id }),
      });
      setSelectedListingId(null);
      setActiveConversationId(res.conversation.id);
      setView('messages');
    } catch (err: any) {
      if (err?.status === 402 || err?.data?.code === 'SUBSCRIPTION_REQUIRED') {
        setServicePassModalOpen(true);
      }
    }
  };

  const handleGuardedStartCall = (
    peerId: number,
    peerName: string,
    callType: 'audio' | 'video',
    conversationId?: number
  ) => {
    if (!user) {
      setAuthModalMode('login');
      setAuthModalOpen(true);
      return;
    }
    if (!user.subscription_active) {
      setServicePassModalOpen(true);
      return;
    }
    realtime.startCall(peerId, peerName, callType, conversationId);
  };

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setAccessToken(null);
    setUser(null);
    setView('explore');
  };

  const isAdmin = Boolean(user && user.roles.some((r) => ADMIN_ROLE_SET.has(r)));
  const activeCatObj = categories.find((c) => c.slug === selectedCategory);
  const uniqueCities = Array.from(new Set(locations.map((l) => l.city)));

  return (
    <div className="min-h-screen bg-[#F1F4F8] text-[#172033] dark:bg-slate-950 dark:text-slate-100 pb-20 md:pb-8">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
          {/* Zone 1: Brand Wordmark Only */}
          <button
            type="button"
            onClick={() => setView('explore')}
            className="flex items-center gap-2.5 whitespace-nowrap shrink-0 text-left"
          >
            <img
              src="/assets/aistudio/Glossy_AZ_Rental_App_Icon_2ee6fab8.png"
              alt="AZ RENTAL"
              className="h-9 w-9 rounded-xl object-cover"
            />
            <span className="font-display text-lg font-extrabold tracking-tight text-[#123B65] dark:text-white">
              {t('brand')}
            </span>
          </button>

          {/* Zone 2: Concise Single-Line Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
            <button
              type="button"
              onClick={() => setView('explore')}
              className={`whitespace-nowrap shrink-0 hover:text-[#123B65] dark:hover:text-white ${
                view === 'explore' ? 'font-bold text-[#123B65] dark:text-[#F5A623] underline underline-offset-8 decoration-2' : ''
              }`}
            >
              {t('navExplore')}
            </button>
            <button
              type="button"
              onClick={() => setView('map')}
              className={`whitespace-nowrap shrink-0 hover:text-[#123B65] dark:hover:text-white ${
                view === 'map' ? 'font-bold text-[#123B65] dark:text-[#F5A623] underline underline-offset-8 decoration-2' : ''
              }`}
            >
              {t('navMap')}
            </button>
            <button
              type="button"
              onClick={() => (user ? setView('messages') : (setAuthModalMode('login'), setAuthModalOpen(true)))}
              className={`whitespace-nowrap shrink-0 hover:text-[#123B65] dark:hover:text-white ${
                view === 'messages' ? 'font-bold text-[#123B65] dark:text-[#F5A623] underline underline-offset-8 decoration-2' : ''
              }`}
            >
              {t('navMessages')}
            </button>
            <button
              type="button"
              onClick={() => (user ? setView('dashboard') : (setAuthModalMode('login'), setAuthModalOpen(true)))}
              className={`whitespace-nowrap shrink-0 hover:text-[#123B65] dark:hover:text-white ${
                view === 'dashboard' ? 'font-bold text-[#123B65] dark:text-[#F5A623] underline underline-offset-8 decoration-2' : ''
              }`}
            >
              {t('navDashboard')}
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setView('admin')}
                className={`whitespace-nowrap shrink-0 hover:text-[#123B65] dark:hover:text-white ${
                  view === 'admin' ? 'font-bold text-[#123B65] dark:text-[#F5A623] underline underline-offset-8 decoration-2' : ''
                }`}
              >
                {t('navAdmin')}
              </button>
            )}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={user ? handlePostRentalClick : () => { setAuthModalMode('login'); setAuthModalOpen(true); }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#F5A623] px-4 py-2 text-xs font-bold text-[#123B65] hover:bg-[#e59816] transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              {user ? (
                <>
                  <Plus className="h-4 w-4" />
                  {t('postRental')}
                </>
              ) : (
                t('signIn')
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Workspace Utility Strip (Language, Theme, Notifications, PWA Install, Account) */}
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8 text-xs">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <MapPin className="h-3.5 w-3.5 text-[#F5A623]" />
            <span>Ethiopia Rental Network · ETB</span>
            {user && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-[#123B65] dark:text-white">
                  {user.full_name} ({user.active_role})
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Language Selector */}
            <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800">
              <Globe className="h-3.5 w-3.5 text-[#123B65] dark:text-[#F5A623]" />
              <select
                aria-label="Language selector"
                value={lang}
                onChange={(e) => setLang(e.target.value as LanguageCode)}
                className="bg-transparent text-xs font-semibold focus:outline-none dark:text-white"
              >
                <option value="en">English</option>
                <option value="am">አማርኛ</option>
                <option value="om">Afaan Oromo</option>
                <option value="ti">ትግርኛ</option>
                <option value="so">Soomaali</option>
              </select>
            </div>

            {/* Theme Switch */}
            <button
              type="button"
              onClick={() => setDarkMode(!darkMode)}
              aria-label="Toggle light or dark theme"
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="h-4 w-4 text-[#F5A623]" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* Notification Bell + Sound Mute */}
            {user && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                  aria-label="Open notifications"
                  className="relative rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Bell className="h-4 w-4" />
                  {unreadNotifs > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                      {unreadNotifs}
                    </span>
                  )}
                </button>

                {showNotifDropdown && (
                  <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl z-50 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2 dark:border-slate-800">
                      <span className="font-bold text-xs">Notifications</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSoundEnabled(!soundEnabled)}
                          title={soundEnabled ? 'Mute sound' : 'Unmute sound'}
                          className="text-slate-500 hover:text-slate-900 dark:hover:text-white"
                        >
                          {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch('/api/notifications/read-all', { method: 'POST' });
                            loadNotifications();
                          }}
                          className="text-[11px] font-semibold text-[#123B65] dark:text-[#F5A623]"
                        >
                          Mark all read
                        </button>
                      </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                      {notifications.length === 0 ? (
                        <p className="text-xs text-slate-500 py-3 text-center">No notifications</p>
                      ) : (
                        notifications.slice(0, 10).map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/notifications/${n.id}/read`, { method: 'PATCH' });
                              loadNotifications();
                              setShowNotifDropdown(false);
                              if (n.link === '/messages') setView('messages');
                              else setView('dashboard');
                            }}
                            className={`w-full text-left rounded-xl p-2.5 text-xs ${
                              n.is_read ? 'bg-slate-50 dark:bg-slate-800/40' : 'bg-amber-50/70 dark:bg-amber-950/30'
                            }`}
                          >
                            <div className="font-semibold">{lang === 'am' ? n.title_am : n.title}</div>
                            <div className="text-[11px] text-slate-500 mt-0.5">{lang === 'am' ? n.body_am : n.body}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <PWAInstallButton label={t('installApp')} />

            {!user ? (
              <button
                type="button"
                onClick={() => { setAuthModalMode('register_renter'); setAuthModalOpen(true); }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-[#123B65] hover:bg-slate-50 dark:border-slate-700 dark:text-white"
              >
                {t('register')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
              >
                <LogOut className="h-3.5 w-3.5" /> Logout
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Service Pass Banner (50 ETB Registration / Monthly Renewal Notice) */}
      {user && !user.subscription_active && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 sm:px-6 lg:px-8">
            <span>
              {user.subscription_status === 'expired' || user.has_prior_subscription
                ? 'Your 1-month service pass has expired. No new registration is needed — pay 50 ETB to continue using AZ RENTAL.'
                : 'New member activation: Pay 50 ETB for your 1-month (30-day) AZ RENTAL service pass to book, message, call, or post listings.'}
            </span>
            <button
              type="button"
              onClick={() => setServicePassModalOpen(true)}
              className="rounded-lg bg-[#123B65] px-3.5 py-1.5 font-bold text-white hover:bg-[#0e2e4f]"
            >
              Pay 50 ETB Now
            </button>
          </div>
        </div>
      )}

      {servicePassNotice && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 sm:px-6 lg:px-8">
            <span>{servicePassNotice}</span>
            <button type="button" onClick={() => setServicePassNotice('')} className="font-bold underline">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* MAIN VIEWPORT */}
      {view === 'explore' && (
        <main>
          {/* Hero Section */}
          <section className="bg-[#123B65] text-white">
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                <div className="lg:col-span-7 flex flex-col justify-center space-y-4">
                  <div className="flex items-center gap-3">
                    <img
                      src="/assets/aistudio/AZ_Rental__Find_It__Rent_It__Enjoy_It_bcf1d116.png"
                      alt="AZ RENTAL Logo"
                      className="h-14 w-14 rounded-xl bg-white p-1 object-contain"
                    />
                    <div>
                      <p className="text-xs font-semibold text-[#F5A623]">Ethiopia&apos;s Direct Rental Marketplace</p>
                      <p className="text-xs text-slate-200">ቤትዎን በቀላሉ ያግኙ፣ ከአከራይ ጋር በቀጥታ ይገናኙ!</p>
                    </div>
                  </div>

                  <h1 className="font-display text-3xl sm:text-4xl lg:text-[42px] font-extrabold leading-tight [text-wrap:balance]">
                    {t('slogan')}
                  </h1>

                  <p className="max-w-2xl text-sm text-slate-200 leading-relaxed">
                    Houses, condominiums, cars, construction gear, heavy machinery, and event equipment across Addis Ababa, Adama, Hawassa, Bahir Dar, Dire Dawa, and all Ethiopian regions.
                  </p>

                  {/* Visible Search Bar + POST RENTAL Posting Bar */}
                  <div className="relative pt-2">
                    <div className="flex flex-col sm:flex-row gap-2 rounded-2xl bg-white p-2 text-slate-900 shadow-lg dark:bg-slate-900 dark:text-white">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setPage(1);
                          }}
                          placeholder={t('searchPlaceholder')}
                          className="w-full rounded-xl bg-transparent py-2.5 pl-9 pr-3 text-sm focus:outline-none"
                        />
                        {suggestions.length > 0 && (
                          <div className="absolute left-0 right-0 top-12 z-30 rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                            {suggestions.map((s, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => {
                                  setSearchQuery(s.label.split(' · ')[0]);
                                  setSuggestions([]);
                                  setPage(1);
                                }}
                                className="flex w-full items-center justify-between px-3.5 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                              >
                                <span>{s.label}</span>
                                <span className="text-[10px] text-slate-400 capitalize">{s.kind}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => fetchListings(1)}
                        className="rounded-xl bg-[#123B65] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#0e2e4f] whitespace-nowrap shrink-0"
                      >
                        {t('searchBtn')}
                      </button>
                      <button
                        type="button"
                        onClick={handlePostRentalClick}
                        className="rounded-xl bg-[#F5A623] px-5 py-2.5 text-xs font-bold text-[#123B65] hover:bg-[#e59816] whitespace-nowrap shrink-0"
                      >
                        POST RENTAL
                      </button>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-5">
                  <div className="h-full overflow-hidden rounded-2xl border border-white/15 bg-white/5">
                    <img
                      src="/assets/aistudio/AZ_Rental_Marketplace_Banner_4caadd34.png"
                      alt="AZ RENTAL Marketplace Showcase"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover min-h-[220px]"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 3 Mandatory Rotating Safety Banners */}
          <SafetyBanners banners={banners} lang={lang} />

          {/* Category Tabs & Advanced Filters */}
          <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 space-y-4">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory('');
                  setSelectedSubcategory('');
                  setPage(1);
                }}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  selectedCategory === ''
                    ? 'bg-[#123B65] text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-200'
                }`}
              >
                {t('allCategories')}
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(cat.slug);
                    setSelectedSubcategory('');
                    setPage(1);
                  }}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                    selectedCategory === cat.slug
                      ? 'bg-[#123B65] text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-200'
                  }`}
                >
                  <CategoryIcon slug={cat.slug} className="h-4 w-4 text-[#F5A623]" />
                  <span>{lang === 'am' ? cat.name_am : cat.name_en}</span>
                </button>
              ))}
            </div>

            {/* Subcategories if a category is selected */}
            {activeCatObj && activeCatObj.subcategories.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => { setSelectedSubcategory(''); setPage(1); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                    !selectedSubcategory ? 'bg-[#F5A623] text-[#123B65] font-bold' : 'bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  All {activeCatObj.name_en}
                </button>
                {activeCatObj.subcategories.map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => { setSelectedSubcategory(sc.slug); setPage(1); }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                      selectedSubcategory === sc.slug
                        ? 'bg-[#F5A623] text-[#123B65] font-bold'
                        : 'bg-white border border-slate-200 text-slate-600 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {lang === 'am' ? sc.name_am : sc.name_en}
                  </button>
                ))}
              </div>
            )}

            {/* Filter & Sort Toolbar */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Duration tabs */}
                  <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                    {(['daily', 'weekly', 'monthly', 'custom'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => { setDurationFilter(d); setPage(1); }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${
                          durationFilter === d ? 'bg-white text-[#123B65] shadow-sm dark:bg-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {d === 'custom' ? t('customDates') : t(d)}
                      </button>
                    ))}
                  </div>

                  <select
                    value={cityFilter}
                    onChange={(e) => { setCityFilter(e.target.value); setPage(1); }}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="">All Ethiopian Cities</option>
                    {uniqueCities.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={handleUseGps}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${
                      userCoords
                        ? 'border-[#123B65] bg-[#123B65]/10 text-[#123B65] dark:border-[#F5A623] dark:text-[#F5A623]'
                        : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <Compass className="h-3.5 w-3.5" />
                    {t('nearMe')}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold dark:border-slate-700"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Filters
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={sortBy}
                    onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="newest">{t('sortNewest')}</option>
                    <option value="lowest_price">{t('sortLowest')}</option>
                    <option value="highest_price">{t('sortHighest')}</option>
                    <option value="nearest">{t('sortNearest')}</option>
                    <option value="popular">{t('sortPopular')}</option>
                    <option value="verified">{t('sortVerified')}</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleSaveCurrentSearch}
                    title="Save Search Alert"
                    className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                  >
                    <BookmarkPlus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {(showAdvancedFilters || durationFilter === 'custom') && (
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <input type="text" value={subCityFilter} onChange={(e) => setSubCityFilter(e.target.value)} placeholder="Sub-city (e.g. Bole)" className="rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                  <input type="text" value={neighborhoodFilter} onChange={(e) => setNeighborhoodFilter(e.target.value)} placeholder="Neighborhood" className="rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                  <input type="number" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="Min ETB" className="rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                  <input type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="Max ETB" className="rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Available from" className="rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-label="Available until" className="rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" />
                  <label className="col-span-2 flex items-center gap-2 text-xs font-medium">
                    <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />
                    {t('verifiedOnly')}
                  </label>
                </div>
              )}
            </div>
          </section>

          {/* Listings Grid */}
          <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
            <div className="mb-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Showing {listings.length} of {totalCount} verified & active Ethiopian rentals</span>
              <button type="button" onClick={() => setView('map')} className="font-semibold text-[#123B65] hover:underline dark:text-[#F5A623]">
                Open Interactive Map
              </button>
            </div>

            {loadingListings ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
                ))}
              </div>
            ) : listings.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-900">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('noResults')}</p>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="mt-4 rounded-xl bg-[#123B65] px-5 py-2.5 text-xs font-bold text-white"
                >
                  {t('clearFilters')}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {listings.map((item) => {
                  const displayPrice =
                    durationFilter === 'daily'
                      ? item.price_daily || item.effective_price
                      : durationFilter === 'weekly'
                      ? item.price_weekly || item.effective_price
                      : item.price_monthly || item.price_daily || item.effective_price;
                  const unitLabel =
                    durationFilter === 'daily'
                      ? t('perDay')
                      : durationFilter === 'weekly'
                      ? t('perWeek')
                      : item.price_monthly
                      ? t('perMonth')
                      : t('perDay');

                  return (
                    <article
                      key={item.id}
                      onClick={() => setSelectedListingId(item.id)}
                      className="group cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white transition-transform hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                        {item.images[0] ? (
                          <img
                            src={item.images[0].url}
                            alt={item.title}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-slate-400">
                            <Home className="h-8 w-8" />
                          </div>
                        )}

                        <button
                          type="button"
                          aria-label="Toggle favorite"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!user) {
                              setAuthModalMode('login');
                              setAuthModalOpen(true);
                              return;
                            }
                            if (item.isFavorite) {
                              await apiFetch(`/api/favorites/${item.id}`, { method: 'DELETE' });
                              setListings((prev) => prev.map((x) => (x.id === item.id ? { ...x, isFavorite: false } : x)));
                            } else {
                              await apiFetch(`/api/favorites/${item.id}`, { method: 'POST' });
                              setListings((prev) => prev.map((x) => (x.id === item.id ? { ...x, isFavorite: true } : x)));
                            }
                          }}
                          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-sm hover:bg-white dark:bg-slate-900/90 dark:text-slate-200"
                        >
                          <Heart className={`h-4 w-4 ${item.isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
                        </button>
                      </div>

                      <div className="p-4 space-y-2">
                        {/* Zero-pill unboxed metadata line */}
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                          <span>{lang === 'am' ? item.category_name_am : item.category_name_en}</span>
                          <span aria-hidden="true">·</span>
                          <span>{item.city}{item.sub_city ? `, ${item.sub_city}` : ''}</span>
                          {item.distanceKm != null && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{item.distanceKm} km</span>
                            </>
                          )}
                        </div>

                        <h3 className="text-base font-bold text-[#172033] dark:text-white line-clamp-1">
                          {lang === 'am' && item.title_am ? item.title_am : item.title}
                        </h3>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                          <div className="tabular-nums">
                            <span className="text-base font-extrabold text-[#123B65] dark:text-[#F5A623]">
                              ETB {Number(displayPrice || 0).toLocaleString()}
                            </span>
                            <span className="ml-1 text-xs text-slate-500">{unitLabel}</span>
                          </div>

                          {item.owner && (item.owner.identity_verified === 1 || item.owner.business_verified === 1) && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                              <BadgeCheck className="h-4 w-4" /> Verified
                            </span>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-3">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold disabled:opacity-40 dark:border-slate-800 dark:bg-slate-900"
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </button>
                <span className="text-xs font-semibold tabular-nums">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold disabled:opacity-40 dark:border-slate-800 dark:bg-slate-900"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </section>
        </main>
      )}

      {view === 'map' && (
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-[#123B65] dark:text-white">Map-Based Rental Discovery across Ethiopia</h1>
              <p className="text-xs text-slate-500">Click any ETB marker pin to view property, vehicle, or equipment details.</p>
            </div>
            <button
              type="button"
              onClick={handleUseGps}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#123B65] px-4 py-2 text-xs font-bold text-white"
            >
              <Compass className="h-4 w-4 text-[#F5A623]" /> Detect My Location
            </button>
          </div>
          <MapDiscovery
            listings={listings}
            userCoords={userCoords}
            onSelectListing={(item) => setSelectedListingId(item.id)}
            heightClass="h-[600px]"
          />
        </main>
      )}

      {view === 'messages' && user && (
        <ChatAndCallsView
          user={user}
          onlineUserIds={realtime.onlineUserIds}
          initialConversationId={activeConversationId}
          incomingMessage={incomingMessage}
          editedMessage={editedMessage}
          deletedMessage={deletedMessage}
          readPayload={readPayload}
          typingPayload={typingPayload}
          sendWs={realtime.sendWs}
          onStartCall={handleGuardedStartCall}
          onRequireServicePass={() => setServicePassModalOpen(true)}
        />
      )}

      {view === 'dashboard' && user && (
        <UserDashboard
          user={user}
          lang={lang}
          soundEnabled={soundEnabled}
          soundVolume={soundVolume}
          onSoundConfigChange={(en, vol) => {
            setSoundEnabled(en);
            setSoundVolume(vol);
          }}
          onUserUpdated={setUser}
          onOpenListing={(id) => setSelectedListingId(id)}
          onOpenPostRental={handlePostRentalClick}
          onOpenServicePass={() => setServicePassModalOpen(true)}
          onAccountDeleted={() => {
            setAccessToken(null);
            setUser(null);
            setView('explore');
          }}
        />
      )}

      {view === 'admin' && isAdmin && user && (
        <AdminDashboard
          user={user}
          categories={categories}
          locations={locations}
          onRefreshPublicData={() => {
            loadPublicBootstrap();
            fetchListings(1);
          }}
        />
      )}

      {/* Footer */}
      <footer className="mt-12 border-t border-slate-200 bg-white py-8 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-col sm:flex-row items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <strong className="text-[#123B65] dark:text-white">AZ RENTAL</strong>
            <span>·</span>
            <span>Find Your Place. Connect Directly.</span>
          </div>
          <div>በውል የከራዩ · ሳይዋዋሉ ገንዘብ አይክፈሉ · ከአጭበርባሪዎች ይጠንቀቁ</div>
        </div>
      </footer>

      {/* Mobile Bottom Thumb-Zone Navigation (<= 15% mobile height) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 grid h-16 grid-cols-5 border-t border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 md:hidden">
        <button type="button" onClick={() => setView('explore')} className={`flex flex-col items-center justify-center min-h-[44px] ${view === 'explore' ? 'text-[#123B65] dark:text-[#F5A623]' : 'text-slate-500'}`}>
          <Home className="h-5 w-5" />
          <span className="mt-0.5 text-[10px] font-semibold">Explore</span>
        </button>
        <button type="button" onClick={() => setView('map')} className={`flex flex-col items-center justify-center min-h-[44px] ${view === 'map' ? 'text-[#123B65] dark:text-[#F5A623]' : 'text-slate-500'}`}>
          <MapPin className="h-5 w-5" />
          <span className="mt-0.5 text-[10px] font-semibold">Map</span>
        </button>
        <button type="button" onClick={handlePostRentalClick} className="flex flex-col items-center justify-center min-h-[44px] text-[#F5A623]">
          <Plus className="h-6 w-6" />
          <span className="mt-0.5 text-[10px] font-bold">Post</span>
        </button>
        <button type="button" onClick={() => (user ? setView('messages') : (setAuthModalMode('login'), setAuthModalOpen(true)))} className={`flex flex-col items-center justify-center min-h-[44px] ${view === 'messages' ? 'text-[#123B65] dark:text-[#F5A623]' : 'text-slate-500'}`}>
          <MessageSquare className="h-5 w-5" />
          <span className="mt-0.5 text-[10px] font-semibold">Chat</span>
        </button>
        <button type="button" onClick={() => (user ? setView(isAdmin ? 'admin' : 'dashboard') : (setAuthModalMode('login'), setAuthModalOpen(true)))} className={`flex flex-col items-center justify-center min-h-[44px] ${view === 'dashboard' || view === 'admin' ? 'text-[#123B65] dark:text-[#F5A623]' : 'text-slate-500'}`}>
          {isAdmin ? <Shield className="h-5 w-5" /> : user ? <LayoutDashboard className="h-5 w-5" /> : <UserIcon className="h-5 w-5" />}
          <span className="mt-0.5 text-[10px] font-semibold">{user ? 'Account' : 'Login'}</span>
        </button>
      </nav>

      {/* Notification Permission Popup */}
      {showNotifPermissionPopup && (
        <div className="fixed bottom-20 right-4 z-50 w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900 md:bottom-6">
          <h4 className="text-sm font-bold text-[#123B65] dark:text-white">{t('allowNotificationsTitle')}</h4>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{t('allowNotificationsBody')}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={async () => {
                setShowNotifPermissionPopup(false);
                localStorage.setItem('az_notif_prompt_handled', '1');
                if (typeof Notification !== 'undefined') {
                  await Notification.requestPermission();
                }
              }}
              className="flex-1 rounded-xl bg-[#123B65] py-2 text-xs font-bold text-white"
            >
              {t('allowNotificationsBtn')}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNotifPermissionPopup(false);
                localStorage.setItem('az_notif_prompt_handled', '1');
              }}
              className="flex-1 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
            >
              {t('blockNotificationsBtn')}
            </button>
          </div>
        </div>
      )}

      <OfflineIndicator />

      {/* Modals */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode={authModalMode}
        lang={lang}
        locations={locations}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={(u) => setUser(u)}
      />

      {user && (
        <ServicePassModal
          isOpen={servicePassModalOpen}
          user={user}
          lang={lang}
          onClose={() => setServicePassModalOpen(false)}
          onUserUpdated={(updated) => setUser(updated)}
        />
      )}

      <PostRentalModal
        isOpen={postModalOpen}
        categories={categories}
        locations={locations}
        onClose={() => setPostModalOpen(false)}
        onCreated={() => {
          fetchListings(1);
          setView('dashboard');
        }}
        onRequireServicePass={() => setServicePassModalOpen(true)}
      />

      <ListingDetailModal
        listingId={selectedListingId}
        user={user}
        lang={lang}
        userCoords={userCoords}
        onClose={() => setSelectedListingId(null)}
        onRequireAuth={() => {
          setSelectedListingId(null);
          setAuthModalMode('login');
          setAuthModalOpen(true);
        }}
        onRequireServicePass={() => setServicePassModalOpen(true)}
        onStartChat={handleStartChatForListing}
        onStartCall={handleGuardedStartCall}
        onFavoriteChanged={(lid, isFav) =>
          setListings((prev) => prev.map((x) => (x.id === lid ? { ...x, isFavorite: isFav } : x)))
        }
      />

      <WebRTCCallOverlay
        call={realtime.activeCall}
        localStream={realtime.localStream}
        remoteStream={realtime.remoteStream}
        onAccept={realtime.acceptCall}
        onReject={realtime.rejectCall}
        onEnd={realtime.endCall}
        onToggleMic={realtime.toggleMic}
        onToggleCamera={realtime.toggleCamera}
        onSwitchCamera={realtime.switchCamera}
        onToggleSpeaker={realtime.toggleSpeaker}
      />
    </div>
  );
}

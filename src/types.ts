export type LanguageCode = 'en' | 'am' | 'om' | 'ti' | 'so';

export interface ServiceFeeConfig {
  amountEtb: number;
  durationDays: number;
}

export interface User {
  id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: string;
  active_role: string;
  country: string;
  city: string;
  address: string;
  account_type: 'individual' | 'business';
  avatar_url: string;
  email_verified: number;
  phone_verified: number;
  identity_verified: number;
  business_verified: number;
  verification_status: string;
  language: LanguageCode;
  theme: 'light' | 'dark';
  is_blocked: number;
  roles: string[];
  subscription_status: 'active' | 'pending_payment' | 'expired' | 'exempt';
  subscription_expires_at: string | null;
  subscription_active: boolean;
  subscription_days_remaining: number;
  has_prior_subscription: boolean;
}

export interface Subcategory {
  id: number;
  category_id: number;
  group_name: string;
  slug: string;
  name_en: string;
  name_am: string;
  name_om: string;
  name_ti: string;
  name_so: string;
}

export interface Category {
  id: number;
  slug: string;
  name_en: string;
  name_am: string;
  name_om: string;
  name_ti: string;
  name_so: string;
  icon: string;
  subcategories: Subcategory[];
}

export interface LocationItem {
  id: number;
  region: string;
  zone: string;
  city: string;
  woreda: string;
  sub_city: string;
  neighborhood: string;
  latitude: number;
  longitude: number;
  is_regional_capital: number;
}

export interface ListingImage {
  id: number;
  url: string;
  sort_order: number;
  is_watermarked: number;
  width: number;
  height: number;
}

export interface ListingVideo {
  id: number;
  url: string;
  mime_type: string;
  size_bytes: number;
  is_watermarked: number;
  watermark_note: string;
}

export interface Listing {
  id: number;
  owner_id: number;
  category_id: number;
  subcategory_id: number | null;
  category_slug: string;
  category_name_en: string;
  category_name_am: string;
  subcategory_name_en?: string;
  subcategory_name_am?: string;
  title: string;
  title_am: string;
  description: string;
  description_am: string;
  price_hourly: number | null;
  price_daily: number | null;
  price_weekly: number | null;
  price_monthly: number | null;
  effective_price?: number;
  currency: string;
  primary_duration: string;
  region: string;
  city: string;
  sub_city: string;
  neighborhood: string;
  address_detail: string;
  latitude: number;
  longitude: number;
  availability_status: string;
  rental_conditions: string;
  contact_preference: string;
  specs: Record<string, any>;
  status: string;
  is_verified: number;
  views_count: number;
  created_at: string;
  images: ListingImage[];
  video: ListingVideo | null;
  isFavorite?: boolean;
  distanceKm?: number | null;
  owner?: {
    id: number;
    full_name: string;
    city: string;
    account_type: string;
    email_verified: number;
    phone_verified: number;
    identity_verified: number;
    business_verified: number;
    verification_status: string;
    business_name?: string;
    rating_avg?: number;
    review_count?: number;
  };
}

export interface Banner {
  id: number;
  title_am: string;
  title_en: string;
  subtitle_am: string;
  subtitle_en: string;
  severity: 'info' | 'warning' | 'danger';
  image_url: string;
  sort_order: number;
  is_active: number;
}

export interface Booking {
  id: number;
  listing_id: number;
  listing_title: string;
  listing_city: string;
  renter_id: number;
  renter_name?: string;
  renter_phone?: string;
  owner_id: number;
  owner_name?: string;
  owner_phone?: string;
  request_type: 'rental' | 'viewing';
  start_date: string;
  end_date: string;
  duration_type: string;
  units: number;
  base_amount: number;
  service_fee: number;
  total_amount: number;
  status: string;
  rental_conditions: string;
  viewing_requested_at: string;
  agreement_signed_by_renter: number;
  agreement_signed_by_owner: number;
  created_at: string;
}

export interface Conversation {
  id: number;
  listing_id: number | null;
  listing_title?: string;
  listing_city?: string;
  renter_id: number;
  owner_id: number;
  peerId: number;
  peerName: string;
  peerOnline: boolean;
  last_message?: string;
  last_message_type?: string;
  unread_count: number;
  last_message_at: string;
}

export interface ChatMessage {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_name: string;
  message_type: 'text' | 'image' | 'video' | 'file' | 'voice';
  content: string;
  media_url: string;
  file_name: string;
  reply_to_id: number | null;
  is_edited: number;
  is_deleted: number;
  read_at: string | null;
  created_at: string;
}

export interface NotificationItem {
  id: number;
  user_id: number;
  type: string;
  title: string;
  body: string;
  title_am: string;
  body_am: string;
  link: string;
  is_read: number;
  created_at: string;
}

export interface PaymentProvider {
  id: 'telebirr' | 'chapa' | 'cbe_birr';
  name: string;
  nameAm: string;
  configured: boolean;
  requiredEnvVars: string[];
  description: string;
}

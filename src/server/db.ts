import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.AZ_DB_PATH
  ? path.resolve(process.env.AZ_DB_PATH)
  : path.join(DATA_DIR, 'azrental.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map((r: any) => r.name)
  );

  const migrations: Array<{ name: string; sql: string }> = [
    {
      name: '001_initial_schema',
      sql: `
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL,
          email TEXT UNIQUE,
          phone TEXT UNIQUE,
          password_hash TEXT,
          role TEXT NOT NULL DEFAULT 'renter',
          active_role TEXT NOT NULL DEFAULT 'renter',
          country TEXT NOT NULL DEFAULT 'Ethiopia',
          city TEXT NOT NULL DEFAULT 'Addis Ababa',
          address TEXT DEFAULT '',
          account_type TEXT NOT NULL DEFAULT 'individual',
          avatar_url TEXT DEFAULT '',
          email_verified INTEGER NOT NULL DEFAULT 0,
          phone_verified INTEGER NOT NULL DEFAULT 0,
          identity_verified INTEGER NOT NULL DEFAULT 0,
          business_verified INTEGER NOT NULL DEFAULT 0,
          verification_status TEXT NOT NULL DEFAULT 'unverified',
          language TEXT NOT NULL DEFAULT 'en',
          theme TEXT NOT NULL DEFAULT 'light',
          is_blocked INTEGER NOT NULL DEFAULT 0,
          terms_accepted INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS user_roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'approved',
          granted_by INTEGER REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, role_name)
        );

        CREATE TABLE IF NOT EXISTS renter_profiles (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          preferred_city TEXT DEFAULT 'Addis Ababa',
          id_document_url TEXT DEFAULT '',
          bio TEXT DEFAULT '',
          notification_prefs_json TEXT NOT NULL DEFAULT '{"inApp":true,"browserPush":false,"sound":true,"volume":0.7}'
        );

        CREATE TABLE IF NOT EXISTS landlord_profiles (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          business_name TEXT DEFAULT '',
          business_license_no TEXT DEFAULT '',
          tin_number TEXT DEFAULT '',
          verification_doc_url TEXT DEFAULT '',
          verification_notes TEXT DEFAULT '',
          payout_account TEXT DEFAULT '',
          rating_avg REAL NOT NULL DEFAULT 0,
          review_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS otp_verifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          target TEXT NOT NULL,
          channel TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          purpose TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 5,
          expires_at TEXT NOT NULL,
          resend_available_at TEXT NOT NULL,
          verified_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS locations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          region TEXT NOT NULL,
          zone TEXT DEFAULT '',
          city TEXT NOT NULL,
          woreda TEXT DEFAULT '',
          sub_city TEXT DEFAULT '',
          neighborhood TEXT DEFAULT '',
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          is_regional_capital INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          name_en TEXT NOT NULL,
          name_am TEXT NOT NULL,
          name_om TEXT DEFAULT '',
          name_ti TEXT DEFAULT '',
          name_so TEXT DEFAULT '',
          icon TEXT NOT NULL DEFAULT 'Home',
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS subcategories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
          group_name TEXT DEFAULT '',
          slug TEXT NOT NULL,
          name_en TEXT NOT NULL,
          name_am TEXT NOT NULL,
          name_om TEXT DEFAULT '',
          name_ti TEXT DEFAULT '',
          name_so TEXT DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          UNIQUE(category_id, slug)
        );

        CREATE TABLE IF NOT EXISTS listings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          category_id INTEGER NOT NULL REFERENCES categories(id),
          subcategory_id INTEGER REFERENCES subcategories(id),
          title TEXT NOT NULL,
          title_am TEXT DEFAULT '',
          description TEXT NOT NULL,
          description_am TEXT DEFAULT '',
          price_hourly REAL,
          price_daily REAL,
          price_weekly REAL,
          price_monthly REAL,
          currency TEXT NOT NULL DEFAULT 'ETB',
          primary_duration TEXT NOT NULL DEFAULT 'monthly',
          location_id INTEGER REFERENCES locations(id),
          region TEXT DEFAULT 'Addis Ababa',
          city TEXT NOT NULL,
          sub_city TEXT DEFAULT '',
          neighborhood TEXT DEFAULT '',
          address_detail TEXT DEFAULT '',
          latitude REAL NOT NULL DEFAULT 9.0054,
          longitude REAL NOT NULL DEFAULT 38.7636,
          exact_location_visible INTEGER NOT NULL DEFAULT 1,
          availability_status TEXT NOT NULL DEFAULT 'available',
          available_from TEXT DEFAULT '',
          available_to TEXT DEFAULT '',
          rental_conditions TEXT DEFAULT '',
          contact_preference TEXT NOT NULL DEFAULT 'chat_call',
          specs_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending',
          is_verified INTEGER NOT NULL DEFAULT 0,
          views_count INTEGER NOT NULL DEFAULT 0,
          duplicate_hash TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS listing_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
          original_path TEXT NOT NULL,
          watermarked_path TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_watermarked INTEGER NOT NULL DEFAULT 0,
          width INTEGER DEFAULT 0,
          height INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS listing_videos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          listing_id INTEGER NOT NULL UNIQUE REFERENCES listings(id) ON DELETE CASCADE,
          original_path TEXT NOT NULL,
          watermarked_path TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          is_watermarked INTEGER NOT NULL DEFAULT 0,
          watermark_note TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS listing_availability (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
          booking_id INTEGER,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'booked'
        );

        CREATE TABLE IF NOT EXISTS favorites (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, listing_id)
        );

        CREATE TABLE IF NOT EXISTS saved_searches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          filters_json TEXT NOT NULL,
          alert_enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS recently_viewed (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
          viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, listing_id)
        );

        CREATE TABLE IF NOT EXISTS conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
          renter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(listing_id, renter_id, owner_id)
        );

        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          message_type TEXT NOT NULL DEFAULT 'text',
          content TEXT DEFAULT '',
          media_url TEXT DEFAULT '',
          file_name TEXT DEFAULT '',
          reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
          is_edited INTEGER NOT NULL DEFAULT 0,
          is_deleted INTEGER NOT NULL DEFAULT 0,
          read_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS user_blocks (
          blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reason TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (blocker_id, blocked_id)
        );

        CREATE TABLE IF NOT EXISTS calls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
          caller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          callee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          call_type TEXT NOT NULL DEFAULT 'audio',
          status TEXT NOT NULL DEFAULT 'ringing',
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          answered_at TEXT,
          ended_at TEXT,
          duration_seconds INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          title_am TEXT DEFAULT '',
          body_am TEXT DEFAULT '',
          link TEXT DEFAULT '',
          is_read INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS bookings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
          renter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          request_type TEXT NOT NULL DEFAULT 'rental',
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          duration_type TEXT NOT NULL DEFAULT 'daily',
          units INTEGER NOT NULL DEFAULT 1,
          base_amount REAL NOT NULL DEFAULT 0,
          service_fee REAL NOT NULL DEFAULT 0,
          deposit_amount REAL NOT NULL DEFAULT 0,
          total_amount REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'Pending',
          rental_conditions TEXT DEFAULT '',
          viewing_requested_at TEXT DEFAULT '',
          agreement_signed_by_renter INTEGER NOT NULL DEFAULT 0,
          agreement_signed_by_owner INTEGER NOT NULL DEFAULT 0,
          cancellation_reason TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS rental_agreements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
          agreement_number TEXT NOT NULL UNIQUE,
          terms_en TEXT NOT NULL,
          terms_am TEXT NOT NULL,
          renter_signature TEXT DEFAULT '',
          owner_signature TEXT DEFAULT '',
          signed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'ETB',
          purpose TEXT NOT NULL DEFAULT 'booking_payment',
          tx_ref TEXT NOT NULL UNIQUE,
          provider_ref TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          failure_reason TEXT DEFAULT '',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          verified_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'ETB',
          reference TEXT NOT NULL,
          status TEXT NOT NULL,
          notes TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
          booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
          reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
          comment TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          target_type TEXT NOT NULL,
          target_id INTEGER NOT NULL,
          reason TEXT NOT NULL,
          details TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          resolved_by INTEGER REFERENCES users(id),
          resolution_notes TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS verification_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          request_type TEXT NOT NULL,
          document_url TEXT DEFAULT '',
          business_name TEXT DEFAULT '',
          license_number TEXT DEFAULT '',
          notes TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          reviewed_by INTEGER REFERENCES users(id),
          reviewed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS banners (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title_am TEXT NOT NULL,
          title_en TEXT NOT NULL,
          subtitle_am TEXT NOT NULL,
          subtitle_en TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'warning',
          image_url TEXT DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          updated_by INTEGER REFERENCES users(id),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          plan_name TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'ETB',
          status TEXT NOT NULL DEFAULT 'active',
          starts_at TEXT NOT NULL DEFAULT (datetime('now')),
          ends_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          actor_role TEXT DEFAULT '',
          action TEXT NOT NULL,
          target_type TEXT DEFAULT '',
          target_id INTEGER,
          details_json TEXT NOT NULL DEFAULT '{}',
          ip_address TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_by INTEGER REFERENCES users(id),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS translations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lang_code TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_by INTEGER REFERENCES users(id),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(lang_code, key)
        );

        CREATE INDEX IF NOT EXISTS idx_listings_cat_city_status ON listings(category_id, city, status);
        CREATE INDEX IF NOT EXISTS idx_listings_coords ON listings(latitude, longitude);
        CREATE INDEX IF NOT EXISTS idx_bookings_listing_dates ON bookings(listing_id, start_date, end_date, status);
        CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at);
      `,
    },
    {
      name: '002_monthly_service_pass',
      sql: `
        ALTER TABLE users ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'pending_payment';
        ALTER TABLE users ADD COLUMN subscription_expires_at TEXT;
        ALTER TABLE subscriptions ADD COLUMN payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL;
        ALTER TABLE subscriptions ADD COLUMN kind TEXT NOT NULL DEFAULT 'initial';
        UPDATE users SET subscription_status = 'exempt' WHERE role IN ('super_admin', 'admin', 'support', 'finance', 'moderator');
      `,
    },
  ];

  const insertMigration = db.prepare('INSERT INTO migrations (name) VALUES (?)');
  for (const m of migrations) {
    if (!applied.has(m.name)) {
      db.transaction(() => {
        db.exec(m.sql);
        insertMigration.run(m.name);
      })();
    }
  }
}

export function seedReferenceData(): void {
  const catCount = (db.prepare('SELECT COUNT(*) as c FROM categories').get() as any).c;
  if (catCount === 0) {
    const insertCat = db.prepare(`
      INSERT INTO categories (slug, name_en, name_am, name_om, name_ti, name_so, icon, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const insertSub = db.prepare(`
      INSERT INTO subcategories (category_id, group_name, slug, name_en, name_am, name_om, name_ti, name_so, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    const categoriesData = [
      {
        slug: 'house',
        name_en: 'House Rental',
        name_am: 'የቤት ኪራይ',
        name_om: 'Kireessaa Manaa',
        name_ti: 'ክራይ ገዛ',
        name_so: 'Kireynta Guryaha',
        icon: 'Home',
        subs: [
          ['Residential Properties', 'residential-houses', 'Residential Houses', 'መኖሪያ ቤቶች'],
          ['Residential Properties', 'condominiums', 'Condominiums', 'ኮንዶሚኒየም'],
          ['Residential Properties', 'apartments', 'Apartments', 'አፓርታማዎች'],
          ['Residential Properties', 'pensions-guesthouses', 'Pensions & Guesthouses', 'ፔንሲዮን እና የእንግዳ ማረፊያ'],
          ['Residential Properties', 'warehouses', 'Residential Warehouses', 'መጋዘኖች'],
          ['Commercial Properties', 'commercial-buildings', 'Commercial Buildings', 'የንግድ ሕንፃዎች'],
          ['Commercial Properties', 'shops', 'Shops', 'ሱቆች'],
          ['Commercial Properties', 'stores', 'Stores', 'ስቶሮች'],
          ['Commercial Properties', 'offices', 'Offices', 'ቢሮዎች'],
          ['Commercial Properties', 'business-premises', 'Business Premises', 'የንግድ ቦታዎች'],
          ['Commercial Properties', 'commercial-warehouses', 'Commercial Warehouses', 'የንግድ መጋዘኖች'],
          ['Event and Accommodation Rentals', 'event-venues', 'Event Venues', 'የዝግጅት አዳራሾች'],
          ['Event and Accommodation Rentals', 'party-halls', 'Party Halls', 'የድግስ አዳራሾች'],
          ['Event and Accommodation Rentals', 'event-houses', 'Event Houses', 'የዝግጅት ቤቶች'],
          ['Event and Accommodation Rentals', 'tents', 'Event Tents', 'ድንኳኖች'],
          ['Event and Accommodation Rentals', 'event-furniture', 'Event Furniture & Equipment', 'የዝግጅት ዕቃዎች'],
        ],
      },
      {
        slug: 'car',
        name_en: 'Car Rental',
        name_am: 'የመኪና ኪራይ',
        name_om: 'Kireessaa Konkolaataa',
        name_ti: 'ክራይ መኪና',
        name_so: 'Kireynta Baabuurta',
        icon: 'Car',
        subs: [
          ['Vehicles', 'personal-cars', 'Personal Cars', 'የግል መኪናዎች'],
          ['Vehicles', 'business-vehicles', 'Business Vehicles', 'የንግድ መኪናዎች'],
          ['Vehicles', 'pickup-vehicles', 'Pickup Vehicles', 'ፒክአፕ መኪናዎች'],
          ['Vehicles', 'trucks', 'Trucks', 'ከባድ መኪናዎች'],
          ['Vehicles', 'cargo-vehicles', 'Cargo Vehicles', 'የጭነት መኪናዎች'],
          ['Vehicles', 'luxury-vehicles', 'Luxury Vehicles', 'የቅንጦት መኪናዎች'],
          ['Vehicles', 'suvs', 'SUVs & 4x4', 'ኤስዩቪ እና 4x4'],
          ['Vehicles', 'minibuses', 'Minibuses', 'ሚኒባሶች'],
          ['Vehicles', 'buses', 'Buses', 'አውቶቡሶች'],
        ],
      },
      {
        slug: 'construction',
        name_en: 'Construction Equipment',
        name_am: 'የግንባታ መሣሪያዎች',
        name_om: 'Meeshaalee Ijaarsaa',
        name_ti: 'ናውቲ ህንጻ',
        name_so: 'Qalabka Dhismaha',
        icon: 'Hammer',
        subs: [
          ['Construction', 'construction-tools', 'Construction Tools', 'የግንባታ መሣሪያዎች'],
          ['Construction', 'scaffolding', 'Scaffolding', 'ስካፎልዲንግ'],
          ['Construction', 'concrete-mixers', 'Concrete Mixers', 'የኮንክሪት ማደባለቂያ'],
          ['Construction', 'generators', 'Generators', 'ጄኔሬተሮች'],
          ['Construction', 'drilling-equipment', 'Drilling Equipment', 'የመቆፈሪያ መሣሪያ'],
          ['Construction', 'welding-equipment', 'Welding Equipment', 'የብየዳ መሣሪያ'],
          ['Construction', 'construction-materials', 'Construction Materials & Gear', 'የግንባታ ዕቃዎች'],
          ['Construction', 'other-construction-tools', 'Other Construction Tools', 'ሌሎች የግንባታ መሣሪያዎች'],
        ],
      },
      {
        slug: 'machinery',
        name_en: 'Heavy Machinery',
        name_am: 'ከባድ ማሽነሪዎች',
        name_om: 'Maashinariiwwan Gurguddoo',
        name_ti: 'ከበድቲ ማሽነሪታት',
        name_so: 'Mashiinnada Culus',
        icon: 'Truck',
        subs: [
          ['Machinery', 'excavators', 'Excavators', 'ኤክስካቫተሮች'],
          ['Machinery', 'bulldozers', 'Bulldozers', 'ቡልዶዘሮች'],
          ['Machinery', 'loaders', 'Loaders', 'ሎደሮች'],
          ['Machinery', 'cranes', 'Cranes', 'ክሬኖች'],
          ['Machinery', 'graders', 'Graders', 'ግሬደሮች'],
          ['Machinery', 'rollers', 'Rollers', 'ሮለሮች'],
          ['Machinery', 'forklifts', 'Forklifts', 'ፎርክሊፍቶች'],
          ['Machinery', 'dump-trucks', 'Dump Trucks', 'ዳምፕ ትራኮች'],
          ['Machinery', 'heavy-construction-machinery', 'Heavy Construction Machinery', 'ከባድ የግንባታ ማሽኖች'],
        ],
      },
      {
        slug: 'event',
        name_en: 'Event Equipment',
        name_am: 'የዝግጅት ዕቃዎች',
        name_om: 'Meeshaalee Sagantaa',
        name_ti: 'ኣቑሑት ጽንብል',
        name_so: 'Qalabka Munaasabadaha',
        icon: 'PartyPopper',
        subs: [
          ['Events', 'tables', 'Tables', 'ጠረጴዛዎች'],
          ['Events', 'chairs', 'Chairs', 'ወንበሮች'],
          ['Events', 'event-tents', 'Tents', 'ድንኳኖች'],
          ['Events', 'sound-systems', 'Sound Systems', 'የድምፅ መሣሪያዎች'],
          ['Events', 'speakers', 'Speakers', 'ስፒከሮች'],
          ['Events', 'lighting-equipment', 'Lighting Equipment', 'የመብራት መሣሪያዎች'],
          ['Events', 'stages', 'Stages', 'መድረኮች'],
          ['Events', 'decorations', 'Decorations', 'ዲኮር እና ማስዋቢያ'],
          ['Events', 'wedding-equipment', 'Wedding Equipment', 'የሰርግ ዕቃዎች'],
          ['Events', 'party-equipment', 'Party Equipment', 'የድግስ ዕቃዎች'],
          ['Events', 'catering-equipment', 'Catering Equipment', 'የምግብ አቅርቦት ዕቃዎች'],
        ],
      },
      {
        slug: 'other',
        name_en: 'Other Rentals',
        name_am: 'ሌሎች ኪራዮች',
        name_om: 'Kireessaa Biroo',
        name_ti: 'ካልኦት ክራያት',
        name_so: 'Kireynta Kale',
        icon: 'Package',
        subs: [
          ['General', 'furniture-appliances', 'Home Furniture & Appliances', 'የቤት ዕቃዎች'],
          ['General', 'cameras-electronics', 'Cameras & Electronics', 'ካሜራ እና ኤሌክትሮኒክስ'],
          ['General', 'agricultural-tools', 'Agricultural Equipment', 'የግብርና መሣሪያዎች'],
          ['General', 'general-services', 'Other Rental Services', 'ሌሎች የኪራይ አገልግሎቶች'],
        ],
      },
    ];

    db.transaction(() => {
      categoriesData.forEach((cat, idx) => {
        const res = insertCat.run(
          cat.slug,
          cat.name_en,
          cat.name_am,
          cat.name_om,
          cat.name_ti,
          cat.name_so,
          cat.icon,
          idx + 1
        );
        const catId = Number(res.lastInsertRowid);
        cat.subs.forEach(([groupName, slug, en, am], sIdx) => {
          insertSub.run(catId, groupName, slug, en, am, en, en, en, sIdx + 1);
        });
      });
    })();
  }

  const locCount = (db.prepare('SELECT COUNT(*) as c FROM locations').get() as any).c;
  if (locCount === 0) {
    const insertLoc = db.prepare(`
      INSERT INTO locations (region, zone, city, woreda, sub_city, neighborhood, latitude, longitude, is_regional_capital, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const locations: Array<[string, string, string, string, string, string, number, number, number]> = [
      ['Addis Ababa', 'Addis Ababa', 'Addis Ababa', 'Woreda 03', 'Bole', 'Bole Medhanialem', 8.9974, 38.7892, 1],
      ['Addis Ababa', 'Addis Ababa', 'Addis Ababa', 'Woreda 02', 'Bole', 'Bole Bulbula', 8.9482, 38.7745, 0],
      ['Addis Ababa', 'Addis Ababa', 'Addis Ababa', 'Woreda 01', 'Yeka', 'CMC / Ayat', 9.0285, 38.8594, 0],
      ['Addis Ababa', 'Addis Ababa', 'Addis Ababa', 'Woreda 05', 'Kirkos', 'Kazanchis', 9.0176, 38.7689, 0],
      ['Addis Ababa', 'Addis Ababa', 'Addis Ababa', 'Woreda 04', 'Lideta', 'Mexico Square', 9.0103, 38.7446, 0],
      ['Addis Ababa', 'Addis Ababa', 'Addis Ababa', 'Woreda 08', 'Arada', 'Piassa', 9.0358, 38.7524, 0],
      ['Addis Ababa', 'Addis Ababa', 'Addis Ababa', 'Woreda 06', 'Nifas Silk-Lafto', 'Sarbet / Bisrate Gabriel', 8.9912, 38.7376, 0],
      ['Addis Ababa', 'Addis Ababa', 'Addis Ababa', 'Woreda 07', 'Kolfe Keranio', 'Tor Hailoch', 9.0085, 38.7165, 0],
      ['Addis Ababa', 'Addis Ababa', 'Addis Ababa', 'Woreda 09', 'Gulele', 'Shiro Meda', 9.0623, 38.7618, 0],
      ['Addis Ababa', 'Addis Ababa', 'Addis Ababa', 'Woreda 01', 'Akaki Kality', 'Kality Industrial', 8.8955, 38.7891, 0],
      ['Addis Ababa', 'Addis Ababa', 'Addis Ababa', 'Woreda 02', 'Addis Ketema', 'Merkato', 9.0315, 38.7385, 0],
      ['Addis Ababa', 'Addis Ababa', 'Addis Ababa', 'Woreda 04', 'Lemi Kura', 'Summit / Hayat', 9.0145, 38.8672, 0],
      ['Dire Dawa', 'Dire Dawa', 'Dire Dawa', 'Kebele 02', 'Kezira', 'Sabian / Kezira', 9.6009, 41.8501, 1],
      ['Oromia', 'East Shewa', 'Adama', 'Adama Town', 'Bole Sub-City', 'Franko / Melka Adama', 8.5400, 39.2700, 0],
      ['Oromia', 'East Shewa', 'Bishoftu', 'Bishoftu Town', 'Central', 'Kuriftu / Babogaya', 8.7522, 38.9785, 0],
      ['Oromia', 'West Arsi', 'Shashamane', 'Shashamane', 'Central', 'Abosto', 7.2000, 38.6000, 0],
      ['Oromia', 'Jimma', 'Jimma', 'Jimma Town', 'Hermata', 'Merkato / Kochi', 7.6734, 36.8344, 0],
      ['Sidama', 'Hawassa', 'Hawassa', 'Tabor', 'Haik Dar', 'Lake View / Piassa', 7.0504, 38.4955, 1],
      ['Amhara', 'West Gojjam', 'Bahir Dar', 'Tana', 'Belay Zeleke', 'Tana Lakeside', 11.5742, 37.3614, 1],
      ['Amhara', 'Central Gondar', 'Gondar', 'Arada', 'Maraki', 'Piassa / Azezo', 12.6030, 37.4521, 0],
      ['Amhara', 'South Wollo', 'Dessie', 'Buanbua Wuha', 'Central', 'Piassa / Segno Gebeya', 11.1333, 39.6333, 0],
      ['Amhara', 'North Shewa', 'Debre Birhan', 'Kebele 04', 'Central', 'Atse Zerayakob', 9.6800, 39.5300, 0],
      ['Tigray', 'Mekelle', 'Mekelle', 'Hawelti', 'Adi Haki', 'Romanat / Kedamay Weyane', 13.4967, 39.4753, 1],
      ['Somali', 'Fafan', 'Jigjiga', 'Kebele 05', 'Central', 'Taiwan / Garad Wilwal', 9.3500, 42.8000, 1],
      ['Harari', 'Harari', 'Harar', 'Amir Nur', 'Jugol', 'Feres Magala / Shewa Ber', 9.3139, 42.1182, 1],
      ['South Ethiopia', 'Gamo', 'Arbaminch', 'Sikela', 'Secha', 'Sikela / Nechsar View', 6.0333, 37.5500, 1],
      ['South Ethiopia', 'Wolaita', 'Wolaita Sodo', 'Arada', 'Central', 'Merkato / Tona', 6.8600, 37.7600, 0],
      ['Central Ethiopia', 'Hadiya', 'Hosaena', 'Gofer Meda', 'Central', 'Sech Duna', 7.5500, 37.8500, 1],
      ['Afar', 'Awsi Rasu', 'Semera', 'Semera Logia', 'Central', 'Semera University Area', 11.7924, 41.0086, 1],
      ['Benishangul-Gumuz', 'Assosa', 'Assosa', 'Kebele 02', 'Central', 'Assosa Central', 10.0667, 34.5333, 1],
      ['Gambela', 'Anuak', 'Gambela', 'Kebele 03', 'Central', 'Baro Riverside', 8.2500, 34.5833, 1],
      ['South West Ethiopia', 'Kaffa', 'Bonga', 'Bonga Town', 'Central', 'Bonga Center', 7.2667, 36.2333, 1],
    ];

    db.transaction(() => {
      for (const loc of locations) {
        insertLoc.run(...loc);
      }
    })();
  }

  const bannerCount = (db.prepare('SELECT COUNT(*) as c FROM banners').get() as any).c;
  if (bannerCount === 0) {
    const insertBanner = db.prepare(`
      INSERT INTO banners (title_am, title_en, subtitle_am, subtitle_en, severity, image_url, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
    insertBanner.run(
      'በውል የከራዩ',
      'Rent with a Written Agreement',
      'ሁልጊዜ ከመከራየትዎ በፊት ግልጽ የጽሑፍ የኪራይ ውል ይፈራረሙ።',
      'Always sign a clear written rental agreement before taking possession of any property, vehicle, or equipment.',
      'info',
      '/assets/aistudio/AZ_Rental_Marketplace_Banner_4caadd34.png',
      1
    );
    insertBanner.run(
      'ሳይዋዋሉ ገንዘብ አይክፈሉ',
      'Do Not Pay Before Signing an Agreement',
      'የኪራይ ውል ሳይፈርሙ እና ንብረቱን በአካል ሳያረጋግጡ ማንኛውንም ክፍያ አይፈጽሙ።',
      'Never transfer deposits or rental fees before inspecting the item in person and completing your signed contract.',
      'warning',
      '',
      2
    );
    insertBanner.run(
      'ከአጭበርባሪዎች ይጠንቀቁ',
      'Beware of Scammers',
      'የተረጋገጠ ባለንብረት ምልክት ያላቸውን ብቻ ይምረጡ፤ አጠራጣሪ ማስታወቂያዎችን ወዲያውኑ ሪፖርት ያድርጉ።',
      'Verify owner identity, use AZ RENTAL in-app chat and payment records, and report suspicious listings immediately.',
      'danger',
      '',
      3
    );
  }

  const settingsDefaults: Array<[string, any]> = [
    ['platform_fee_percent', 3.5],
    ['watermark_opacity', 0.42],
    ['watermark_position', 'southeast'],
    ['max_listing_images', 10],
    ['max_listing_videos', 1],
    ['supported_languages', ['am', 'en', 'om', 'ti', 'so']],
    ['landlord_subscription_etb', 499],
    ['monthly_service_fee_etb', 50],
    ['service_pass_duration_days', 30],
  ];
  const upsertSetting = db.prepare(`
    INSERT OR IGNORE INTO system_settings (key, value_json) VALUES (?, ?)
  `);
  for (const [k, v] of settingsDefaults) {
    upsertSetting.run(k, JSON.stringify(v));
  }
}

export function getServiceFeeConfig(): { amountEtb: number; durationDays: number } {
  const amtRow = db.prepare(`SELECT value_json FROM system_settings WHERE key = 'monthly_service_fee_etb'`).get() as any;
  const daysRow = db.prepare(`SELECT value_json FROM system_settings WHERE key = 'service_pass_duration_days'`).get() as any;
  let amountEtb = 50;
  let durationDays = 30;
  try {
    if (amtRow) amountEtb = Math.max(1, Number(JSON.parse(amtRow.value_json)) || 50);
  } catch {
    amountEtb = 50;
  }
  try {
    if (daysRow) durationDays = Math.max(1, Number(JSON.parse(daysRow.value_json)) || 30);
  } catch {
    durationDays = 30;
  }
  return { amountEtb, durationDays };
}

export function writeAuditLog(params: {
  actorId?: number | null;
  actorRole?: string;
  action: string;
  targetType?: string;
  targetId?: number | null;
  details?: Record<string, any>;
  ipAddress?: string;
}): void {
  db.prepare(`
    INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, details_json, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.actorId ?? null,
    params.actorRole ?? '',
    params.action,
    params.targetType ?? '',
    params.targetId ?? null,
    JSON.stringify(params.details ?? {}),
    params.ipAddress ?? ''
  );
}

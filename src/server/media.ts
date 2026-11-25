import crypto from 'crypto';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import sharp, { type Gravity, type OverlayOptions } from 'sharp';
import { promisify } from 'util';
import { db } from './db.ts';

const execFileAsync = promisify(execFile);

export const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');
export const ORIGINALS_IMAGES_DIR = path.join(STORAGE_ROOT, 'originals', 'images');
export const ORIGINALS_VIDEOS_DIR = path.join(STORAGE_ROOT, 'originals', 'videos');
export const PUBLIC_IMAGES_DIR = path.join(STORAGE_ROOT, 'public', 'images');
export const PUBLIC_VIDEOS_DIR = path.join(STORAGE_ROOT, 'public', 'videos');
export const CHAT_MEDIA_DIR = path.join(STORAGE_ROOT, 'public', 'chat');
export const DOCS_DIR = path.join(STORAGE_ROOT, 'private', 'docs');
const WATERMARK_PNG_PATH = path.join(STORAGE_ROOT, 'az-watermark-badge.png');

for (const dir of [
  ORIGINALS_IMAGES_DIR,
  ORIGINALS_VIDEOS_DIR,
  PUBLIC_IMAGES_DIR,
  PUBLIC_VIDEOS_DIR,
  CHAT_MEDIA_DIR,
  DOCS_DIR,
]) {
  fs.mkdirSync(dir, { recursive: true });
}

export function safeResolveInside(baseDir: string, fileName: string): string | null {
  const cleanName = path.basename(fileName);
  const resolved = path.resolve(baseDir, cleanName);
  if (!resolved.startsWith(baseDir + path.sep)) {
    return null;
  }
  return resolved;
}

export function getWatermarkSettings(): { opacity: number; position: string } {
  const opRow = db.prepare(`SELECT value_json FROM system_settings WHERE key = 'watermark_opacity'`).get() as any;
  const posRow = db.prepare(`SELECT value_json FROM system_settings WHERE key = 'watermark_position'`).get() as any;
  let opacity = 0.42;
  let position = 'southeast';
  try {
    if (opRow) opacity = Math.min(0.85, Math.max(0.15, Number(JSON.parse(opRow.value_json))));
    if (posRow) position = String(JSON.parse(posRow.value_json));
  } catch {
    // keep defaults
  }
  return { opacity, position };
}

async function ensureWatermarkPng(): Promise<string> {
  if (fs.existsSync(WATERMARK_PNG_PATH)) return WATERMARK_PNG_PATH;

  const iconPath = path.resolve(process.cwd(), 'public', 'assets', 'aistudio', 'Glossy_AZ_Rental_App_Icon_2ee6fab8.png');
  const badgeSvg = Buffer.from(`
    <svg width="320" height="72" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="320" height="72" rx="14" fill="#123B65" fill-opacity="0.88"/>
      <rect x="2" y="2" width="316" height="68" rx="12" fill="none" stroke="#F5A623" stroke-width="2.5" stroke-opacity="0.95"/>
      <text x="82" y="34" font-family="Arial, sans-serif" font-size="22" font-weight="800" fill="#FFFFFF" letter-spacing="1.5">AZ RENTAL</text>
      <text x="82" y="55" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#F5A623">Find Your Place · Ethiopia</text>
    </svg>
  `);

  const layers: OverlayOptions[] = [];
  if (fs.existsSync(iconPath)) {
    const iconBuf = await sharp(iconPath).resize(54, 54).png().toBuffer();
    layers.push({ input: iconBuf, left: 14, top: 9 });
  }

  await sharp(badgeSvg).composite(layers).png().toFile(WATERMARK_PNG_PATH);
  return WATERMARK_PNG_PATH;
}

export async function processAndWatermarkImage(
  inputBuffer: Buffer,
  originalExt = '.jpg'
): Promise<{
  originalPath: string;
  watermarkedPath: string;
  publicUrl: string;
  isWatermarked: boolean;
  width: number;
  height: number;
}> {
  const id = crypto.randomUUID();
  const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(originalExt.toLowerCase())
    ? originalExt.toLowerCase()
    : '.jpg';
  const originalFile = `${id}${safeExt}`;
  const originalFull = path.join(ORIGINALS_IMAGES_DIR, originalFile);
  fs.writeFileSync(originalFull, inputBuffer);

  const publicFile = `${id}.jpg`;
  const publicFull = path.join(PUBLIC_IMAGES_DIR, publicFile);
  const { opacity, position } = getWatermarkSettings();

  // Resize & materialize buffer first so exact post-resize width/height are known
  const { data: resizedBuf, info: resizedInfo } = await sharp(inputBuffer)
    .rotate()
    .resize({
      width: 1440,
      height: 1080,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const targetWidth = resizedInfo.width || 800;
  const targetHeight = resizedInfo.height || 600;

  let isWatermarked = false;
  try {
    const wmPng = await ensureWatermarkPng();
    const wmWidth = Math.max(120, Math.min(280, Math.round(targetWidth * 0.25)));
    const wmBuf = await sharp(wmPng)
      .resize({ width: wmWidth })
      .ensureAlpha()
      .composite([
        {
          input: Buffer.from([255, 255, 255, Math.round(opacity * 255)]),
          raw: { width: 1, height: 1, channels: 4 },
          tile: true,
          blend: 'dest-in',
        },
      ])
      .png()
      .toBuffer();

    const gravityMap: Record<string, Gravity> = {
      southeast: 'southeast',
      southwest: 'southwest',
      northeast: 'northeast',
      northwest: 'northwest',
      center: 'center',
    };
    const gravity = gravityMap[position] || 'southeast';

    // Add subtle diagonal center protection mark + corner brand watermark
    const diagonalSvg = Buffer.from(`
      <svg width="${targetWidth}" height="${targetHeight}" xmlns="http://www.w3.org/2000/svg">
        <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
          transform="rotate(-24 ${Math.round(targetWidth / 2)} ${Math.round(targetHeight / 2)})"
          font-family="Arial, sans-serif" font-size="${Math.max(20, Math.round(targetWidth * 0.042))}"
          font-weight="700" fill="#FFFFFF" fill-opacity="${(opacity * 0.35).toFixed(2)}"
          stroke="#123B65" stroke-opacity="${(opacity * 0.28).toFixed(2)}" stroke-width="1">
          AZ RENTAL · ETHIOPIA
        </text>
      </svg>
    `);

    const resultInfo = await sharp(resizedBuf)
      .composite([
        { input: diagonalSvg, gravity: 'center' },
        { input: wmBuf, gravity },
      ])
      .jpeg({ quality: 84, mozjpeg: true })
      .toFile(publicFull);

    isWatermarked = true;
    return {
      originalPath: `originals/images/${originalFile}`,
      watermarkedPath: `public/images/${publicFile}`,
      publicUrl: `/media/images/${publicFile}`,
      isWatermarked,
      width: resultInfo.width,
      height: resultInfo.height,
    };
  } catch (err) {
    console.error('Image watermarking failed:', err);
    const fallbackInfo = await sharp(resizedBuf).jpeg({ quality: 84 }).toFile(publicFull);
    return {
      originalPath: `originals/images/${originalFile}`,
      watermarkedPath: `public/images/${publicFile}`,
      publicUrl: `/media/images/${publicFile}`,
      isWatermarked: false,
      width: fallbackInfo.width,
      height: fallbackInfo.height,
    };
  }
}

export async function processAndWatermarkVideo(
  tempPath: string,
  originalExt: string,
  mimeType: string,
  sizeBytes: number
): Promise<{
  originalPath: string;
  watermarkedPath: string;
  publicUrl: string;
  isWatermarked: boolean;
  watermarkNote: string;
}> {
  const id = crypto.randomUUID();
  const safeExt = ['.mp4', '.webm', '.mov'].includes(originalExt.toLowerCase())
    ? originalExt.toLowerCase()
    : '.mp4';
  const originalFile = `${id}${safeExt}`;
  const originalFull = path.join(ORIGINALS_VIDEOS_DIR, originalFile);
  fs.renameSync(tempPath, originalFull);

  const publicFile = `${id}.mp4`;
  const publicFull = path.join(PUBLIC_VIDEOS_DIR, publicFile);

  try {
    const wmPng = await ensureWatermarkPng();
    const { opacity } = getWatermarkSettings();
    const alpha = opacity.toFixed(2);
    // Transcode to H.264 MP4 + burn AZ RENTAL watermark at bottom-right
    await execFileAsync(
      '/usr/bin/ffmpeg',
      [
        '-y',
        '-i',
        originalFull,
        '-i',
        wmPng,
        '-filter_complex',
        `[1:v]scale=200:-1,format=rgba,colorchannelmixer=aa=${alpha}[wm];[0:v][wm]overlay=W-w-16:H-h-16`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '26',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        publicFull,
      ],
      { timeout: 60_000 }
    );
    return {
      originalPath: `originals/videos/${originalFile}`,
      watermarkedPath: `public/videos/${publicFile}`,
      publicUrl: `/media/videos/${publicFile}`,
      isWatermarked: true,
      watermarkNote: 'Transcoded to MP4 with AZ RENTAL watermark',
    };
  } catch (err: any) {
    // Truthfully record that video watermarking did not succeed and serve original safely
    const fallbackFile = `${id}${safeExt}`;
    const fallbackFull = path.join(PUBLIC_VIDEOS_DIR, fallbackFile);
    fs.copyFileSync(originalFull, fallbackFull);
    return {
      originalPath: `originals/videos/${originalFile}`,
      watermarkedPath: `public/videos/${fallbackFile}`,
      publicUrl: `/media/videos/${fallbackFile}`,
      isWatermarked: false,
      watermarkNote: `Original video preserved (${err?.message ? 'transcode unavailable' : 'pending'})`,
    };
  }
}

export async function seedStarterListingsIfEmpty(): Promise<void> {
  const count = (db.prepare('SELECT COUNT(*) as c FROM listings').get() as any).c;
  if (count > 0) return;

  // Create verified Ethiopian showcase owners (cannot be logged into directly without password/OTP reset)
  const ownerInsert = db.prepare(`
    INSERT INTO users (full_name, email, phone, password_hash, role, active_role, country, city, address, account_type, email_verified, phone_verified, identity_verified, business_verified, verification_status, terms_accepted, subscription_status, subscription_expires_at)
    VALUES (?, ?, ?, NULL, 'landlord', 'landlord', 'Ethiopia', ?, ?, ?, 1, 1, 1, ?, 'verified', 1, 'active', datetime('now', '+30 days'))
  `);
  const insertLandlordProfile = db.prepare(`
    INSERT INTO landlord_profiles (user_id, business_name, rating_avg, review_count)
    VALUES (?, ?, ?, ?)
  `);
  const insertRole = db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role_name, status) VALUES (?, 'landlord', 'approved')`);
  const insertSeedSub = db.prepare(`
    INSERT INTO subscriptions (user_id, plan_name, amount, currency, status, starts_at, ends_at, kind)
    VALUES (?, 'Monthly Service Pass (30 days)', 50, 'ETB', 'active', datetime('now'), datetime('now', '+30 days'), 'initial')
  `);

  const owners = [
    { name: 'Dawit Bekele Properties', email: 'dawit.owner@azrental.et', phone: '+251911204501', city: 'Addis Ababa', addr: 'Bole Medhanialem', type: 'business', bizVerified: 1, bizName: 'Dawit Real Estate PLC', rating: 4.9, reviews: 24 },
    { name: 'Selamawit Fleet & Mobility', email: 'selam.fleet@azrental.et', phone: '+251911308812', city: 'Addis Ababa', addr: 'Kazanchis', type: 'business', bizVerified: 1, bizName: 'Selam Mobility PLC', rating: 4.8, reviews: 18 },
    { name: 'Abebe Heavy & Construction', email: 'abebe.machinery@azrental.et', phone: '+251912445590', city: 'Adama', addr: 'Bole Sub-City, Adama', type: 'business', bizVerified: 1, bizName: 'Abebe Construction Rental', rating: 4.9, reviews: 15 },
    { name: 'Tigist Events & Decor', email: 'tigist.events@azrental.et', phone: '+251913778820', city: 'Hawassa', addr: 'Haik Dar, Hawassa', type: 'business', bizVerified: 1, bizName: 'Tigist Wedding & Events', rating: 4.7, reviews: 31 },
  ];

  const ownerIds: number[] = [];
  for (const o of owners) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(o.email) as any;
    if (existing) {
      ownerIds.push(existing.id);
    } else {
      const res = ownerInsert.run(o.name, o.email, o.phone, o.city, o.addr, o.type, o.bizVerified);
      const uid = Number(res.lastInsertRowid);
      insertRole.run(uid);
      insertLandlordProfile.run(uid, o.bizName, o.rating, o.reviews);
      insertSeedSub.run(uid);
      ownerIds.push(uid);
    }
  }

  const getCatId = (slug: string) => (db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug) as any)?.id;
  const getSubId = (slug: string) => (db.prepare('SELECT id FROM subcategories WHERE slug = ?').get(slug) as any)?.id;

  const assetDir = path.resolve(process.cwd(), 'public', 'assets', 'aistudio');
  const starterItems = [
    {
      ownerId: ownerIds[0],
      catSlug: 'house',
      subSlug: 'apartments',
      title: 'Modern Furnished 3-Bedroom Apartment in Bole Medhanialem',
      title_am: 'በቦሌ መድኃኒዓለም ዘመናዊ ባለ 3 መኝታ አፓርታማ',
      description: 'Bright contemporary apartment with backup generator, underground parking, 24/7 security, high-speed fiber internet, and panoramic Bole views.',
      description_am: 'ባለ 3 መኝታ ዘመናዊ አፓርታማ፣ የመጠባበቂያ ጄኔሬተር፣ የመኪና ማቆሚያ እና 24/7 ጥበቃ ያለው።',
      price_daily: 4500,
      price_weekly: 28000,
      price_monthly: 85000,
      primary_duration: 'monthly',
      region: 'Addis Ababa',
      city: 'Addis Ababa',
      sub_city: 'Bole',
      neighborhood: 'Bole Medhanialem',
      lat: 8.9974,
      lng: 38.7892,
      conditions: 'Written rental agreement required. 1 month refundable security deposit.',
      specs: { bedrooms: 3, bathrooms: 2, areaSqm: 165, furnished: true, parking: true, backupGenerator: true },
      images: [
        'ZCSJpVQa7EbEE7btYGPJZcmJwLnPvpuS9If_S9NxDEasewQ_BLK0xpzGARmnzAFj3IMgA-Y1F6kOhQ2tjWnN5rNW339Z7RSwgRWjenKzYhdbLdk0NoxCUn_uBjkrXgx70-Iu6u1PqoMhSS62XSEoc9BwPr5-Vc301TAPAP5ATviHu153AZSOCAJ_rxxWjMWD_6e5f8305.jpeg',
        'cyNmbvHtY3mW1-Ma2K_SfDANOsQ0Zx7sE-IQ2WslR7EXnYWX-cTfX5r_a24xRkmAJA-B86o_L1fj7Q7Cb_0E1xqsRkQesx8U1DzabNUB5fgw9WtZJXGhVmBPod5KFnln2s0ggVjjU7vHnLMG44i7xtR9eidAD8w6M_GDO75DNo2Uy_CbAcVHOzFX0ykbu6Vr_521958e7.jpeg',
      ],
    },
    {
      ownerId: ownerIds[0],
      catSlug: 'house',
      subSlug: 'condominiums',
      title: 'Executive Studio & Living Suite — Kazanchis Business District',
      title_am: 'ካዛንቺስ ዘመናዊ የቤት ዕቃ የተሟላለት ስቱዲዮ',
      description: 'Ideal for diplomats, consultants, and long-term professionals. Walking distance to ECA and major hotels.',
      description_am: 'ለዲፕሎማቶች እና ለሥራ ባለሙያዎች የተመቸ ዘመናዊ መኖሪያ።',
      price_daily: 3200,
      price_weekly: 19500,
      price_monthly: 55000,
      primary_duration: 'monthly',
      region: 'Addis Ababa',
      city: 'Addis Ababa',
      sub_city: 'Kirkos',
      neighborhood: 'Kazanchis',
      lat: 9.0176,
      lng: 38.7689,
      conditions: 'Valid ID/Passport and signed AZ RENTAL contract required.',
      specs: { bedrooms: 1, bathrooms: 1, areaSqm: 78, furnished: true, elevator: true },
      images: [
        'cyNmbvHtY3mW1-Ma2K_SfDANOsQ0Zx7sE-IQ2WslR7EXnYWX-cTfX5r_a24xRkmAJA-B86o_L1fj7Q7Cb_0E1xqsRkQesx8U1DzabNUB5fgw9WtZJXGhVmBPod5KFnln2s0ggVjjU7vHnLMG44i7xtR9eidAD8w6M_GDO75DNo2Uy_CbAcVHOzFX0ykbu6Vr_521958e7.jpeg',
      ],
    },
    {
      ownerId: ownerIds[1],
      catSlug: 'car',
      subSlug: 'business-vehicles',
      title: '2025 Hybrid Executive Sedan — Chauffeur or Self-Drive',
      title_am: '2025 ሃይብሪድ ዘመናዊ ሴዳን መኪና — ከሹፌር ጋር ወይም ያለ ሹፌር',
      description: 'Fuel-efficient executive sedan in pristine condition for Addis Ababa city travel, airport transfers, or corporate delegations.',
      description_am: 'ንፁህ እና ቆጣቢ ዘመናዊ መኪና ለከተማ እና ለድርጅት ጉዞዎች።',
      price_daily: 5800,
      price_weekly: 36000,
      price_monthly: 125000,
      primary_duration: 'daily',
      region: 'Addis Ababa',
      city: 'Addis Ababa',
      sub_city: 'Kirkos',
      neighborhood: 'Kazanchis',
      lat: 9.0150,
      lng: 38.7650,
      conditions: 'Valid Ethiopian/International driver license required for self-drive. Fuel excluded.',
      specs: { brand: 'BYD / Toyota', model: 'Qin Plus Hybrid', year: 2025, vehicleType: 'Business Sedan', transmission: 'Automatic', fuelType: 'Hybrid', passengerCapacity: 5, driverAvailable: true },
      images: [
        'vrfbwzWdtxsbgVq1S6-XYL_qmhV-mithKYU6wmNc5uX5gwcZT_Ykf01cGxK2h2Ck_MtBUjE-4gkwtI_NcHbNnPhAS0xsiOE5kfGczMnO-G3hNI77TW0Np4G53V5va-Co1cMIIKnx74vBna8DXaOMEKrY-POLmjIkBcI8WBrSzIEhYEZq2Xe65-wbSAM-j0kz_abbf15f8.jpeg',
      ],
    },
    {
      ownerId: ownerIds[2],
      catSlug: 'construction',
      subSlug: 'drilling-equipment',
      title: 'Industrial Power Tools & Rotary Hammer Drilling Kit',
      title_am: 'የግንባታ ቁፋሮ እና መቁረጫ መሣሪያዎች ሙሉ ስብስብ',
      description: 'Complete contractor power-tool kit: heavy-duty rotary hammer drill, cordless driver, angle grinder, circular saw, and safety gear.',
      description_am: 'ለኮንትራክተሮች እና ግንባታ ባለሙያዎች የተሟላ የመቆፈሪያ እና መቁረጫ መሣሪያዎች።',
      price_daily: 1800,
      price_weekly: 10500,
      price_monthly: 34000,
      primary_duration: 'daily',
      region: 'Addis Ababa',
      city: 'Addis Ababa',
      sub_city: 'Akaki Kality',
      neighborhood: 'Kality Industrial',
      lat: 8.8955,
      lng: 38.7891,
      conditions: 'Equipment return inspection required. Safety deposit applies.',
      specs: { voltage: '220V / 20V Brushless', kitItems: 6, deliveryAvailable: true },
      images: [
        'nepp3TCIlyYaH-7NBi3zEP2TTwbfHUghnXa51lybUNgOPJEudtnMswC2oYTkrxXE_-bUAzS2wMMQhSP4Az1ZaJDBAmJj6AHVCzUwNqAA13VVmMNWOw06QQK6eSB8KoyyECpCF_cxuF5K9wyLEoPVJh_gnVP9VeljkZRdghpoCHTBqyugJPnWR6wSuJBRnfEj_c05609c7.jpeg',
      ],
    },
    {
      ownerId: ownerIds[2],
      catSlug: 'machinery',
      subSlug: 'excavators',
      title: 'Komatsu Heavy Crawler Excavator — With Certified Operator',
      title_am: 'ኮማትሱ ከባድ ኤክስካቫተር — ከባለሙያ ኦፕሬተር ጋር',
      description: 'High-capacity crawler excavator for roadworks, foundation excavation, and mining projects across Oromia and Addis Ababa.',
      description_am: 'ለመንገድ እና ለሕንፃ መሠረት ቁፋሮ ዝግጁ የሆነ ከባድ ኤክስካቫተር።',
      price_hourly: 4800,
      price_daily: 34000,
      price_weekly: 195000,
      price_monthly: 680000,
      primary_duration: 'daily',
      region: 'Oromia',
      city: 'Adama',
      sub_city: 'Bole Sub-City',
      neighborhood: 'Franko / Melka Adama',
      lat: 8.5400,
      lng: 39.2700,
      conditions: 'Operator included. Low-bed mobilization fee calculated by site distance; fuel provided by renter.',
      specs: { operatorAvailable: true, fuelArrangement: 'Renter supplies diesel', transportFee: '25,000 ETB within 100km', bucketCapacity: '2.4 m³' },
      images: [
        '7NCx05bZ7v73teW1Zsamwxa0ZheUYB8lypO2-1Efb-Y_Z7D-1_idAX_ObUeejnr0MklqQdS16r2Ou_Wdgxuq1T8KPfDueDgqqh3lk32EQUlncqRXbQg-d7tJGEPYzbgNaTesa5Ds03jGeBzHcim2RDDqK1o_wMmfuShbjadANm91JLbCLgwO5W1Tsm67RH_Y_91191079.jpeg',
      ],
    },
    {
      ownerId: ownerIds[3],
      catSlug: 'event',
      subSlug: 'wedding-equipment',
      title: 'Luxury Wedding Banquet Tables, Gold Chiavari Chairs & Floral Package',
      title_am: 'ለሰርግ እና ለድግስ የክብር ጠረጴዛዎች፣ ወንበሮች እና ዲኮር',
      description: 'Full 150-guest reception setup including round banquet tables, dressed Chiavari chairs, tableware, and floral centerpiece stands.',
      description_am: 'ለ150 እንግዶች የሚበቃ የሰርግ ጠረጴዛ፣ ወንበሮች እና የማስዋቢያ ዕቃዎች።',
      price_daily: 22000,
      price_weekly: 95000,
      price_monthly: null,
      primary_duration: 'daily',
      region: 'Sidama',
      city: 'Hawassa',
      sub_city: 'Haik Dar',
      neighborhood: 'Lake View / Piassa',
      lat: 7.0504,
      lng: 38.4955,
      conditions: 'Setup and teardown team included within Hawassa city limits.',
      specs: { capacityGuests: 150, setupIncluded: true, tentAvailable: true },
      images: [
        'HiwzEAwI2Cenu2RpyyQDIVvk6s_eefPo6yvLR5HuZiSTi_jmLxpvtoStbUZQI7hXnqxAhJtSoAKVHxo2CENxKe4v-spCEts3OLwRogM_ghL-yFESlwwHsZLBiyGG-gmZohJ_hWyjuuKZ9Yci52AtFL2l6wGY0muOSo72HKZdYVFofUVhdoMBdkx9qfwRcK7N_0a52fbb0.jpeg',
      ],
    },
  ];

  const insertListing = db.prepare(`
    INSERT INTO listings (
      owner_id, category_id, subcategory_id, title, title_am, description, description_am,
      price_hourly, price_daily, price_weekly, price_monthly, currency, primary_duration,
      region, city, sub_city, neighborhood, latitude, longitude, rental_conditions,
      specs_json, status, is_verified, views_count, duplicate_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ETB', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 1, ?, ?)
  `);
  const insertImage = db.prepare(`
    INSERT INTO listing_images (listing_id, original_path, watermarked_path, sort_order, is_watermarked, width, height)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const item of starterItems) {
    const catId = getCatId(item.catSlug);
    const subId = getSubId(item.subSlug);
    if (!catId) continue;

    const dupHash = crypto.createHash('sha256').update(`${item.ownerId}:${item.title}:${item.city}`).digest('hex');
    const res = insertListing.run(
      item.ownerId,
      catId,
      subId || null,
      item.title,
      item.title_am,
      item.description,
      item.description_am,
      item.price_hourly ?? null,
      item.price_daily ?? null,
      item.price_weekly ?? null,
      item.price_monthly ?? null,
      item.primary_duration,
      item.region,
      item.city,
      item.sub_city,
      item.neighborhood,
      item.lat,
      item.lng,
      item.conditions,
      JSON.stringify(item.specs),
      Math.floor(40 + Math.random() * 140),
      dupHash
    );
    const listingId = Number(res.lastInsertRowid);

    for (let i = 0; i < item.images.length; i++) {
      const imgFile = path.join(assetDir, item.images[i]);
      if (fs.existsSync(imgFile)) {
        const buf = fs.readFileSync(imgFile);
        const processed = await processAndWatermarkImage(buf, path.extname(imgFile));
        insertImage.run(
          listingId,
          processed.originalPath,
          processed.watermarkedPath,
          i,
          processed.isWatermarked ? 1 : 0,
          processed.width,
          processed.height
        );
      }
    }
  }
}

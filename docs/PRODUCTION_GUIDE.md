# AZ RENTAL — Production Architecture & Operations Guide

## 1. System Architecture
- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite + `vite-plugin-pwa` (offline caching & mobile home-screen install), Leaflet OpenStreetMap discovery, Recharts analytics, WebRTC P2P calling.
- **Backend**: Node.js + Express (`server.ts`) + WebSocket server (`ws` on `/ws`) running on port 3000.
- **Database**: SQLite (`better-sqlite3`, WAL mode, foreign keys enabled) at `data/azrental.db` with structured migrations in `src/server/db.ts`.
- **Media & Watermarking**: `sharp` compresses and applies the official AZ RENTAL watermark to listing images (`storage/public/images/`), while `/usr/bin/ffmpeg` transcodes and watermarks listing videos (`storage/public/videos/`). Originals are protected inside `storage/originals/`.

## 2. Environment Variables
Configure secrets in your production environment (see `.env.example`):
- `SESSION_SECRET`: Strong 32+ byte random string for HMAC token signing.
- `ADMIN_PASSCODE`: Optional passcode required when claiming the initial Super Admin account.
- `TELEBIRR_APP_ID`, `TELEBIRR_APP_KEY`, `TELEBIRR_SHORT_CODE`: Telebirr merchant credentials.
- `CHAPA_SECRET_KEY`, `CHAPA_WEBHOOK_SECRET`: Chapa Ethiopia live keys.
- `CBE_BIRR_MERCHANT_ID`, `CBE_BIRR_API_KEY`: CBE Birr authorized merchant keys.
- `SMS_API_KEY` / `SMTP_URL`: Live OTP SMS & email delivery credentials.

## 3. Build, Test, and Run
```bash
npm run test    # Run Vitest full-stack integration tests
npm run lint    # Run TypeScript type check
npm run build   # Build production Vite bundle into dist/
npm run start   # Start production Express + WebSocket server
```

## 4. Backup & Recovery
- Back up `data/azrental.db` (using SQLite `.backup` or while WAL checkpointed) alongside `storage/` directory daily.
- Restore by placing the backup DB at `data/azrental.db` and `storage/` assets, then running `npm run start`.

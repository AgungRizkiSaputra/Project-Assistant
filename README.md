# Personal Product Assistant — Telegram AI Bot

Personal Product Assistant adalah bot Telegram AI pribadi yang bertindak sebagai **Personal Product Manager**: menangkap ide mentah (*Idea Inbox*), mematangkannya lewat percakapan terarah (*Hybrid Discovery*), mengekstrak keputusan ke dalam *Structured Memory*, menyusun dokumen Product Requirements Document (PRD) berstandar industri, serta mengekspornya langsung ke format **Markdown (.md)** dan **PDF**.

---

## 🛠️ Teknologi & Tools yang Digunakan

| Kategori | Teknologi / Library | Versi | Alasan Penggunaan & Peran |
| :--- | :--- | :--- | :--- |
| **Runtime & Language** | **Node.js** + **TypeScript** | Node 20+/24+, TS 7.x | Memberikan pondasi backend yang cepat, strongly-typed, dan aman dari runtime type error. |
| **Telegram Framework** | **grammY** (`grammy`) | ^1.46.0 | Framework bot Telegram TypeScript-first yang modern, berperforma tinggi, dan memiliki sistem middleware yang modular. |
| **Database & Auth** | **Supabase (PostgreSQL)** | `@supabase/supabase-js` ^2.118.0 | Database relasional untuk menyimpan tabel pengguna, ide, sesi discovery, keputusan terstruktur (*structured memory*), versi dokumen PRD, dan log deduplikasi. Lengkap dengan Row Level Security (RLS). |
| **AI Providers** | **Google Gen AI SDK** (`@google/genai`)<br>**OpenAI SDK** (`openai`) | ^2.32.0<br>^7.47.0 | Arsitektur adapter AI yang fleksibel: mendukung Gemini (default: `gemini-2.5-flash`) dan OpenAI (default: `gpt-4o-mini`) tanpa vendor lock-in. Dilengkapi ekstraksi Structured JSON Output. |
| **Document Processing**| **Marked** (`marked`) | ^18.1.2 | Parser Markdown super cepat untuk mengonversi draf PRD dari AI menjadi struktur HTML bersih sebelum dirender ke PDF. |
| **PDF Rendering** | **Playwright** (`playwright`) | ^1.64.1 | Headless Chromium browser engine untuk menghasilkan dokumen PRD berformat PDF A4 siap cetak dengan tata letak rapi, page numbering, dan styling tipografi modern. |
| **Schema Validation** | **Zod** (`zod`) | ^4.6.7 | Validasi ketat variabel environment (`.env`) saat aplikasi boot, mencegah crash tersembunyi akibat konfigurasi yang salah. |
| **Structured Logging** | **Pino** (`pino`, `pino-pretty`) | ^10.4.0 | Logger JSON berperforma tinggi dengan format warna-warni saat mode development untuk pelacakan request Telegram dan API AI. |
| **Testing** | **Vitest** (`vitest`) | ^5.0.5 | Test runner modern super cepat berbasis ESM untuk unit & integration test seluruh domain service. |
| **Development Runner** | **TSX** (`tsx`) | ^4.23.15 | TypeScript execute runner dengan fitur file watching otomatis saat proses coding. |

---

## 🏛️ Arsitektur Sistem (Modular Monolith)

```
personal-product-assistant/
├── .env.example                # Template konfigurasi environment
├── migrations/
│   ├── 001_initial_schema.sql  # Skema 12 tabel PostgreSQL, index, dan foreign keys
│   └── 002_rls_and_policies.sql# Kebijakan Row Level Security (RLS)
├── src/
│   ├── ai/                     # Abstraksi Provider AI (Gemini, OpenAI, Factory)
│   ├── config/                 # Validasi Env Zod dan Pino Logger
│   ├── db/                     # Supabase Client dan TypeScript Database Types
│   ├── modules/
│   │   ├── auth/               # Whitelist Telegram ID & sinkronisasi user
│   │   ├── discovery/          # Hybrid AI Discovery Session Engine
│   │   ├── export/             # Markdown (.md) & Playwright PDF Renderer
│   │   ├── ideas/              # Idea Inbox capture & management
│   │   ├── memory/             # Structured Memory (Confirmed/Suggested/Unknown)
│   │   ├── prd/                # PRD generator 16 seksi & Immutable Versioning
│   │   └── projects/           # Project lifecycle & concurrency lock
│   ├── telegram/               # GrammY adapter, middleware deduplikasi, view keyboards
│   └── main.ts                 # Entry point aplikasi & graceful shutdown
└── tests/                      # Suite pengujian unit & integrasi (Vitest)
```

---

## 📱 Panduan Langkah Demi Langkah: Mencoba Langsung di Telegram

Berikut adalah panduan praktis untuk mencoba bot secara langsung di akun Telegram Anda:

### Langkah 1: Buat Bot di Telegram & Ambil Token
1. Buka aplikasi Telegram di HP atau Laptop Anda.
2. Cari akun resmi **[@BotFather](https://t.me/botfather)** lalu klik **Start**.
3. Ketik perintah:
   ```text
   /newbot
   ```
4. Masukkan nama bot Anda (misal: `Personal Product Assistant`).
5. Masukkan username bot (harus berakhiran `bot`, misal: `my_product_pm_bot`).
6. BotFather akan memberikan **HTTP API Token**, bentuknya seperti ini:
   `8123456789:AAHxxxxx_abcdefghijklmnopqrstuvwxyz`
   *(Simpan token ini).*

---

### Langkah 2: Dapatkan Telegram User ID Anda
Bot ini memiliki sistem proteksi (*allowlist*) agar hanya Anda yang bisa menggunakannya:
1. Di Telegram, cari bot **[@userinfobot](https://t.me/userinfobot)** lalu klik **Start**.
2. Bot tersebut akan membalas dengan info akun Anda:
   ```text
   Id: 123456789
   First: Nama Anda
   ```
3. Catat angka `Id` tersebut (misal: `123456789`).

---

### Langkah 3: Siapkan Supabase Database
1. Buka website **[Supabase](https://supabase.com)** (gratis) dan buat proyek baru (*New Project*).
2. Setelah proyek dibuat, buka menu **Project Settings** (ikon gear di kiri bawah) > **API**.
3. Salin 2 nilai ini:
   - **Project URL** (misal: `https://xyzproject.supabase.co`)
   - **service_role secret key** (bukan `anon key`, klik tombol *Reveal* pada `service_role`).
4. Buka menu **SQL Editor** di sidebar Supabase, lalu jalankan dua file migrasi ini secara berurutan:
   - Copy seluruh teks dari file [`migrations/001_initial_schema.sql`](file:///c:/Users/agung/.gemini/antigravity-ide/scratch/personal-product-assistant/migrations/001_initial_schema.sql) -> tempel di SQL Editor -> klik **Run**.
   - Copy seluruh teks dari file [`migrations/002_rls_and_policies.sql`](file:///c:/Users/agung/.gemini/antigravity-ide/scratch/personal-product-assistant/migrations/002_rls_and_policies.sql) -> tempel di SQL Editor -> klik **Run**.

---

### Langkah 4: Ambil API Key AI
- Dapatkan Google Gemini API Key secara gratis di **[Google AI Studio](https://aistudio.google.com/app/apikey)**.
- *(Atau jika ingin memakai OpenAI)*: Ambil API Key di **[OpenAI Platform](https://platform.openai.com/api-keys)**.

---

### Langkah 5: Buat File `.env`
Di folder proyek `personal-product-assistant`, buat file baru bernama `.env` (atau duplikasi dari `.env.example`), lalu isi dengan data yang sudah Anda dapatkan:

```env
# Token dari @BotFather
TELEGRAM_BOT_TOKEN=8123456789:AAHxxxxx_abcdefghijklmnopqrstuvwxyz

# ID Akun Telegram Anda dari @userinfobot
TELEGRAM_ALLOWED_USER_IDS=123456789

# Database Supabase
SUPABASE_URL=https://xyzproject.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...kunciserviceroleanda

# Provider AI
DEFAULT_AI_PROVIDER=gemini
AI_MODEL_GEMINI=gemini-2.5-flash
GEMINI_API_KEY=AIzaSy...kuncigeminianda

# Konfigurasi Tambahan
NODE_ENV=development
LOG_LEVEL=info
```

---

### Langkah 6: Install Playwright Chromium (Untuk Render PDF)
Jalankan perintah ini di terminal workspace:
```bash
npx playwright install chromium
```

---

### Langkah 7: Nyalakan Bot
Jalankan perintah berikut di terminal:
```bash
npm run dev
```
Jika berhasil, terminal akan menampilkan log:
```text
[INFO] Telegram Bot successfully started
[INFO] Personal Product Assistant bot starting polling...
```

---

### 🎮 Langkah 8: Uji Coba Alur Kerja di Telegram

1. **Memulai Sesi**:
   - Buka bot Telegram yang baru Anda buat, lalu kirim `/start`.
   - Bot akan membalas dengan salam pembuka dan menampilkan tombol menu utama.
2. **Menangkap Ide Mentah (Idea Inbox)**:
   - Kirimkan ide produk Anda secara langsung, contohnya:
     > *"Saya ingin membuat aplikasi web SaaS untuk mengelola langganan bulanan pribadi dan mengingatkan sebelum tagihan terpotong otomatis."*
   - Bot otomatis mencatatnya ke **Inbox** dan menampilkan tombol **🚀 Jadikan Proyek**.
3. **Mengembangkan Ide (Hybrid Discovery)**:
   - Klik **🚀 Jadikan Proyek**.
   - AI Product Manager akan menganalisis ide Anda dan mengajukan **1 pertanyaan terarah** (misal mengenai target pengguna atau metode integrasi bank).
   - Jawab pertanyaan tersebut di chat. AI secara otomatis memasukkan keputusan ke **Structured Memory**.
4. **Mengecek Keputusan**:
   - Ketik `/review` untuk melihat rekap keputusan yang sudah terkonfirmasi (`CONFIRMED`) vs yang masih diusulkan atau belum jelas (`UNKNOWN`).
5. **Membuat & Mengunduh PRD**:
   - Ketik `/prd` lalu klik tombol **📑 Generate PRD**.
   - Bot akan meracik dokumen PRD lengkap 16 seksi (Overview, User Persona, Core Journey, Functional Requirements, MVP Scope, dsb.).
   - Klik tombol **📥 Unduh Markdown (.md)** untuk mendapatkan file markdown murni, atau klik **📄 Unduh PDF** untuk menerima dokumen PDF berstandar cetak langsung di chat Telegram Anda!

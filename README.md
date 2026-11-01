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
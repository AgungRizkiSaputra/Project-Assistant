import { DiscoveryPhase } from '../../db/types.js';

export interface PhaseMetadata {
  id: DiscoveryPhase;
  number: number;
  title: string;
  shortName: string;
  emoji: string;
  description: string;
  keyAspects: string[];
  nextPhase: DiscoveryPhase | null;
  prevPhase: DiscoveryPhase | null;
}

export const DISCOVERY_PHASES: Record<DiscoveryPhase, PhaseMetadata> = {
  PHASE_1_IDEA: {
    id: 'PHASE_1_IDEA',
    number: 1,
    title: 'Idea Discovery & Value Proposition',
    shortName: 'Idea Discovery',
    emoji: '💡',
    description: 'Menangkap tujuan proyek, masalah inti, nilai pembeda produk, dan target awal.',
    keyAspects: ['Tujuan Proyek', 'Inti Masalah', 'Value Proposition', 'Target Audiens Awal'],
    nextPhase: 'PHASE_2_PRODUCT',
    prevPhase: null,
  },
  PHASE_2_PRODUCT: {
    id: 'PHASE_2_PRODUCT',
    number: 2,
    title: 'Product Scope & User Personas',
    shortName: 'Product Discovery',
    emoji: '🎯',
    description: 'Mendefinisikan personas spesifik, batasan tegas MVP vs masa depan, serta asumsi kritis.',
    keyAspects: ['User Personas', 'MVP Scope', 'Future Scope', 'Out of Scope', 'Asumsi & Risiko'],
    nextPhase: 'PHASE_3_FLOW',
    prevPhase: 'PHASE_1_IDEA',
  },
  PHASE_3_FLOW: {
    id: 'PHASE_3_FLOW',
    number: 3,
    title: 'Requirements & User Flow Journey',
    shortName: 'Requirements & Flow',
    emoji: '🔄',
    description: 'Menyusun Functional & Non-Functional Requirements, matriks peran (RBAC), dan alur journey end-to-end.',
    keyAspects: ['Functional Requirements', 'Non-Functional Requirements', 'Role & Permission Matrix', 'Core User Journey', 'Edge Cases & Business Rules'],
    nextPhase: 'PHASE_4_UIUX',
    prevPhase: 'PHASE_2_PRODUCT',
  },
  PHASE_4_UIUX: {
    id: 'PHASE_4_UIUX',
    number: 4,
    title: 'UI/UX & Design Direction (Anti-Slop)',
    shortName: 'UI/UX Design Direction',
    emoji: '🎨',
    description: 'Menetapkan identitas visual khas, tokens warna, tipografi, grid responsif, serta spesifikasi detail tiap halaman (termasuk empty/loading/error states).',
    keyAspects: ['Distinctive Visual Identity', 'Design Tokens & Palette', 'Page-by-Page Specs', 'Component System', 'Responsive Behavior', 'Empty/Loading/Error States'],
    nextPhase: 'PHASE_5_TECH',
    prevPhase: 'PHASE_3_FLOW',
  },
  PHASE_5_TECH: {
    id: 'PHASE_5_TECH',
    number: 5,
    title: 'Technical Architecture & Data Model',
    shortName: 'Technical Architecture',
    emoji: '⚙️',
    description: 'Menentukan rekomendasi stack rasional, skema database relasional lengkap dengan relasi & indexes, spesifikasi endpoint API, dan struktur sistem.',
    keyAspects: ['Tech Stack Justification', 'Database Schema & Relations', 'API Specifications', 'System Architecture & Folder Structure', 'Deployment Architecture'],
    nextPhase: 'PHASE_6_SECURITY',
    prevPhase: 'PHASE_4_UIUX',
  },
  PHASE_6_SECURITY: {
    id: 'PHASE_6_SECURITY',
    number: 6,
    title: 'Security Architecture & OWASP Top 10',
    shortName: 'Security & OWASP',
    emoji: '🛡️',
    description: 'Menganalisis attack surface dan menetapkan mitigasi teknis konkret berbasis standar OWASP Top 10 terkini (Access Control, Cryptography, Injection, Auth, dll.).',
    keyAspects: ['OWASP Top 10 Mapping', 'Attack Scenarios & Blast Radius', 'Technical Mitigations', 'Security Acceptance Criteria', 'Secrets & Audit Logging'],
    nextPhase: 'PHASE_7_VALIDATION',
    prevPhase: 'PHASE_5_TECH',
  },
  PHASE_7_VALIDATION: {
    id: 'PHASE_7_VALIDATION',
    number: 7,
    title: 'Pre-Flight Quality Check & Approval',
    shortName: 'Validation & Approval',
    emoji: '✅',
    description: 'Menilai kelengkapan dan konsistensi 10 dimensi produk sebelum dokumen PRD final di-generate.',
    keyAspects: ['Requirements Consistency', 'Flow Completeness', 'Database-Feature Match', 'Security Coverage', 'User Confirmation'],
    nextPhase: 'PHASE_8_PRD_READY',
    prevPhase: 'PHASE_6_SECURITY',
  },
  PHASE_8_PRD_READY: {
    id: 'PHASE_8_PRD_READY',
    number: 8,
    title: 'PRD Document Generation (29 Seksi)',
    shortName: 'PRD Ready',
    emoji: '📑',
    description: 'Dokumen PRD 29 seksi standar industri siap di-generate dan diekspor ke Markdown.',
    keyAspects: ['29 Section PRD', 'Developer-Ready', 'AI Coding Agent-Ready', 'Export Markdown'],
    nextPhase: null,
    prevPhase: 'PHASE_7_VALIDATION',
  },
};

export function getPhaseMetadata(phase: DiscoveryPhase): PhaseMetadata {
  return DISCOVERY_PHASES[phase] || DISCOVERY_PHASES.PHASE_1_IDEA;
}

export function getPhasePromptInstruction(phase: DiscoveryPhase, projectTitle: string, projectSummary: string): string {
  const meta = getPhaseMetadata(phase);
  
  switch (phase) {
    case 'PHASE_1_IDEA':
      return `FASE 1: IDEA DISCOVERY & VALUE PROPOSITION
Tujuan: Memahami ide dasar dan arah produk.
Aspek yang wajib digali secara bertahap dan adaptif:
- Jenis produk / platform: Website, Web App, Mobile App, Desktop App, SaaS, Cross-platform, atau Custom.
- Tujuan utama proyek & problem statement inti yang ingin diselesaikan.
- Target pengguna spesifik (Individual/B2C, Business/B2B, Enterprise, Community, atau Niche).
- Solusi utama & keunikan/nilai pembeda (Unique Value Proposition) produk.

Hasilkan SATU pertanyaan terarah (question) dengan 3-5 opsi dinamis yang sangat relevan dengan jenis produk "${projectTitle}".
Tentukan apakah pertanyaan multiSelect (misal target pengguna bisa B2C & B2B) atau single (misal platform utama).
Sertakan rekomendasi AI (aiRecommendation) yang beralasan kuat.`;

    case 'PHASE_2_PRODUCT':
      return `FASE 2: PRODUCT SCOPE & PERSONAS
Tujuan: Menentukan produk dan batasan pengembangan.
Aspek yang wajib digali secara bertahap dan adaptif:
- Target audience & user personas mendalam.
- Core features (fitur utama mutlak) vs Supporting features.
- MVP scope (versi 1.0) vs Future features vs Out of scope.
- Business model jika relevan (Freemium, Subscription, Marketplace fee, One-time, dll.).
- Batasan proyek & asumsi kritis.

Hasilkan SATU pertanyaan terarah (question) dengan pilihan fitur/scope yang sangat spesifik untuk proyek "${projectTitle}".
Gunakan multiSelect: true jika menanyakan fitur-fitur MVP atau opsi modul.
Sertakan rekomendasi prioritas AI (aiRecommendation).`;

    case 'PHASE_3_FLOW':
      return `FASE 3: REQUIREMENTS & USER FLOW
Tujuan: Merancang cara kerja sistem secara menyeluruh.
Aspek yang wajib digali secara bertahap dan adaptif:
- User roles (misal Buyer, Seller, Superadmin, kurir, dll. sesuai jenis produk).
- Hak akses dan permission matrix setiap role.
- Alur registrasi/login (Email/Password, OAuth Google/Apple, OTP WhatsApp, Magic Link).
- Workflow kunci tiap role dari awal hingga nilai produk tercapai.
- Business rules, validasi state transitions, dan edge cases penting.

Hasilkan SATU pertanyaan terarah (question) terkait roles, authentication flow, atau core journey dengan opsi pilihan yang sesuai untuk "${projectTitle}".
Sertakan rekomendasi AI (aiRecommendation) untuk skenario paling praktis dan aman.`;

    case 'PHASE_4_UIUX':
      return `FASE 4: UI/UX & DESIGN DIRECTION (ANTI-SLOP)
Tujuan: Menghasilkan identitas visual khas dan pengalaman pengguna tanpa template AI-slop generik.
Aspek yang wajib digali secara bertahap dan adaptif:
- Design style & aesthetic mood: Minimalist Editorial, Clean SaaS, Neo-brutalist, Luxury/Sophisticated, High-Density Data, Playful Friendly, atau Dark-mode Tech.
- Preferensi warna & mood palette (Accent color, background mood).
- Layout & navigasi utama (Top Navbar, Left Sidebar, Bottom Tabs Mobile, Floating dock).
- Responsive behavior & micro-interactions.
- Spesifikasi halaman per halaman (layout, component system, empty/loading/error states).

Hasilkan SATU pertanyaan terarah (question) menawarkan pilihan design direction yang berkarakter kuat untuk "${projectTitle}".
Jelaskan keunikan masing-masing opsi desain.
Sertakan rekomendasi AI (aiRecommendation) sesuai audiens target produk.`;

    case 'PHASE_5_TECH':
      return `FASE 5: TECHNICAL ARCHITECTURE & DATA MODEL
Tujuan: Menentukan arsitektur teknologi yang tepat, terukur, dan efisien.
Aspek yang wajib digali secara bertahap dan adaptif:
- Frontend framework (Next.js/React, Vue/Nuxt, Svelte, React Native/Flutter).
- Backend & API architecture (Node.js/TypeScript, Python/FastAPI, Go, Serverless, REST vs GraphQL).
- Database & data modeling (PostgreSQL, MySQL, Redis, MongoDB) beserta relasi constraints.
- Authentication, storage, dan integrasi pihak ketiga (Payment Gateway Midtrans/Stripe, Maps, Cloudflare).
- Deployment architecture & hosting (Vercel, Render, Railway, AWS, Docker).

Hasilkan SATU pertanyaan terarah (question) mengenai rekomendasi stack atau infrastruktur yang paling rasional untuk skala "${projectTitle}".
Sertakan rekomendasi AI (aiRecommendation) mempertimbangkan kemudahan deployment, biaya, dan performa.`;

    case 'PHASE_6_SECURITY':
      return `FASE 6: SECURITY ARCHITECTURE & OWASP TOP 10
Tujuan: Menentukan postur keamanan berbasis ancaman riil proyek.
Aspek yang wajib digali secara bertahap dan adaptif:
- OWASP Top 10 Web Application & API Security Risks:
  1. Broken Access Control & Server-side Authorization.
  2. Cryptographic Failures & Sensitive Data Protection.
  3. Injection Prevention (SQL, XSS, CSRF).
  4. Insecure Design & Rate Limiting / Brute-force Protection.
  5. Authentication & Session Management.
  6. File Upload Protection & Data Integrity.
  7. Audit Logging, Monitoring, & Secrets Management.
- Menentukan proteksi data sensitif, pembayaran, atau privacy sesuai attack surface.

Hasilkan SATU pertanyaan terarah (question) mengenai kontrol keamanan atau kepatuhan yang paling relevan untuk "${projectTitle}".
Sertakan rekomendasi AI (aiRecommendation) dengan mitigasi teknis konkret.`;

    case 'PHASE_7_VALIDATION':
      return `FASE 7: PRE-FLIGHT QUALITY CHECK & APPROVAL
Tujuan: Mengaudit kelengkapan dan konsistensi seluruh keputusan sebelum penyusunan PRD final 29 seksi.
Aspek yang dievaluasi:
- Rangkuman keputusan lintas fase (Fitur, Role, Flow, UI/UX, Tech Stack, Security).
- Cek celah terbuka, kontradiksi, atau kebutuhan wajib yang belum jelas.
- Memberikan kesempatan pengguna mengubah atau menyetujui seluruh spesifikasi.

Hasilkan pertanyaan konfirmasi persetujuan atau pilihan bagian mana yang ingin disempurnakan sebelum dokumen PRD di-generate.`;

    case 'PHASE_8_PRD_READY':
      return `FASE 8: PRD GENERATION & READY
Tujuan: Menyusun dokumen PRD 29 seksi standar industri melalui tombol "Generate PRD (29 Seksi)" sistem.
ATURAN WAJIB FASE 8:
- JANGAN pernah menuliskan isi lengkap dokumen PRD 29 seksi secara langsung ke dalam field JSON "assistantResponse" karena akan melebihi batas pesan Telegram dan tidak tersimpan ke database PRD.
- JANGAN membuat opsi palsu seperti "Tampilkan PRD Sekarang".
- Jelaskan secara singkat bahwa spesifikasi sudah siap atau catat revisi terakhir pengguna ke dalam "identifiedDecisions", lalu arahkan pengguna menekan tombol "📑 Generate PRD (29 Seksi)" di bawah pesan.
- Kosongkan field "question" (jangan kirim opsi pertanyaan baru) kecuali pengguna secara spesifik meminta revisi aspek tertentu.`;

    default:
      return meta.description;
  }
}


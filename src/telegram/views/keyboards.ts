import { InlineKeyboard } from 'grammy';
import { DiscoveryPhase } from '../../db/types.js';
import { getPhaseMetadata } from '../../modules/discovery/phases.config.js';
import { DiscoveryQuestion } from '../../modules/discovery/discovery.service.js';

export function escapeMarkdown(text: string): string {
  if (!text) return '';
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

export const PHASE_NUM_TO_KEY: Record<number, DiscoveryPhase> = {
  1: 'PHASE_1_IDEA',
  2: 'PHASE_2_PRODUCT',
  3: 'PHASE_3_FLOW',
  4: 'PHASE_4_UIUX',
  5: 'PHASE_5_TECH',
  6: 'PHASE_6_SECURITY',
  7: 'PHASE_7_VALIDATION',
  8: 'PHASE_8_PRD_READY',
};

export const PHASE_KEY_TO_NUM: Record<DiscoveryPhase, number> = {
  PHASE_1_IDEA: 1,
  PHASE_2_PRODUCT: 2,
  PHASE_3_FLOW: 3,
  PHASE_4_UIUX: 4,
  PHASE_5_TECH: 5,
  PHASE_6_SECURITY: 6,
  PHASE_7_VALIDATION: 7,
  PHASE_8_PRD_READY: 8,
};

export function getMainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('💡 Ide Baru', 'cmd_new_idea')
    .text('📥 Idea Inbox', 'cmd_list_ideas')
    .row()
    .text('🚀 Proyek Aktif', 'cmd_list_projects')
    .text('📑 Dokumen PRD', 'cmd_list_prds')
    .row()
    .text('⚙️ Pengaturan', 'cmd_settings')
    .text('❓ Bantuan', 'cmd_help');
}

export function getDiscoveryPhaseKeyboard(
  projectId: string,
  currentPhase: DiscoveryPhase,
  canAdvance: boolean,
  isReadyForValidation: boolean
): InlineKeyboard {
  const meta = getPhaseMetadata(currentPhase);
  const kb = new InlineKeyboard();

  if (meta.nextPhase && canAdvance) {
    const nextMeta = getPhaseMetadata(meta.nextPhase);
    const nextNum = PHASE_KEY_TO_NUM[meta.nextPhase];
    kb.text(`⏭️ Lanjut ke ${nextMeta.shortName}`, `adv_${projectId}_${nextNum}`).row();
  }

  if (meta.prevPhase) {
    const prevMeta = getPhaseMetadata(meta.prevPhase);
    const prevNum = PHASE_KEY_TO_NUM[meta.prevPhase];
    kb.text(`⏮️ Kembali ke ${prevMeta.shortName}`, `adv_${projectId}_${prevNum}`);
  }

  kb.text('🔍 Review Audit', `audit_${projectId}`).row();

  if (isReadyForValidation || meta.number >= 6) {
    kb.text('✅ Validasi Kesiapan PRD', `val_ready_${projectId}`).row();
    kb.text('📑 Generate PRD (29 Seksi)', `gen_prd_${projectId}`).row();
  }

  kb.text('🔙 Menu Utama', 'cmd_menu');
  return kb;
}

export function getInteractiveQuestionKeyboard(
  projectId: string,
  question: DiscoveryQuestion
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const selected = new Set(question.selectedOptionIds || []);

  // 1. Render opsi pilihan (1 opsi per baris agar nyaman dibaca di mobile Telegram)
  question.options.forEach((opt, idx) => {
    const isChosen = selected.has(opt.id);
    const mark = question.multiSelect ? (isChosen ? '☑️ ' : '⬜ ') : isChosen ? '🔘 ' : '⚪ ';
    kb.text(`${mark}${opt.label}`, `dq_opt_${projectId}_${idx}`).row();
  });

  // 2. Baris tombol aksi: AI Recommendation & Custom
  const actionRow: Array<{ text: string; data: string }> = [];
  if (question.aiRecommendation) {
    actionRow.push({ text: '💡 Rekomendasi AI', data: `dq_rec_${projectId}` });
  }
  if (question.allowCustom !== false) {
    actionRow.push({ text: '✏️ Ketik Sendiri', data: `dq_cst_${projectId}` });
  }
  if (actionRow.length > 0) {
    actionRow.forEach((b) => kb.text(b.text, b.data));
    kb.row();
  }

  // 3. Baris tombol bantuan: "Saya belum tahu" & "Lewati"
  const assistRow: Array<{ text: string; data: string }> = [
    { text: '🤷 Saya Belum Tahu', data: `dq_dnt_${projectId}` },
  ];
  if (question.allowSkip) {
    assistRow.push({ text: '⏩ Lewati', data: `dq_skp_${projectId}` });
  }
  assistRow.forEach((b) => kb.text(b.text, b.data));
  kb.row();

  // 4. Tombol Konfirmasi jika multiSelect atau sudah ada opsi yang dipilih
  if (question.multiSelect) {
    const hasSelection = selected.size > 0;
    kb.text(
      hasSelection ? `✅ Konfirmasi Pilihan (${selected.size})` : '✅ Pilih Opsi di Atas',
      `dq_cf_${projectId}`
    ).row();
  }

  return kb;
}

export function getStartMessage(firstName: string = 'Founder'): string {
  return (
    `👋 Halo, *${firstName}*! Selamat datang di *AI Product Architect*.\n\n` +
    `Saya adalah arsitek produk AI pribadi Anda untuk merancang sistem website dan aplikasi: dari analisis discovery 8-fase terarah, arsitektur UI/UX anti-slop, perancangan database & API, pemetaan keamanan *OWASP Top 10*, hingga menyusun *PRD 29 seksi standar industri* yang siap dieksekusi developer/AI Coding Agent.\n\n` +
    `*Alur 8 Fase Discovery:*\n` +
    `1️⃣ Idea Discovery → 2️⃣ Product Scope → 3️⃣ Requirements & Flow → 4️⃣ UI/UX Direction → 5️⃣ Tech Architecture → 6️⃣ Security & OWASP → 7️⃣ Pre-Flight Audit → 8️⃣ PRD 29 Seksi\n\n` +
    `*Perintah Cepat:*\n` +
    `• /new — Catat ide produk atau aplikasi baru\n` +
    `• /ideas — Buka Idea Inbox & kelola ide\n` +
    `• /projects — Lihat & lanjutkan proyek produk\n` +
    `• /continue — Lanjutkan discovery proyek yang sedang berjalan\n` +
    `• /review — Audit kesiapan & validasi kelengkapan keputusan\n` +
    `• /prd — Akses dan unduh dokumen PRD (.md)\n` +
    `• /settings — Konfigurasi provider AI & preferensi\n` +
    `• /help — Panduan lengkap penggunaan\n\n` +
    `_Pilih menu di bawah atau langsung ketik ide Anda!_`
  );
}

export function getHelpMessage(): string {
  return (
    `📖 *Panduan Alur Kerja AI Product Architect*\n\n` +
    `*1. Siklus 8 Fase Produk:*\n` +
    `💡 *1. Idea Discovery*: Klarifikasi tujuan, problem, value proposition, dan target awal.\n` +
    `🎯 *2. Product Scope*: Personas spesifik, batasan tegas MVP vs Future vs Out of Scope.\n` +
    `🔄 *3. Requirements & Flow*: Functional Requirements (FR-xx), role matrix, user journey.\n` +
    `🎨 *4. UI/UX Direction*: Identitas visual anti-slop, design tokens, spesifikasi tiap halaman (empty/loading/error states).\n` +
    `⚙️ *5. Technical Architecture*: Tech stack, DDL Database PostgreSQL, spesifikasi REST API.\n` +
    `🛡️ *6. Security & OWASP*: Mitigasi ancaman OWASP Top 10 terkini (Access control, Injection, Auth, dll).\n` +
    `✅ *7. Pre-Flight Validation*: Quality checklist 10 dimensi memastikan tidak ada celah & kontradiksi.\n` +
    `📑 *8. PRD Generation*: Dokumen PRD komprehensif 29 Seksi Standar Industri dalam format Markdown murni.\n\n` +
    `*2. Perintah yang Tersedia:*\n` +
    `• \`/start\` : Tampilkan menu utama\n` +
    `• \`/new <judul | deskripsi>\` : Simpan ide baru secara langsung ke Inbox\n` +
    `• \`/ideas\` : Daftar semua ide mentah yang tersimpan\n` +
    `• \`/projects\` : Daftar proyek produk yang sedang dikerjakan\n` +
    `• \`/continue\` : Melanjutkan sesi percakapan discovery pada proyek aktif\n` +
    `• \`/review\` : Minta AI mengevaluasi kesiapan arsitektur produk\n` +
    `• \`/prd\` : Buka dokumen PRD terakhir atau generate versi baru\n` +
    `• \`/settings\` : Pengaturan model AI & preferensi sistem\n` +
    `• \`/help\` : Tampilkan pesan panduan ini\n\n` +
    `*3. Tips Interaksi:*\n` +
    `• AI akan mengajukan maksimal 1 pertanyaan terarah per pesan agar tidak membingungkan.\n` +
    `• Anda dapat berpindah antar fase kapan saja menggunakan tombol navigasi fase.`
  );
}

import { InlineKeyboard } from 'grammy';

export function getMainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('💡 Ide Baru', 'cmd_new_idea')
    .text('📥 Idea Inbox', 'cmd_list_ideas')
    .row()
    .text('🚀 Proyek Aktif', 'cmd_list_projects')
    .text('📄 Dokumen PRD', 'cmd_list_prds')
    .row()
    .text('⚙️ Pengaturan', 'cmd_settings')
    .text('❓ Bantuan', 'cmd_help');
}

export function getStartMessage(firstName: string = 'Founder'): string {
  return (
    `👋 Halo, *${firstName}*! Selamat datang di *Personal Product Assistant*.\n\n` +
    `Saya adalah asisten AI pribadi Anda untuk merancang produk: dari menangkap ide spontan, mematangkannya lewat tanya-jawab terarah, hingga menyusun PRD lengkap standar industri.\n\n` +
    `*Perintah Cepat:*\n` +
    `• /new — Catat ide produk atau fitur baru\n` +
    `• /ideas — Buka Idea Inbox & kelola ide\n` +
    `• /projects — Lihat & lanjutkan proyek produk\n` +
    `• /continue — Lanjutkan discovery proyek yang sedang berjalan\n` +
    `• /prd — Lihat, tinjau, dan ekspor PRD\n` +
    `• /review — Evaluasi kelengkapan PRD\n` +
    `• /settings — Konfigurasi provider AI & preferensi\n` +
    `• /help — Panduan lengkap penggunaan\n\n` +
    `_Pilih menu di bawah atau langsung ketik ide Anda!_`
  );
}

export function getHelpMessage(): string {
  return (
    `📖 *Panduan Penggunaan Personal Product Assistant*\n\n` +
    `*1. Siklus Kerja Produk:*\n` +
    `💡 *Ide Mentah* → 🔍 *Discovery Terarah* → 🧠 *Structured Memory* → 📑 *PRD Generator* → 📦 *Ekspor (.md & .pdf)*\n\n` +
    `*2. Perintah yang Tersedia:*\n` +
    `• \`/start\` : Tampilkan menu utama\n` +
    `• \`/new <judul | deskripsi>\` : Simpan ide baru secara langsung ke Inbox\n` +
    `• \`/ideas\` : Daftar semua ide mentah yang tersimpan\n` +
    `• \`/projects\` : Daftar proyek produk yang sedang dikerjakan\n` +
    `• \`/continue\` : Melanjutkan sesi percakapan discovery pada proyek aktif\n` +
    `• \`/prd\` : Buka dokumen PRD terakhir atau pilih versi\n` +
    `• \`/review\` : Minta AI mengevaluasi kelengkapan PRD\n` +
    `• \`/settings\` : Pengaturan model AI & konfigurasi sistem\n` +
    `• \`/help\` : Tampilkan pesan bantuan ini\n\n` +
    `*3. Tips Interaksi:*\n` +
    `• Anda dapat langsung mengirim ide teks panjang kapan saja.\n` +
    `• Saat sesi discovery, jawab pertanyaan AI satu demi satu untuk hasil keputusan yang terkonfirmasi.`
  );
}


import { Bot, InputFile, InlineKeyboard } from 'grammy';
import { AppContext, authMiddleware } from './middlewares/auth.middleware.js';
import { deduplicationMiddleware } from './middlewares/deduplication.middleware.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { IdeasService } from '../modules/ideas/ideas.service.js';
import { ProjectsService } from '../modules/projects/projects.service.js';
import { DiscoveryService } from '../modules/discovery/discovery.service.js';
import { PrdService } from '../modules/prd/prd.service.js';
import { ExportService } from '../modules/export/export.service.js';
import { MemoryService } from '../modules/memory/memory.service.js';
import { getStartMessage, getHelpMessage, getMainMenuKeyboard } from './views/keyboards.js';
import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../db/types.js';
import { logger } from '../config/logger.js';

export function createTelegramBot(
  token: string,
  supabase: SupabaseClient<Database>,
  authService: AuthService,
  ideasService: IdeasService,
  projectsService: ProjectsService,
  discoveryService: DiscoveryService,
  prdService: PrdService,
  exportService: ExportService,
  memoryService: MemoryService
) {
  const bot = new Bot<AppContext>(token);

  // 1. Deduplication middleware
  bot.use(deduplicationMiddleware(supabase));

  // 2. Auth guard middleware
  bot.use(authMiddleware(authService));

  // Helper untuk menampilkan daftar ide
  async function showIdeas(ctx: AppContext) {
    const user = ctx.dbUser!;
    const ideas = await ideasService.listIdeas(user.id);

    if (ideas.length === 0) {
      await ctx.reply(
        '📥 *Idea Inbox Anda masih kosong.*\n\nKetik ide Anda langsung di chat ini atau gunakan `/new <ide Anda>` untuk mencatat ide pertama!',
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('💡 Catat Ide Baru', 'cmd_new_idea').text('🔙 Menu Utama', 'cmd_menu'),
        }
      );
      return;
    }

    let text = `📥 *Idea Inbox (${ideas.length} ide tersimpan):*\n\n`;
    const keyboard = new InlineKeyboard();

    ideas.slice(0, 10).forEach((idea, idx) => {
      const statusIcon = idea.status === 'CONVERTED_TO_PROJECT' ? '🚀' : '💡';
      text += `${idx + 1}. ${statusIcon} *${idea.title}*\n   _Status: ${idea.status}_\n\n`;
      keyboard.text(`${statusIcon} #${idx + 1}`, `view_idea_${idea.id}`);
      if ((idx + 1) % 2 === 0) keyboard.row();
    });

    keyboard.row().text('💡 Tambah Ide Baru', 'cmd_new_idea').text('🔙 Menu Utama', 'cmd_menu');

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }

  // Helper untuk menampilkan daftar proyek
  async function showProjects(ctx: AppContext) {
    const user = ctx.dbUser!;
    const projects = await projectsService.listProjects(user.id);

    if (projects.length === 0) {
      await ctx.reply(
        '🚀 *Belum ada proyek produk aktif.*\n\nSilakan pilih salah satu ide di Idea Inbox lalu klik *Jadikan Proyek*, atau langsung ketik ide baru Anda.',
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('📥 Buka Idea Inbox', 'cmd_list_ideas').text('🔙 Menu Utama', 'cmd_menu'),
        }
      );
      return;
    }

    let text = `🚀 *Daftar Proyek Produk (${projects.length}):*\n\n`;
    const keyboard = new InlineKeyboard();

    projects.slice(0, 8).forEach((p, idx) => {
      text += `${idx + 1}. *${p.title}*\n   _Fase: ${p.status}_\n\n`;
      keyboard.text(`🚀 #${idx + 1} ${p.title.slice(0, 15)}...`, `select_project_${p.id}`);
      keyboard.row();
    });

    keyboard.text('🔙 Menu Utama', 'cmd_menu');

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }

  // Helper untuk pengaturan
  async function showSettings(ctx: AppContext) {
    const user = ctx.dbUser!;
    // Ambil preferensi user jika ada
    const { data: setting } = await (supabase as any)
      .from('app_settings')
      .select('setting_value')
      .eq('user_id', user.id)
      .eq('setting_key', 'ai_provider')
      .maybeSingle();

    const currentProvider = setting?.setting_value?.provider || 'Google Gemini (gemini-3.8-flash)';

    const keyboard = new InlineKeyboard()
      .text('✨ Gemini 3.8 Flash', 'set_provider_gemini')
      .text('🧠 OpenAI GPT-4o Mini', 'set_provider_openai')
      .row()
      .text('🔙 Menu Utama', 'cmd_menu');

    await ctx.reply(
      `⚙️ *Pengaturan Asisten Produk*\n\n` +
      `*Engine AI Aktif:* \`${currentProvider}\`\n\n` +
      `Pilih engine model yang ingin Anda gunakan untuk analisa discovery dan penulisan PRD:`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  }

  // -------------------------------------------------------------
  // Command: /start
  // -------------------------------------------------------------
  bot.command('start', async (ctx) => {
    const name = ctx.from?.first_name || 'Founder';
    await ctx.reply(getStartMessage(name), {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard(),
    });
  });

  // -------------------------------------------------------------
  // Command: /help
  // -------------------------------------------------------------
  bot.command('help', async (ctx) => {
    await ctx.reply(getHelpMessage(), {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('🔙 Kembali ke Menu', 'cmd_menu'),
    });
  });

  // -------------------------------------------------------------
  // Command: /new <text>
  // -------------------------------------------------------------
  bot.command('new', async (ctx) => {
    const user = ctx.dbUser!;
    const rawText = ctx.match?.trim();

    if (!rawText) {
      await ctx.reply(
        '💡 *Tuliskan Ide Anda*\n\nKirimkan ide Anda dengan format:\n`/new <Judul Ide> - <Deskripsi ide>`\n\nAtau cukup ketik ide mentah Anda langsung ke chat ini.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const title = rawText.split('\n')[0].slice(0, 80);
    const idea = await ideasService.createIdea({
      userId: user.id,
      title,
      rawContent: rawText,
    });

    const keyboard = new InlineKeyboard()
      .text('🚀 Jadikan Proyek Sekarang', `convert_idea_${idea.id}`)
      .row()
      .text('📥 Buka Idea Inbox', 'cmd_list_ideas')
      .text('🔙 Menu Utama', 'cmd_menu');

    await ctx.reply(
      `✅ *Ide Berhasil Disimpan ke Inbox!*\n\n*Judul:* ${idea.title}\n*Status:* 📥 Inbox\n\nIngin langsung mengembangkan ide ini menjadi konsep produk & PRD?`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  });

  // -------------------------------------------------------------
  // Command: /ideas
  // -------------------------------------------------------------
  bot.command('ideas', async (ctx) => {
    await showIdeas(ctx);
  });

  // -------------------------------------------------------------
  // Command: /projects
  // -------------------------------------------------------------
  bot.command('projects', async (ctx) => {
    await showProjects(ctx);
  });

  // -------------------------------------------------------------
  // Command: /continue
  // -------------------------------------------------------------
  bot.command('continue', async (ctx) => {
    const user = ctx.dbUser!;
    const project = await projectsService.getActiveProject(user.id);

    if (!project) {
      await ctx.reply(
        '⚠️ Tidak ada proyek aktif yang sedang dalam tahap discovery.\n\nKetik `/projects` atau buka menu untuk memilih proyek yang ingin dilanjutkan.',
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('🚀 Daftar Proyek', 'cmd_list_projects').text('🔙 Menu Utama', 'cmd_menu'),
        }
      );
      return;
    }

    const decisions = await memoryService.getDecisionsByProject(project.id);
    const confirmedCount = decisions.filter((d) => d.status === 'CONFIRMED').length;

    const keyboard = new InlineKeyboard()
      .text('📑 Buat PRD (.md)', `generate_prd_${project.id}`)
      .row()
      .text('🔍 Review Keputusan', `review_project_${project.id}`)
      .text('🔙 Menu Utama', 'cmd_menu');

    await ctx.reply(
      `💬 *Melanjutkan Discovery: ${project.title}*\n\n` +
      `*Status Proyek:* \`${project.status}\`\n` +
      `*Keputusan Terkumpul:* ${confirmedCount} poin\n\n` +
      `Ketik pesan apa saja langsung di chat ini untuk melanjutkan diskusi dengan AI Product Manager, atau tekan tombol di bawah jika siap membuat PRD.`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  });

  // -------------------------------------------------------------
  // Command: /prd
  // -------------------------------------------------------------
  bot.command('prd', async (ctx) => {
    const user = ctx.dbUser!;
    const project = await projectsService.getActiveProject(user.id);

    if (!project) {
      await ctx.reply('⚠️ Pilih proyek terlebih dahulu melalui `/projects`.', {
        reply_markup: new InlineKeyboard().text('🚀 Buka Daftar Proyek', 'cmd_list_projects'),
      });
      return;
    }

    const prdData = await prdService.getLatestPRD(project.id);
    if (!prdData || !prdData.version) {
      const keyboard = new InlineKeyboard()
        .text('📑 Generate PRD Sekarang', `generate_prd_${project.id}`)
        .row()
        .text('🔙 Menu', 'cmd_menu');

      await ctx.reply(`📄 Belum ada PRD untuk proyek *${project.title}*. Klik tombol di bawah untuk menyusunnya.`, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    const version = prdData.version;
    const keyboard = new InlineKeyboard()
      .text('📥 Unduh Dokumen (.md)', `export_md_${version.id}`)
      .row()
      .text('🔄 Revisi / Generate Ulang', `generate_prd_${project.id}`)
      .text('🔙 Menu Utama', 'cmd_menu');

    await ctx.reply(
      `📄 *Dokumen PRD Terakhir:*\n` +
      `*Proyek:* ${project.title}\n` +
      `*Versi:* v${version.version_number}.0\n` +
      `*Changelog:* ${version.changelog_summary || 'Rilis awal'}\n\n` +
      `Klik tombol di bawah untuk mengunduh dokumen Markdown (.md):`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  });

  // -------------------------------------------------------------
  // Command: /review
  // -------------------------------------------------------------
  bot.command('review', async (ctx) => {
    const user = ctx.dbUser!;
    const project = await projectsService.getActiveProject(user.id);

    if (!project) {
      await ctx.reply('⚠️ Tidak ada proyek aktif untuk direview. Pilih proyek melalui `/projects`.');
      return;
    }

    const decisions = await memoryService.getDecisionsByProject(project.id);
    const confirmed = decisions.filter((d) => d.status === 'CONFIRMED');
    const unknown = decisions.filter((d) => d.status === 'UNKNOWN');
    const suggested = decisions.filter((d) => d.status === 'SUGGESTED');

    let reviewText = `🔍 *Evaluasi Kematangan Produk: ${project.title}*\n\n`;
    if (confirmed.length > 0) {
      reviewText += `✅ *Keputusan Terkonfirmasi (${confirmed.length}):*\n`;
      confirmed.slice(0, 6).forEach((c) => (reviewText += `• [${c.category}] ${c.statement}\n`));
    } else {
      reviewText += `_Belum ada keputusan yang terkonfirmasi._\n`;
    }

    if (unknown.length > 0) {
      reviewText += `\n❓ *Informasi Belum Lengkap (${unknown.length}):*\n`;
      unknown.slice(0, 4).forEach((u) => (reviewText += `• ${u.statement}\n`));
    }

    if (suggested.length > 0) {
      reviewText += `\n💡 *Rekomendasi AI Menunggu Persetujuan (${suggested.length}):*\n`;
      suggested.slice(0, 4).forEach((s) => (reviewText += `• ${s.statement}\n`));
    }

    const keyboard = new InlineKeyboard()
      .text('💬 Lanjutkan Tanya Jawab', `select_project_${project.id}`)
      .text('📑 Buat PRD (.md)', `generate_prd_${project.id}`)
      .row()
      .text('🔙 Menu Utama', 'cmd_menu');

    await ctx.reply(reviewText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  // -------------------------------------------------------------
  // Command: /settings
  // -------------------------------------------------------------
  bot.command('settings', async (ctx) => {
    await showSettings(ctx);
  });

  // -------------------------------------------------------------
  // Inline Keyboard Callbacks Handler
  // -------------------------------------------------------------
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const user = ctx.dbUser!;

    await ctx.answerCallbackQuery().catch(() => {});

    // Navigasi Menu
    if (data === 'cmd_menu') {
      await ctx.reply(getStartMessage(ctx.from?.first_name || 'Founder'), {
        parse_mode: 'Markdown',
        reply_markup: getMainMenuKeyboard(),
      });
      return;
    }

    if (data === 'cmd_help') {
      await ctx.reply(getHelpMessage(), {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('🔙 Menu Utama', 'cmd_menu'),
      });
      return;
    }

    if (data === 'cmd_settings') {
      await showSettings(ctx);
      return;
    }

    if (data === 'cmd_list_ideas') {
      await showIdeas(ctx);
      return;
    }

    if (data === 'cmd_list_projects') {
      await showProjects(ctx);
      return;
    }

    if (data === 'cmd_list_prds') {
      const project = await projectsService.getActiveProject(user.id);
      if (!project) {
        await ctx.reply('⚠️ Belum ada proyek aktif. Silakan pilih dari daftar proyek:', {
          reply_markup: new InlineKeyboard().text('🚀 Daftar Proyek', 'cmd_list_projects'),
        });
        return;
      }
      const prdData = await prdService.getLatestPRD(project.id);
      if (!prdData || !prdData.version) {
        await ctx.reply(
          `📄 Belum ada PRD untuk proyek *${project.title}*.\n\nIngin generate PRD sekarang?`,
          {
            parse_mode: 'Markdown',
            reply_markup: new InlineKeyboard()
              .text('📑 Generate PRD (.md)', `generate_prd_${project.id}`)
              .row()
              .text('🔙 Menu Utama', 'cmd_menu'),
          }
        );
        return;
      }
      const version = prdData.version;
      await ctx.reply(
        `📄 *Dokumen PRD Proyek:* ${project.title}\n` +
        `*Versi Terakhir:* v${version.version_number}.0\n` +
        `*Changelog:* ${version.changelog_summary || 'Rilis awal'}\n\n` +
        `Klik tombol di bawah untuk langsung mengunduh file Markdown (.md):`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text('📥 Unduh File Markdown (.md)', `export_md_${version.id}`)
            .row()
            .text('🔄 Generate / Revisi PRD', `generate_prd_${project.id}`)
            .text('🔙 Menu', 'cmd_menu'),
        }
      );
      return;
    }

    if (data === 'cmd_new_idea') {
      await ctx.reply(
        '💡 *Catat Ide Baru*\n\nSilakan ketikkan ide produk atau aplikasi Anda langsung di chat ini (atau gunakan `/new <deskripsi ide>`).',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Ubah Pengaturan Provider AI
    if (data === 'set_provider_gemini' || data === 'set_provider_openai') {
      const chosen = data === 'set_provider_gemini' ? 'gemini' : 'openai';
      const label = chosen === 'gemini' ? 'Google Gemini 3.8 Flash' : 'OpenAI GPT-4o Mini';

      await (supabase as any).from('app_settings').upsert({
        user_id: user.id,
        setting_key: 'ai_provider',
        setting_value: { provider: label, key: chosen },
        updated_at: new Date().toISOString(),
      });

      await ctx.reply(
        `✅ *Pengaturan Berhasil Disimpan!*\n\nModel AI yang aktif sekarang: *${label}*`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('🔙 Kembali ke Menu', 'cmd_menu'),
        }
      );
      return;
    }

    // Detail Ide
    if (data.startsWith('view_idea_')) {
      const ideaId = data.replace('view_idea_', '');
      const idea = await ideasService.getIdeaById(ideaId, user.id);
      if (!idea) {
        await ctx.reply('Ide tidak ditemukan.');
        return;
      }
      const kb = new InlineKeyboard();
      if (idea.status !== 'CONVERTED_TO_PROJECT') {
        kb.text('🚀 Jadikan Proyek', `convert_idea_${idea.id}`).row();
      }
      kb.text('📥 Kembali ke Inbox', 'cmd_list_ideas').text('🔙 Menu', 'cmd_menu');

      await ctx.reply(
        `💡 *Detail Ide: ${idea.title}*\n\n` +
        `*Isi Ide:*\n${idea.raw_content}\n\n` +
        `*Status:* \`${idea.status}\`\n` +
        `*Dicatat pada:* ${new Date(idea.created_at).toLocaleDateString('id-ID')}`,
        { parse_mode: 'Markdown', reply_markup: kb }
      );
      return;
    }

    // Konversi Ide ke Proyek
    if (data.startsWith('convert_idea_')) {
      const ideaId = data.replace('convert_idea_', '');
      const idea = await ideasService.getIdeaById(ideaId, user.id);
      if (!idea) {
        await ctx.reply('Ide tidak ditemukan.');
        return;
      }

      const { project, isExisting } = await projectsService.createProject({
        userId: user.id,
        ideaId: idea.id,
        title: idea.title,
        summary: idea.raw_content,
      });

      const kb = new InlineKeyboard()
        .text('💬 Buka Sesi Discovery', `select_project_${project.id}`)
        .row()
        .text('🔙 Menu Utama', 'cmd_menu');

      if (isExisting) {
        await ctx.reply(
          `ℹ️ *Proyek dengan nama "${project.title}" sudah pernah dibuat sebelumnya.*\n\nSistem otomatis mengarahkan Anda ke proyek yang sudah ada untuk menghindari duplikasi.`,
          { parse_mode: 'Markdown', reply_markup: kb }
        );
      } else {
        await ctx.reply(
          `🚀 *Proyek Berhasil Dibuat: ${project.title}*\n\nSesi discovery terstruktur telah dibuka. Mari matangkan konsep produknya!`,
          { parse_mode: 'Markdown', reply_markup: kb }
        );
      }
      return;
    }

    // Pilih Proyek Aktif
    if (data.startsWith('select_project_')) {
      const projectId = data.replace('select_project_', '');
      const project = await projectsService.getProjectById(projectId, user.id);
      if (!project) {
        await ctx.reply('Proyek tidak ditemukan.');
        return;
      }

      await ctx.reply(
        `🎯 *Proyek Aktif: ${project.title}*\n\nKetik pesan Anda sekarang untuk berdiskusi dengan AI Product Manager.`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text('📑 Buat PRD (.md)', `generate_prd_${project.id}`)
            .text('🔍 Review', `review_project_${project.id}`)
            .row()
            .text('🔙 Menu Utama', 'cmd_menu'),
        }
      );
      return;
    }

    // Review Proyek Tertentu
    if (data.startsWith('review_project_')) {
      const projectId = data.replace('review_project_', '');
      const decisions = await memoryService.getDecisionsByProject(projectId);
      const confirmed = decisions.filter((d) => d.status === 'CONFIRMED');

      let text = `🔍 *Review Keputusan Proyek*\n\n`;
      if (confirmed.length > 0) {
        text += `✅ *Keputusan Terkonfirmasi (${confirmed.length}):*\n`;
        confirmed.slice(0, 6).forEach((c) => (text += `• ${c.statement}\n`));
      } else {
        text += `_Belum ada keputusan yang terkonfirmasi. Silakan berdiskusi di chat._\n`;
      }

      await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('📑 Buat PRD (.md)', `generate_prd_${projectId}`)
          .text('🔙 Menu', 'cmd_menu'),
      });
      return;
    }

    // Generate PRD
    if (data.startsWith('generate_prd_')) {
      const projectId = data.replace('generate_prd_', '');
      const statusMsg = await ctx.reply('⏳ *Sedang menyusun PRD 16 seksi standar industri...* Mohon tunggu beberapa detik.', {
        parse_mode: 'Markdown',
      });

      try {
        const prd = await prdService.generateOrRevisePRD(projectId);
        const prdData = await prdService.getLatestPRD(projectId);
        const versionId = prdData?.version?.id;

        const kb = new InlineKeyboard();
        if (versionId) {
          kb.text('📥 Unduh File PRD (.md)', `export_md_${versionId}`).row();
        }
        kb.text('🔙 Menu Utama', 'cmd_menu');

        await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
        await ctx.reply(
          `✅ *PRD v${prd.versionNumber}.0 Berhasil Dibuat!*\n\n*Ringkasan Perubahan:* ${prd.changelogSummary}\n\nSilakan unduh dokumen Markdown (.md) Anda di bawah:`,
          { parse_mode: 'Markdown', reply_markup: kb }
        );
      } catch (err: any) {
        logger.error({ err, projectId }, 'Failed to generate PRD');
        await ctx.reply(`❌ Terjadi kendala saat menyusun PRD: ${err.message}`);
      }
      return;
    }

    // Export Markdown (.md)
    if (data.startsWith('export_md_')) {
      const versionId = data.replace('export_md_', '');
      const { data: version } = await (supabase as any)
        .from('prd_versions')
        .select('*')
        .eq('id', versionId)
        .single();

      if (!version) {
        await ctx.reply('Versi PRD tidak ditemukan.');
        return;
      }

      const res = await exportService.exportToMarkdown(
        version.id,
        version.title,
        version.content_markdown
      );

      await ctx.replyWithDocument(new InputFile(res.filePath, res.fileName), {
        caption: `📄 Dokumen PRD: *${version.title}*\nFormat: Markdown (.md)`,
        parse_mode: 'Markdown',
      });
      return;
    }
  });

  // -------------------------------------------------------------
  // Default Message Handler (Chat / Discovery / Idea Capture)
  // -------------------------------------------------------------
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return; // handled by commands

    const user = ctx.dbUser!;
    const project = await projectsService.getActiveProject(user.id);

    // If user has an active project in discovery, route to Discovery Service
    if (project && project.active_session_id) {
      if (project.is_locked) {
        await ctx.reply('⏳ AI sedang memproses respons sebelumnya. Mohon tunggu sejenak...');
        return;
      }

      await projectsService.setProjectLock(project.id, true);
      await ctx.replyWithChatAction('typing');

      try {
        const reply = await discoveryService.processUserMessage(
          project.id,
          project.active_session_id,
          text
        );

        const kb = new InlineKeyboard();
        if (reply.isReadyForPRD) {
          kb.text('📑 Buat Dokumen PRD (.md)', `generate_prd_${project.id}`).row();
        }
        kb.text('🔍 Review Status', 'cmd_review').text('🔙 Menu Utama', 'cmd_menu');

        await ctx.reply(reply.assistantResponse, {
          parse_mode: 'Markdown',
          reply_markup: kb,
        });
      } catch (err: any) {
        logger.error({ err, projectId: project.id }, 'Error during discovery conversation');
        await ctx.reply(`⚠️ Terjadi kendala saat memproses percakapan: ${err.message}`);
      } finally {
        await projectsService.setProjectLock(project.id, false);
      }
      return;
    }

    // Otherwise, capture as a raw spontaneous idea in Idea Inbox
    const title = text.split('\n')[0].slice(0, 80);
    const idea = await ideasService.createIdea({
      userId: user.id,
      title,
      rawContent: text,
    });

    const kb = new InlineKeyboard()
      .text('🚀 Jadikan Proyek', `convert_idea_${idea.id}`)
      .row()
      .text('📥 Buka Idea Inbox', 'cmd_list_ideas');

    await ctx.reply(
      `💡 *Ide Baru Tercatat di Inbox!*\n\n*Judul:* ${idea.title}\n\nIngin mulai mendiskusikan & membuat PRD untuk ide ini?`,
      {
        parse_mode: 'Markdown',
        reply_markup: kb,
      }
    );
  });

  return bot;
}

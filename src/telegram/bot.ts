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
import { QualityValidatorService } from '../modules/discovery/quality-validator.service.js';
import { getPhaseMetadata } from '../modules/discovery/phases.config.js';
import {
  getStartMessage,
  getHelpMessage,
  getMainMenuKeyboard,
  getDiscoveryPhaseKeyboard,
  getInteractiveQuestionKeyboard,
  PHASE_NUM_TO_KEY,
} from './views/keyboards.js';
import { SupabaseClient } from '@supabase/supabase-js';
import { Database, DiscoveryPhase } from '../db/types.js';
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
  memoryService: MemoryService,
  validatorService: QualityValidatorService
) {
  const bot = new Bot<AppContext>(token);
  const pendingNewIdeaUsers = new Set<string>();

  // 1. Deduplication middleware
  bot.use(deduplicationMiddleware(supabase));

  // 2. Auth guard middleware
  bot.use(authMiddleware(authService));

  // Helper aman untuk mengirim pesan Markdown Telegram (fallback ke plain text jika ada karakter Markdown rusak atau kepanjangan)
  async function safeReplyMarkdown(ctx: AppContext, text: string, replyMarkup?: InlineKeyboard) {
    const safeText = text.length > 3950 ? `${text.slice(0, 3900)}\n\n_(Sebagian teks dipotong karena batas panjang pesan Telegram)_` : text;
    try {
      await ctx.reply(safeText, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup,
      });
    } catch (mdErr: any) {
      logger.warn({ err: mdErr?.message }, 'Markdown reply failed, falling back to plain text');
      await ctx.reply(safeText.replace(/[*_`]/g, ''), {
        reply_markup: replyMarkup,
      });
    }
  }

  // Helper untuk menampilkan Panel Kontrol Fase 8 (Generate & Kelola PRD)
  async function showPhase8Panel(ctx: AppContext, project: any) {
    const existingPrd = await prdService.getLatestPRD(project.id);
    const kb = getDiscoveryPhaseKeyboard(project.id, 'PHASE_8_PRD_READY', false, true);
    kb.row().text('📑 Kelola PRD Proyek', `list_project_prds_${project.id}`);

    const statusLine = existingPrd?.version
      ? `Dokumen PRD v${existingPrd.version.version_number} sudah tersedia. Anda bisa mengunduh/melihat PRD, membuat revisi baru, atau melakukan audit ulang.`
      : `Seluruh fondasi discovery telah terkumpul! Klik tombol *📑 Generate PRD (29 Seksi)* di bawah untuk menyusun dokumen PRD lengkap yang tersimpan ke database dan bisa diunduh dalam format Markdown / PDF.`;

    await safeReplyMarkdown(
      ctx,
      `🎯 *Proyek Aktif: ${project.title}*\n📍 *[Fase 8/8: PRD Ready]*\n\n${statusLine}`,
      kb
    );
  }

  // Helper untuk mengeksekusi giliran interaktif discovery
  async function triggerDiscoveryTurn(ctx: AppContext, project: any, text: string) {
    if (project.is_locked) {
      await ctx.reply('⏳ AI sedang memproses respons arsitektur sebelumnya. Mohon tunggu sejenak...');
      return;
    }

    const startTime = Date.now();
    await projectsService.setProjectLock(project.id, true);
    await ctx.replyWithChatAction('typing');

    try {
      const reply = await discoveryService.processUserMessage(
        project.id,
        project.active_session_id,
        text
      );

      const elapsedMs = Date.now() - startTime;
      logger.info({ projectId: project.id, elapsedMs, phase: reply.phase }, 'Discovery turn latency measured');

      const phaseMeta = getPhaseMetadata(reply.phase);
      const header = `📍 *[Fase ${reply.phaseNumber}/8: ${phaseMeta.shortName}]*\n\n`;

      if (
        reply.phase !== 'PHASE_8_PRD_READY' &&
        reply.question &&
        reply.question.options &&
        reply.question.options.length > 0
      ) {
        const qText = `${header}${reply.assistantResponse}\n\n*Pertanyaan Panduan:*\n❓ *${reply.question.question}*` +
          (reply.question.multiSelect ? '\n_(Pilih satu atau lebih opsi di bawah, lalu klik Konfirmasi)_' : '');
        const qKb = getInteractiveQuestionKeyboard(
          project.id,
          reply.question,
          reply.phase,
          reply.canAdvanceToNextPhase
        );

        await safeReplyMarkdown(ctx, qText, qKb);
      } else {
        const kb = getDiscoveryPhaseKeyboard(
          project.id,
          reply.phase,
          reply.canAdvanceToNextPhase,
          reply.isReadyForValidation || reply.phase === 'PHASE_8_PRD_READY'
        );
        kb.row().text('📑 Kelola PRD Proyek', `list_project_prds_${project.id}`);

        await safeReplyMarkdown(ctx, header + reply.assistantResponse, kb);
      }
    } catch (err: any) {
      logger.error({ err, projectId: project.id }, 'Error during discovery conversation');
      await ctx.reply(`⚠️ Terjadi kendala saat memproses percakapan: ${err.message}`);
    } finally {
      await projectsService.setProjectLock(project.id, false);
    }
  }

  // Helper untuk menampilkan daftar ide
  async function showIdeas(ctx: AppContext) {
    const user = ctx.dbUser!;
    const [ideas, projects] = await Promise.all([
      ideasService.listIdeas(user.id),
      projectsService.listProjects(user.id),
    ]);

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

    const projectByIdeaId = new Map<string, any>();
    const projectByTitle = new Map<string, any>();
    for (const p of projects) {
      if (p.idea_id) projectByIdeaId.set(p.idea_id, p);
      projectByTitle.set(p.title.trim().toLowerCase(), p);
    }

    let text = `📥 *Idea Inbox (${ideas.length} ide tersimpan):*\n\n`;
    const keyboard = new InlineKeyboard();

    for (let idx = 0; idx < Math.min(ideas.length, 10); idx++) {
      const idea = ideas[idx];
      const linkedProject =
        projectByIdeaId.get(idea.id) || projectByTitle.get(idea.title.trim().toLowerCase());

      // Self-heal status jika proyek terkait sudah dihapus
      if (!linkedProject && idea.status === 'CONVERTED_TO_PROJECT') {
        await ideasService.updateIdeaStatus(idea.id, user.id, 'INBOX').catch(() => {});
        idea.status = 'INBOX';
      }

      const isProject = Boolean(linkedProject);
      const statusIcon = isProject ? '🚀' : '💡';
      const statusLabel = isProject ? 'Sudah jadi proyek' : 'Belum jadi proyek';

      text += `${idx + 1}. ${statusIcon} *${idea.title}*\n   _Status: ${statusLabel}_\n\n`;
      const shortTitle = idea.title.length > 24 ? `${idea.title.slice(0, 24)}...` : idea.title;
      keyboard.text(`${statusIcon} #${idx + 1} ${shortTitle}`, `view_idea_${idea.id}`).row();
    }

    keyboard.text('💡 Tambah Ide Baru', 'cmd_new_idea').text('🔙 Menu Utama', 'cmd_menu');

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
      const phaseMeta = getPhaseMetadata((p as any).current_phase || 'PHASE_1_IDEA');
      text += `${idx + 1}. *${p.title}*\n   _Fase: [${phaseMeta.number}/8] ${phaseMeta.shortName}_\n\n`;
      keyboard.text(`🚀 #${idx + 1} ${p.title.slice(0, 12)}...`, `select_project_${p.id}`);
      keyboard.text(`🗑️`, `confirm_del_proj_${p.id}`);
      keyboard.row();
    });

    keyboard.text('🔙 Menu Utama', 'cmd_menu');

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }

  // Helper untuk menampilkan daftar PRD dokumen suatu proyek
  async function showProjectPrds(ctx: AppContext, projectId: string) {
    const user = ctx.dbUser!;
    const project = await projectsService.getProjectById(projectId, user.id);
    if (!project) {
      await ctx.reply('⚠️ Proyek tidak ditemukan.');
      return;
    }

    const versions = await prdService.listVersions(projectId);
    if (versions.length === 0) {
      await ctx.reply(
        `📄 *Dokumen PRD: ${project.title}*\n\nBelum ada versi PRD yang dibuat untuk proyek ini.`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text('📑 Generate PRD Sekarang', `generate_prd_${projectId}`)
            .row()
            .text('🔙 Kembali ke Proyek', `select_project_${projectId}`),
        }
      );
      return;
    }

    let text = `📑 *Daftar Versi PRD Proyek:* *${project.title}* (${versions.length} versi)\n\n`;
    const keyboard = new InlineKeyboard();

    versions.forEach((v, idx) => {
      text += `${idx + 1}. *v${v.version_number}.0* — ${v.title}\n   _Changelog: ${v.changelog_summary || 'Rilis versi'}_\n\n`;
      keyboard.text(`📥 Unduh v${v.version_number}`, `export_md_${v.id}`);
      keyboard.text(`🗑️ Hapus v${v.version_number}`, `confirm_del_prdv_${v.id}`);
      keyboard.row();
    });

    keyboard.text('🔄 Generate Versi Baru', `generate_prd_${projectId}`).row();
    keyboard.text('🔙 Detail Proyek', `select_project_${projectId}`).text('🔙 Menu Utama', 'cmd_menu');

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }

  // Helper untuk pengaturan
  async function showSettings(ctx: AppContext) {
    const user = ctx.dbUser!;
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
      `⚙️ *Pengaturan AI Product Architect*\n\n` +
      `*Engine AI Aktif:* \`${currentProvider}\`\n\n` +
      `Pilih engine model yang ingin Anda gunakan untuk discovery terarah dan penulisan PRD:`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  }

  // Helper untuk validasi kesiapan
  async function runValidation(ctx: AppContext, projectId: string) {
    const statusMsg = await ctx.reply('🔍 *Menjalankan Pre-Flight Quality Check (10 Dimensi)...* Mohon tunggu sebentar.', {
      parse_mode: 'Markdown',
    });

    try {
      const report = await validatorService.validateProjectReadiness(projectId);
      await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});

      const scoreEmoji = report.overallScore >= 80 ? '🟢' : report.overallScore >= 60 ? '🟡' : '🔴';
      let reportText = `${scoreEmoji} *Audit Kesiapan PRD: Skor ${report.overallScore}/100*\n\n`;
      reportText += `*Status:* ${report.isReadyForGeneration ? '✅ Siap Generate PRD Final' : '⚠️ Perlu Pelengkap Sebelum Final'}\n\n`;
      reportText += `${report.summaryMessage}\n\n`;

      if (report.unresolvedGaps && report.unresolvedGaps.length > 0) {
        reportText += `*Celah yang Masih Terbuka:*\n`;
        report.unresolvedGaps.forEach((g) => (reportText += `• ${g}\n`));
        reportText += `\n`;
      }

      const kb = new InlineKeyboard();
      if (report.isReadyForGeneration || report.overallScore >= 65) {
        kb.text('📑 Generate PRD Final (29 Seksi)', `generate_prd_${projectId}`).row();
      }
      kb.text('💬 Lanjutkan Tanya-Jawab', `select_project_${projectId}`)
        .text('🔙 Menu Utama', 'cmd_menu');

      await ctx.reply(reportText, {
        parse_mode: 'Markdown',
        reply_markup: kb,
      });
    } catch (err: any) {
      logger.error({ err, projectId }, 'Validation execution error');
      await ctx.reply(`❌ Kendala saat menjalankan audit: ${err.message}`);
    }
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
      `✅ *Ide Berhasil Disimpan ke Inbox!*\n\n*Judul:* ${idea.title}\n*Status:* 📥 Inbox\n\nIngin langsung mengembangkan ide ini menjadi arsitektur produk & PRD?`,
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

    const currentPhase = (project as any).current_phase || 'PHASE_1_IDEA';
    if (currentPhase === 'PHASE_8_PRD_READY') {
      await showPhase8Panel(ctx, project);
      return;
    }
    const phaseMeta = getPhaseMetadata(currentPhase);
    const activeQuestion = (project as any).phase_data?.activeQuestion;

    if (activeQuestion && activeQuestion.options && activeQuestion.options.length > 0) {
      const header = `🎯 *Proyek: ${project.title}*\n📍 *[Fase ${phaseMeta.number}/8: ${phaseMeta.shortName}]*\n\n`;
      const qText = `${header}*Pertanyaan Panduan:*\n❓ *${activeQuestion.question}*` +
        (activeQuestion.multiSelect ? '\n_(Pilih satu atau lebih opsi di bawah, lalu klik Konfirmasi)_' : '');
      const qKb = getInteractiveQuestionKeyboard(project.id, activeQuestion, currentPhase, true);

      await ctx.reply(qText, {
        parse_mode: 'Markdown',
        reply_markup: qKb,
      });
      return;
    }

    await ctx.reply(`🎯 *Melanjutkan Sesi: ${project.title}*...`, { parse_mode: 'Markdown' });
    await triggerDiscoveryTurn(
      ctx,
      project,
      `Halo, mari lanjutkan pembahasan pada Fase ${phaseMeta.number}: ${phaseMeta.title}. Mohon ajukan pertanyaan panduan interaktif beserta pilihannya.`
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

    await runValidation(ctx, project.id);
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

    await showProjectPrds(ctx, project.id);
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

    // Reset mode input ide baru jika user menekan tombol lain
    if (data !== 'cmd_new_idea') {
      pendingNewIdeaUsers.delete(user.id);
    }

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

    if (data === 'cmd_new_idea') {
      pendingNewIdeaUsers.add(user.id);
      await ctx.reply(
        '💡 *Catat Ide Baru*\n\nSilakan ketikkan ide produk atau aplikasi Anda langsung di chat ini (atau gunakan `/new <deskripsi ide>`).',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (data === 'cmd_list_prds') {
      let project = await projectsService.getActiveProject(user.id);
      if (!project) {
        const allProjects = await projectsService.listProjects(user.id);
        project = allProjects[0] || null;
      }
      if (!project) {
        await ctx.reply('⚠️ Belum ada proyek aktif. Silakan pilih dari daftar proyek atau jadikan ide di Inbox menjadi proyek:', {
          reply_markup: new InlineKeyboard()
            .text('🚀 Daftar Proyek', 'cmd_list_projects')
            .text('📥 Idea Inbox', 'cmd_list_ideas'),
        });
        return;
      }
      await showProjectPrds(ctx, project.id);
      return;
    }

    if (data.startsWith('list_project_prds_')) {
      const projectId = data.replace('list_project_prds_', '');
      await showProjectPrds(ctx, projectId);
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

      // Cek apakah ide ini benar-benar memiliki proyek yang masih ada di database
      let linkedProject = await projectsService.findProjectByIdeaId(user.id, idea.id);
      if (!linkedProject) {
        linkedProject = await projectsService.findProjectByTitle(user.id, idea.title);
      }

      // Self-heal status jika proyek terkait sebelumnya sudah dihapus
      if (!linkedProject && idea.status === 'CONVERTED_TO_PROJECT') {
        await ideasService.updateIdeaStatus(idea.id, user.id, 'INBOX').catch(() => {});
        idea.status = 'INBOX';
      }

      const kb = new InlineKeyboard();
      let statusLabel = 'Tersimpan di Inbox (Belum jadi proyek)';

      if (linkedProject) {
        const phaseMeta = getPhaseMetadata((linkedProject as any).current_phase || 'PHASE_1_IDEA');
        statusLabel = `Sudah Menjadi Proyek (Fase ${phaseMeta.number}/8: ${phaseMeta.shortName})`;
        kb.text('🚀 Buka Proyek Aktif', `select_project_${linkedProject.id}`).row();
      } else {
        kb.text('🚀 Jadikan Proyek Aktif', `convert_idea_${idea.id}`).row();
      }
      kb.text('🗑️ Hapus Ide Ini', `confirm_del_idea_${idea.id}`).row();
      kb.text('📥 Kembali ke Inbox', 'cmd_list_ideas').text('🔙 Menu', 'cmd_menu');

      await ctx.reply(
        `💡 *Detail Ide: ${idea.title}*\n\n` +
        `*Isi Ide:*\n${idea.raw_content}\n\n` +
        `*Status:* ${statusLabel}\n` +
        `*Dicatat pada:* ${new Date(idea.created_at).toLocaleDateString('id-ID')}`,
        { parse_mode: 'Markdown', reply_markup: kb }
      );
      return;
    }

    // Konfirmasi Hapus Ide
    if (data.startsWith('confirm_del_idea_')) {
      const ideaId = data.replace('confirm_del_idea_', '');
      const idea = await ideasService.getIdeaById(ideaId, user.id);
      if (!idea) {
        await ctx.reply('Ide tidak ditemukan atau sudah dihapus.');
        return;
      }

      const kb = new InlineKeyboard()
        .text('⚠️ Ya, Hapus Ide', `exec_del_idea_${idea.id}`)
        .text('❌ Batal', `view_idea_${idea.id}`);

      await ctx.reply(
        `⚠️ *Konfirmasi Penghapusan Ide*\n\n` +
        `*Nama Ide:* ${idea.title}\n` +
        `*Status:* \`${idea.status}\`\n\n` +
        `*Dampak:* Ide ini akan dihapus permanen dari Inbox Anda. Jika ide sudah pernah dijadikan proyek, data proyek tetap aman.\n\n` +
        `Apakah Anda yakin ingin menghapus ide ini?`,
        { parse_mode: 'Markdown', reply_markup: kb }
      );
      return;
    }

    // Eksekusi Hapus Ide
    if (data.startsWith('exec_del_idea_')) {
      const ideaId = data.replace('exec_del_idea_', '');
      try {
        const res = await ideasService.deleteIdea(ideaId, user.id);
        await ctx.reply(`🗑️ *Ide "${res.ideaTitle}" berhasil dihapus secara permanen.*`, {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('📥 Kembali ke Inbox', 'cmd_list_ideas').text('🔙 Menu Utama', 'cmd_menu'),
        });
      } catch (err: any) {
        logger.error({ err, ideaId }, 'Failed to execute idea deletion');
        await ctx.reply(`❌ Gagal menghapus ide: ${err.message}`);
      }
      return;
    }

    // Konversi Ide ke Proyek Aktif
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

      if (isExisting) {
        const kb = new InlineKeyboard()
          .text('💬 Buka Sesi Discovery', `select_project_${project.id}`)
          .row()
          .text('🔙 Menu Utama', 'cmd_menu');

        await ctx.reply(
          `ℹ️ *Proyek "${project.title}" sudah aktif dan dipilih sebagai proyek utama Anda.*\n\nKlik tombol di bawah untuk langsung melanjutkan sesi Discovery.`,
          { parse_mode: 'Markdown', reply_markup: kb }
        );
        return;
      }

      // Langsung mulai sesi Fase 1 untuk proyek baru yang baru saja diaktifkan
      await ctx.reply(
        `🚀 *Proyek Aktif Dibuat: ${project.title}*\n\nMemulai *Fase 1: Idea Discovery*. _Sedang menyiapkan pertanyaan panduan interaktif..._`,
        { parse_mode: 'Markdown' }
      );

      await triggerDiscoveryTurn(
        ctx,
        project,
        `Halo, saya baru saja menjadikan ide "${project.title}" (${idea.raw_content}) sebagai proyek aktif. Mohon mulai Fase 1: Idea Discovery dengan pertanyaan panduan interaktif pertama beserta pilihan opsinya.`
      );
      return;
    }

    // Pilih Proyek Aktif
    if (data.startsWith('select_project_')) {
      const projectId = data.replace('select_project_', '');
      try {
        const project = await projectsService.getProjectById(projectId, user.id);
        if (!project) {
          await ctx.reply('⚠️ Proyek tidak ditemukan.');
          return;
        }

        // Tandai proyek ini sebagai aktif dengan memperbarui updated_at
        await (supabase as any)
          .from('projects')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', project.id);

        const currentPhase = (project as any).current_phase || 'PHASE_1_IDEA';
        const phaseMeta = getPhaseMetadata(currentPhase);
        const activeQuestion = (project as any).phase_data?.activeQuestion;

        // Jika proyek sudah di Fase 8 (PRD Ready), langsung tampilkan Panel Kontrol Generate & Kelola PRD
        if (currentPhase === 'PHASE_8_PRD_READY') {
          await showPhase8Panel(ctx, project);
          return;
        }

        // Jika sudah ada pertanyaan interaktif yang tersimpan, langsung tampilkan opsinya
        if (activeQuestion && activeQuestion.options && activeQuestion.options.length > 0) {
          const header = `🎯 *Proyek: ${project.title}*\n📍 *[Fase ${phaseMeta.number}/8: ${phaseMeta.shortName}]*\n\n`;
          const qText = `${header}*Pertanyaan Panduan:*\n❓ *${activeQuestion.question}*` +
            (activeQuestion.multiSelect ? '\n_(Pilih satu atau lebih opsi di bawah, lalu klik Konfirmasi)_' : '');
          const qKb = getInteractiveQuestionKeyboard(project.id, activeQuestion, currentPhase, true);

          await ctx.reply(qText, {
            parse_mode: 'Markdown',
            reply_markup: qKb,
          });
          return;
        }

        // Jika belum ada pertanyaan aktif untuk fase ini, otomatis picu AI untuk membuatkan pertanyaan panduan
        await ctx.reply(`🎯 *Membuka Sesi Discovery: ${project.title}*...`, { parse_mode: 'Markdown' });
        await triggerDiscoveryTurn(
          ctx,
          project,
          `Halo, saya ingin melanjutkan pembahasan pada Fase ${phaseMeta.number}: ${phaseMeta.title}. Mohon ajukan pertanyaan panduan interaktif pertama untuk fase ini.`
        );
      } catch (err: any) {
        logger.error({ err, projectId }, 'Failed in select_project_ handler');
        await ctx.reply(`❌ Terjadi kendala saat membuka sesi discovery: ${err.message}`);
      }
      return;
    }

    // Konfirmasi Hapus Proyek
    if (data.startsWith('confirm_del_proj_')) {
      const projectId = data.replace('confirm_del_proj_', '');
      const project = await projectsService.getProjectById(projectId, user.id);
      if (!project) {
        await ctx.reply('Proyek tidak ditemukan.');
        return;
      }

      const phaseMeta = getPhaseMetadata((project as any).current_phase || 'PHASE_1_IDEA');
      const kb = new InlineKeyboard()
        .text('⚠️ Ya, Hapus Seluruh Proyek', `exec_del_proj_${project.id}`)
        .row()
        .text('❌ Batal', `select_project_${project.id}`);

      await ctx.reply(
        `🚨 *Konfirmasi Penghapusan Proyek*\n\n` +
        `*Nama Proyek:* ${project.title}\n` +
        `*Fase:* Fase ${phaseMeta.number}/8: ${phaseMeta.shortName}\n\n` +
        `*Dampak Penghapusan:*\n` +
        `• Seluruh percakapan discovery pada proyek ini akan dihapus.\n` +
        `• Structured memory dan seluruh riwayat dokumen PRD proyek ini akan dibersihkan.\n` +
        `• Data proyek lain tidak akan terpengaruh (ide di Inbox akan tetap tersimpan dan bisa dijadikan proyek kembali).\n\n` +
        `Apakah Anda yakin ingin menghapus proyek ini secara permanen?`,
        { parse_mode: 'Markdown', reply_markup: kb }
      );
      return;
    }

    // Eksekusi Hapus Proyek
    if (data.startsWith('exec_del_proj_')) {
      const projectId = data.replace('exec_del_proj_', '');
      try {
        const res = await projectsService.deleteProject(projectId, user.id);
        await ctx.reply(`🗑️ *Proyek "${res.projectTitle}" beserta seluruh sesi dan dokumennya berhasil dihapus secara bersih.*`, {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('🚀 Daftar Proyek', 'cmd_list_projects').text('🔙 Menu Utama', 'cmd_menu'),
        });
      } catch (err: any) {
        logger.error({ err, projectId }, 'Failed executing project deletion');
        await ctx.reply(`❌ Gagal menghapus proyek: ${err.message}`);
      }
      return;
    }

    // Konfirmasi Hapus Dokumen PRD
    if (data.startsWith('confirm_del_prdv_')) {
      const versionId = data.replace('confirm_del_prdv_', '');

      const { data: version } = await (supabase as any)
        .from('prd_versions')
        .select('*, prd_documents(project_id)')
        .eq('id', versionId)
        .maybeSingle();

      if (!version) {
        await ctx.reply('Versi PRD tidak ditemukan atau sudah dihapus.');
        return;
      }

      const projectId = version.prd_documents?.project_id;
      const kb = new InlineKeyboard()
        .text('⚠️ Ya, Hapus Versi PRD Ini', `exec_del_prdv_${versionId}`)
        .row()
        .text('❌ Batal', projectId ? `list_project_prds_${projectId}` : 'cmd_list_projects');

      await ctx.reply(
        `⚠️ *Konfirmasi Hapus Versi PRD*\n\n` +
        `*Dokumen:* ${version.title}\n` +
        `*Versi:* v${version.version_number}.0\n\n` +
        `*Dampak:* Hanya file dan versi PRD ini yang dihapus. Proyek induk, sesi tanya-jawab, dan versi PRD lainnya *tetap aman*.\n\n` +
        `Yakin ingin menghapus dokumen PRD ini?`,
        { parse_mode: 'Markdown', reply_markup: kb }
      );
      return;
    }

    // Eksekusi Hapus Dokumen PRD
    if (data.startsWith('exec_del_prdv_')) {
      const versionId = data.replace('exec_del_prdv_', '');

      try {
        const { data: version } = await (supabase as any)
          .from('prd_versions')
          .select('*, prd_documents(project_id)')
          .eq('id', versionId)
          .maybeSingle();

        const projectId = version?.prd_documents?.project_id;
        if (!projectId) {
          throw new Error('Proyek induk dari versi PRD ini tidak ditemukan.');
        }

        const res = await prdService.deletePRDVersion(versionId, projectId, user.id);
        await ctx.reply(
          `🗑️ *Dokumen "${res.versionTitle}" berhasil dihapus.*\nSisa versi PRD aktif: ${res.remainingVersionsCount}`,
          {
            parse_mode: 'Markdown',
            reply_markup: new InlineKeyboard()
              .text('📑 Buka Daftar PRD Proyek', `list_project_prds_${projectId}`)
              .row()
              .text('🔙 Menu Utama', 'cmd_menu'),
          }
        );
      } catch (err: any) {
        logger.error({ err, versionId }, 'Failed executing PRD version deletion');
        await ctx.reply(`❌ Gagal menghapus dokumen PRD: ${err.message}`);
      }
      return;
    }

    // Pindah Fase Discovery
    if (data.startsWith('adv_') || data.startsWith('advance_phase_')) {
      let projectId: string;
      let targetPhase: DiscoveryPhase;

      if (data.startsWith('adv_')) {
        const parts = data.replace('adv_', '').split('_');
        projectId = parts[0];
        const num = parseInt(parts[1], 10);
        targetPhase = PHASE_NUM_TO_KEY[num] || 'PHASE_1_IDEA';
      } else {
        const parts = data.replace('advance_phase_', '').split('_');
        projectId = parts[0];
        targetPhase = ('PHASE_' + parts.slice(1).join('_')) as DiscoveryPhase;
      }

      await discoveryService.advancePhase(projectId, targetPhase);
      const meta = getPhaseMetadata(targetPhase);
      const project = await projectsService.getProjectById(projectId, user.id);

      // Jika masuk ke Fase 8 (PRD Ready), langsung tampilkan Panel Kontrol Generate PRD 29 Seksi
      if (targetPhase === 'PHASE_8_PRD_READY' && project) {
        await showPhase8Panel(ctx, project);
        return;
      }

      await ctx.reply(
        `🔄 *Berpindah ke Fase ${meta.number}/8: ${meta.title}*\n\n` +
        `*Fokus Tahap Ini:*\n${meta.description}\n\n` +
        `_Sedang menyiapkan opsi panduan interaktif..._`,
        {
          parse_mode: 'Markdown',
        }
      );

      // Otomatis picu AI untuk menyajikan pertanyaan panduan pertama di fase baru ini
      if (project) {
        await triggerDiscoveryTurn(
          ctx,
          project,
          `Saya baru saja berpindah ke Fase ${meta.number}: ${meta.title}. Tolong ajukan pertanyaan panduan interaktif pertama beserta pilihan opsi untuk fase ini.`
        );
      }
      return;
    }

    // Fast-Track Discovery (Instant synthesis to Phase 7)
    if (data.startsWith('fast_track_')) {
      const projectId = data.replace('fast_track_', '');
      const project = await projectsService.getProjectById(projectId, user.id);
      if (!project) {
        await ctx.reply('⚠️ Proyek tidak ditemukan.');
        return;
      }

      if ((project as any).current_phase === 'PHASE_8_PRD_READY') {
        await showPhase8Panel(ctx, project);
        return;
      }

      const statusMsg = await ctx.reply('⚡ *Memproses Fast-Track Discovery...*\nAI Product Architect sedang menganalisis arsitektur, flow, tech stack, dan OWASP security secara otomatis. Mohon tunggu ~3 detik...', {
        parse_mode: 'Markdown',
      });

      try {
        const res = await discoveryService.fastTrackDiscovery(projectId);
        await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});

        await ctx.reply(
          `⚡ *Fast-Track Selesai!* (+${res.decisionsCount} keputusan arsitektur disintesis otomatis).\n\n` +
          `Proyek Anda sekarang berada di *Fase 7: Pre-Flight Audit & Approval*. Seluruh spesifikasi siap Anda review atau langsung buat dokumen PRD.`,
          {
            parse_mode: 'Markdown',
            reply_markup: new InlineKeyboard()
              .text('🔍 Review Audit Spesifikasi', `audit_${projectId}`)
              .row()
              .text('📑 Langsung Generate PRD (29 Seksi)', `gen_prd_${projectId}`)
              .row()
              .text('🔙 Menu Utama', 'cmd_menu'),
          }
        );
      } catch (err: any) {
        logger.error({ err, projectId }, 'Failed during fast-track discovery');
        await ctx.reply(`❌ Kendala fast-track: ${err.message}`);
      }
      return;
    }

    // Validasi Kesiapan Proyek
    if (data.startsWith('val_ready_') || data.startsWith('validate_readiness_') || data.startsWith('audit_project_') || data.startsWith('audit_')) {
      const projectId = data
        .replace('val_ready_', '')
        .replace('validate_readiness_', '')
        .replace('audit_project_', '')
        .replace('audit_', '');
      await runValidation(ctx, projectId);
      return;
    }

    // Generate PRD (29 Seksi) - Asynchronous Progress & Live Editing
    if (data.startsWith('gen_prd_') || data.startsWith('generate_prd_')) {
      const projectId = data.startsWith('gen_prd_')
        ? data.replace('gen_prd_', '')
        : data.replace('generate_prd_', '');

      const statusMsg = await ctx.reply('⚙️ *[1/3] Menyiapkan Arsitektur PRD...*\nMengambil structured memory dan mensintesis 29 seksi standar industri.', {
        parse_mode: 'Markdown',
      });

      // Update progressive status after short delay to enhance instant responsive feedback
      const timer1 = setTimeout(() => {
        ctx.api.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          '⚙️ *[2/3] Menyusun Spesifikasi Teknis, Skema DB & OWASP Top 10...*\nMenyelesaikan endpoint API, data model, dan acceptance criteria.',
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }, 5000);

      const timer2 = setTimeout(() => {
        ctx.api.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          '⚙️ *[3/3] Finalisasi Format Markdown 29 Seksi...*\nDokumen siap diunduh sebentar lagi.',
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }, 12000);

      try {
        const prd = await prdService.generateOrRevisePRD(projectId);
        clearTimeout(timer1);
        clearTimeout(timer2);

        const prdData = await prdService.getLatestPRD(projectId);
        const versionId = prdData?.version?.id;

        const kb = new InlineKeyboard();
        if (versionId) {
          kb.text('📥 Unduh File PRD (.md)', `export_md_${versionId}`).row();
        }
        kb.text('📑 Daftar Semua Versi PRD', `list_project_prds_${projectId}`).row();
        kb.text('🔙 Menu Utama', 'cmd_menu');

        await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
        await ctx.reply(
          `✅ *PRD v${prd.versionNumber}.0 (29 Seksi Lengkap) Berhasil Disusun!*\n\n*Ringkasan Perubahan:* ${prd.changelogSummary}\n\nDokumen sudah siap digunakan developer dan AI coding agents. Unduh file Markdown (.md) Anda di bawah:`,
          { parse_mode: 'Markdown', reply_markup: kb }
        );
      } catch (err: any) {
        clearTimeout(timer1);
        clearTimeout(timer2);
        logger.error({ err, projectId }, 'Failed to generate 29-section PRD');
        await ctx.api.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          `❌ Terjadi kendala saat menyusun PRD: ${err.message}`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
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
        caption: `📄 Dokumen PRD: *${version.title}*\nFormat: Markdown (.md) 29 Seksi`,
        parse_mode: 'Markdown',
      });
      return;
    }

    // -------------------------------------------------------------
    // Interactive Guided Discovery Callbacks (dq_)
    // -------------------------------------------------------------

    // Opsi Dipilih (Single / Multi-Select)
    if (data.startsWith('dq_opt_')) {
      const parts = data.replace('dq_opt_', '').split('_');
      const projectId = parts[0];
      const optIdx = parseInt(parts[1], 10);

      const project = await projectsService.getProjectById(projectId, user.id);
      if (!project) {
        await ctx.reply('⚠️ Proyek tidak ditemukan.');
        return;
      }

      if ((project as any).current_phase === 'PHASE_8_PRD_READY') {
        await showPhase8Panel(ctx, project);
        return;
      }

      const activeQuestion = (project as any).phase_data?.activeQuestion;
      if (!activeQuestion || !activeQuestion.options || !activeQuestion.options[optIdx]) {
        await ctx.reply('⚠️ Pertanyaan ini sudah selesai atau telah diperbarui.');
        return;
      }

      const chosenOption = activeQuestion.options[optIdx];
      let selectedIds: string[] = activeQuestion.selectedOptionIds || [];

      if (activeQuestion.multiSelect) {
        if (selectedIds.includes(chosenOption.id)) {
          selectedIds = selectedIds.filter((id) => id !== chosenOption.id);
        } else {
          selectedIds.push(chosenOption.id);
        }
        activeQuestion.selectedOptionIds = selectedIds;

        await (supabase as any)
          .from('projects')
          .update({
            phase_data: {
              ...(project as any).phase_data,
              activeQuestion,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', projectId);

        const currentPhase = (project as any).current_phase || 'PHASE_1_IDEA';
        const newKb = getInteractiveQuestionKeyboard(projectId, activeQuestion, currentPhase, true);
        await ctx.editMessageReplyMarkup({ reply_markup: newKb }).catch(() => {});
        return;
      }

      // Single select: langsung kirimkan sebagai jawaban pengguna
      const answerText = `Saya memilih: ${chosenOption.label}`;
      await ctx.reply(`👉 *Jawaban Anda:* ${chosenOption.label}`, { parse_mode: 'Markdown' });

      // Lanjutkan alur discovery dengan teks jawaban ini
      await triggerDiscoveryTurn(ctx, project, answerText);
      return;
    }

    // Konfirmasi Pilihan Multi-Select
    if (data.startsWith('dq_cf_')) {
      const projectId = data.replace('dq_cf_', '');
      const project = await projectsService.getProjectById(projectId, user.id);
      if (!project) {
        await ctx.reply('⚠️ Proyek tidak ditemukan.');
        return;
      }

      if ((project as any).current_phase === 'PHASE_8_PRD_READY') {
        await showPhase8Panel(ctx, project);
        return;
      }

      const activeQuestion = (project as any).phase_data?.activeQuestion;
      const selectedIds: string[] = activeQuestion?.selectedOptionIds || [];

      if (selectedIds.length === 0) {
        await ctx.reply('⚠️ Silakan pilih minimal satu opsi di atas sebelum konfirmasi, atau gunakan "Ketik Sendiri" / "Saya Belum Tahu".');
        return;
      }

      const selectedLabels = activeQuestion.options
        .filter((o: any) => selectedIds.includes(o.id))
        .map((o: any) => o.label);

      const answerText = `Pilihan saya:\n- ${selectedLabels.join('\n- ')}`;
      await ctx.reply(`👉 *Jawaban Anda (${selectedLabels.length} opsi terpilih):*\n• ${selectedLabels.join('\n• ')}`, {
        parse_mode: 'Markdown',
      });

      await triggerDiscoveryTurn(ctx, project, answerText);
      return;
    }

    // Permintaan Rekomendasi AI
    if (data.startsWith('dq_rec_')) {
      const projectId = data.replace('dq_rec_', '');
      const project = await projectsService.getProjectById(projectId, user.id);
      if (!project) {
        await ctx.reply('⚠️ Proyek tidak ditemukan.');
        return;
      }

      if ((project as any).current_phase === 'PHASE_8_PRD_READY') {
        await showPhase8Panel(ctx, project);
        return;
      }

      const activeQuestion = (project as any).phase_data?.activeQuestion;
      const recommendation = activeQuestion?.aiRecommendation || 'Gunakan opsi default standar industri yang paling efisien untuk MVP.';

      await ctx.reply(
        `💡 *Rekomendasi AI Product Architect:*\n\n${recommendation}\n\nIngin menerapkan rekomendasi ini atau punya pertimbangan lain?`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text('👍 Terapkan Rekomendasi Ini', `dq_apprec_${projectId}`)
            .row()
            .text('✏️ Ketik Pilihan Sendiri', `dq_cst_${projectId}`)
            .text('🔙 Kembali ke Opsi', `select_project_${projectId}`),
        }
      );
      return;
    }

    // Terapkan Rekomendasi AI Langsung
    if (data.startsWith('dq_apprec_')) {
      const projectId = data.replace('dq_apprec_', '');
      const project = await projectsService.getProjectById(projectId, user.id);
      if (!project) {
        await ctx.reply('⚠️ Proyek tidak ditemukan.');
        return;
      }

      if ((project as any).current_phase === 'PHASE_8_PRD_READY') {
        await showPhase8Panel(ctx, project);
        return;
      }

      const activeQuestion = (project as any).phase_data?.activeQuestion;
      const recommendation = activeQuestion?.aiRecommendation || 'Rekomendasi terbaik AI';

      const answerText = `Saya setuju dan memilih rekomendasi AI: "${recommendation}". Lanjutkan dengan pertimbangan tersebut.`;
      await ctx.reply(`👍 *Menerapkan Rekomendasi AI:*\n_${recommendation}_`, { parse_mode: 'Markdown' });

      await triggerDiscoveryTurn(ctx, project, answerText);
      return;
    }

    // Opsi Custom (Ketik Sendiri)
    if (data.startsWith('dq_cst_')) {
      const projectId = data.replace('dq_cst_', '');
      await ctx.reply(
        '✏️ *Tuliskan Jawaban / Keinginan Spesifik Anda*\n\nSilakan ketik langsung di chat ini apa yang Anda inginkan (misal nama fitur khusus, stack tertentu, gaya desain referensi, atau alur kerja Anda). AI akan menyesuaikan arsitektur produk sesuai arahan Anda.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Opsi "Saya Belum Tahu"
    if (data.startsWith('dq_dnt_')) {
      const projectId = data.replace('dq_dnt_', '');
      const project = await projectsService.getProjectById(projectId, user.id);
      if (!project) {
        await ctx.reply('⚠️ Proyek tidak ditemukan.');
        return;
      }

      if ((project as any).current_phase === 'PHASE_8_PRD_READY') {
        await showPhase8Panel(ctx, project);
        return;
      }

      const answerText = 'Saya belum tahu atau belum memutuskan aspek ini. Mohon berikan rekomendasi cerdas dan jelaskan pro-kontranya berdasarkan jenis produk ini.';
      await ctx.reply('🤷 *Anda memilih: "Saya belum tahu"*\n\nAI Product Architect akan menganalisis kebutuhan dan memberikan rekomendasi yang paling tepat.', {
        parse_mode: 'Markdown',
      });

      await triggerDiscoveryTurn(ctx, project, answerText);
      return;
    }

    // Opsi "Lewati"
    if (data.startsWith('dq_skp_')) {
      const projectId = data.replace('dq_skp_', '');
      const project = await projectsService.getProjectById(projectId, user.id);
      if (!project) {
        await ctx.reply('⚠️ Proyek tidak ditemukan.');
        return;
      }

      if ((project as any).current_phase === 'PHASE_8_PRD_READY') {
        await showPhase8Panel(ctx, project);
        return;
      }

      const answerText = 'Lewati bagian ini untuk sekarang, simpan sebagai nilai default atau pertimbangan lanjutan.';
      await ctx.reply('⏩ *Bagian ini dilewati sementara.* Melanjutkan ke aspek berikutnya...', {
        parse_mode: 'Markdown',
      });

      await triggerDiscoveryTurn(ctx, project, answerText);
      return;
    }
  });

  // -------------------------------------------------------------
  // Default Message Handler (Chat / Discovery / Idea Capture)
  // -------------------------------------------------------------
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    const user = ctx.dbUser!;
    const isCapturingNewIdea = pendingNewIdeaUsers.has(user.id);
    if (isCapturingNewIdea) {
      pendingNewIdeaUsers.delete(user.id);
    } else {
      const project = await projectsService.getActiveProject(user.id);

      // If user has an active project in discovery, route to Discovery Service
      if (project && project.active_session_id) {
        await triggerDiscoveryTurn(ctx, project, text);
        return;
      }
    }

    // Otherwise, capture as a raw spontaneous idea in Idea Inbox
    const title = text.split('\n')[0].slice(0, 80);
    const idea = await ideasService.createIdea({
      userId: user.id,
      title,
      rawContent: text,
    });

    const kb = new InlineKeyboard()
      .text('🚀 Jadikan Proyek Aktif', `convert_idea_${idea.id}`)
      .row()
      .text('📥 Buka Idea Inbox', 'cmd_list_ideas');

    await ctx.reply(
      `💡 *Ide Baru Tercatat di Inbox!*\n\n*Judul:* ${idea.title}\n\nIngin mulai mendiskusikan & merancang arsitektur PRD untuk ide ini?`,
      {
        parse_mode: 'Markdown',
        reply_markup: kb,
      }
    );
  });

  return bot;
}

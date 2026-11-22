import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../db/types.js';
import { Config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { IdeasService } from '../modules/ideas/ideas.service.js';
import { ProjectsService } from '../modules/projects/projects.service.js';
import { DiscoveryService } from '../modules/discovery/discovery.service.js';
import { getPhaseMetadata } from '../modules/discovery/phases.config.js';
import { PrdService } from '../modules/prd/prd.service.js';
import { ExportService } from '../modules/export/export.service.js';
import { MemoryService } from '../modules/memory/memory.service.js';
import { QualityValidatorService } from '../modules/discovery/quality-validator.service.js';
import { IAIProvider } from '../ai/provider.interface.js';

export interface ApiServerDependencies {
  config: Config;
  supabase: SupabaseClient<Database>;
  authService: AuthService;
  ideasService: IdeasService;
  projectsService: ProjectsService;
  discoveryService: DiscoveryService;
  prdService: PrdService;
  exportService: ExportService;
  memoryService: MemoryService;
  validatorService: QualityValidatorService;
  aiProvider: IAIProvider;
}

export function createApiServer(deps: ApiServerDependencies): FastifyInstance {
  const app = Fastify({
    logger: false, // We use the shared pino logger
  });

  // Enable CORS for mobile & web dev clients
  app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  // Resilient JSON body parser that handles empty bodies gracefully without 400 error
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body: string, done) => {
    if (!body || body.trim() === '') {
      done(null, {});
      return;
    }
    try {
      const json = JSON.parse(body);
      done(null, json);
    } catch (err: any) {
      done(err, undefined);
    }
  });

  const {
    config,
    supabase,
    ideasService,
    projectsService,
    discoveryService,
    prdService,
    exportService,
    memoryService,
    validatorService,
    aiProvider,
  } = deps;

  // -------------------------------------------------------------
  // Auth Middleware Helper
  // -------------------------------------------------------------
  async function resolveUser(req: FastifyRequest, reply: FastifyReply) {
    // 1. In standard dev/personal mode, we resolve to the primary user
    // or authenticate via Bearer token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '').trim();
      if (token !== config.API_AUTH_TOKEN && token !== 'personal-token') {
        reply.code(401).send({ error: 'Unauthorized: Invalid token' });
        return null;
      }
    }

    // Default to the first allowed Telegram user registered in database
    const primaryTelegramId = config.TELEGRAM_ALLOWED_USER_IDS[0];
    const { data: user } = await (supabase as any)
      .from('users')
      .select('*')
      .eq('telegram_id', primaryTelegramId)
      .maybeSingle();

    if (!user) {
      reply.code(401).send({ error: 'User account not found. Please start the Telegram bot first.' });
      return null;
    }

    return user;
  }

  // -------------------------------------------------------------
  // Health Check
  // -------------------------------------------------------------
  app.get('/api/health', async () => {
    return {
      status: 'ok',
      service: 'Qoro API',
      timestamp: new Date().toISOString(),
    };
  });

  // -------------------------------------------------------------
  // MODULE 1: Dashboard Stats & Recent Activity
  // -------------------------------------------------------------
  app.get('/api/dashboard/stats', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    try {
      const [allIdeas, allProjects] = await Promise.all([
        ideasService.listIdeas(user.id),
        projectsService.listProjects(user.id),
      ]);

      const ideasInbox = allIdeas.filter((i) => i.status === 'INBOX' || !i.status);
      const ideasConverted = allIdeas.filter((i) => i.status === 'CONVERTED_TO_PROJECT');
      const completedProjects = allProjects.filter(
        (p) => p.status === 'COMPLETED' || p.status === 'PRD_READY' || p.current_phase === 'PHASE_8_PRD_READY'
      );
      const activeProjects = allProjects.filter(
        (p) => p.status !== 'COMPLETED' && p.status !== 'PRD_READY' && p.current_phase !== 'PHASE_8_PRD_READY' && p.status !== 'ARCHIVED'
      );

      // Fetch user's PRD documents cleanly (avoid PostgREST PGRST201 join ambiguity)
      const projectIds = allProjects.map((p) => p.id);
      let prds: any[] = [];
      if (projectIds.length > 0) {
        const { data: docs, error: docError } = await (supabase as any)
          .from('prd_documents')
          .select('id, project_id, title, status, created_at, updated_at')
          .in('project_id', projectIds)
          .order('updated_at', { ascending: false });

        if (!docError && docs) {
          prds = docs;
        }
      }

      return {
        metrics: {
          totalIdeas: allIdeas.length,
          ideasWaiting: ideasInbox.length,
          ideasConverted: ideasConverted.length,
          totalProjects: allProjects.length,
          activeProjects: activeProjects.length,
          completedProjects: completedProjects.length,
          totalPRDs: prds.length,
        },
        recentIdeas: allIdeas.slice(0, 5),
        recentPRDs: prds.slice(0, 5),
        recentProjects: allProjects.slice(0, 5),
      };
    } catch (err: any) {
      logger.error({ err }, 'Error fetching dashboard stats');
      return reply.code(500).send({ error: err.message });
    }
  });

  // -------------------------------------------------------------
  // MODULE 2: Idea Inbox Management
  // -------------------------------------------------------------
  app.get('/api/ideas', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const query = req.query as { category?: string; status?: string; search?: string };
    try {
      let ideas = await ideasService.listIdeas(user.id);

      if (query.status) {
        ideas = ideas.filter((i) => i.status === query.status);
      }
      if (query.category) {
        ideas = ideas.filter((i) => (i as any).category === query.category);
      }
      if (query.search) {
        const s = query.search.toLowerCase();
        ideas = ideas.filter(
          (i) => i.title.toLowerCase().includes(s) || i.raw_content.toLowerCase().includes(s)
        );
      }

      return { ideas };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  app.post('/api/ideas', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const body = req.body as { title: string; rawContent: string; category?: string; tags?: string[] };
    if (!body.title || !body.rawContent) {
      return reply.code(400).send({ error: 'Title and rawContent are required' });
    }

    try {
      const idea = await ideasService.createIdea({
        userId: user.id,
        title: body.title,
        rawContent: body.rawContent,
        category: body.category || 'Other',
        tags: body.tags || [],
      });
      return reply.code(201).send({ idea });
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  app.get('/api/ideas/:id', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const idea = await ideasService.getIdeaById(id, user.id);
    if (!idea) return reply.code(404).send({ error: 'Idea not found' });

    // Check if linked to an existing project
    const linkedProject =
      (await projectsService.findProjectByIdeaId(user.id, idea.id)) ||
      (await projectsService.findProjectByTitle(user.id, idea.title));

    return { idea, linkedProject };
  });

  app.patch('/api/ideas/:id', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const body = req.body as {
      title?: string;
      rawContent?: string;
      category?: string;
      status?: any;
      tags?: string[];
    };

    try {
      const updated = await ideasService.updateIdea(id, user.id, body);
      return { idea: updated };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  app.delete('/api/ideas/:id', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    try {
      const res = await ideasService.deleteIdea(id, user.id);
      return { success: true, ideaTitle: res.ideaTitle };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Convert idea to project
  app.post('/api/ideas/:id/convert', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const idea = await ideasService.getIdeaById(id, user.id);
    if (!idea) return reply.code(404).send({ error: 'Idea not found' });

    try {
      const { project, isExisting } = await projectsService.createProject({
        userId: user.id,
        ideaId: idea.id,
        title: idea.title,
        summary: idea.raw_content,
      });

      return { project, isExisting };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // -------------------------------------------------------------
  // MODULE 3: AI-Powered Idea Spinner (Generate Fresh, Unmade Ideas)
  // -------------------------------------------------------------
  app.get('/api/spinner/eligible', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const query = req.query as { category?: string; targetPlatform?: string; refresh?: string };

    try {
      // 1. Ambil daftar proyek dan ide yang sudah pernah dibuat user agar AI tidak mengulang
      const [existingIdeas, existingProjects] = await Promise.all([
        ideasService.listIdeas(user.id),
        projectsService.listProjects(user.id),
      ]);

      const madeList = [
        ...existingIdeas.map((i) => i.title),
        ...existingProjects.map((p) => p.title),
      ].filter(Boolean);

      const filterCat = query.category && query.category !== 'All' ? query.category : 'Software / Digital Product';
      const platformConstraint = query.targetPlatform && query.targetPlatform !== 'All' 
        ? `Platform: ${query.targetPlatform}` 
        : 'Tentukan apakah ini lebih cocok sebagai "Mobile Application" atau "Web Application / Responsive Web"';

      const prompt = `Anda adalah Principal Product Strategist, Venture Architect & Tech Lead.
Tugas Anda: Berikan 6 ide produk perangkat lunak segar, berbobot, inovatif, dan relevan dengan tren pasar saat ini.

SYARAT MUTLAK:
1. Ide TIDAK BOLEH mengulang ide atau proyek yang sudah pernah dibuat oleh user berikut:
${madeList.length > 0 ? madeList.map((t) => `- ${t}`).join('\n') : '- Belum ada'}

2. Kategori fokus: "${filterCat}".
3. Target platform: "${platformConstraint}". Berikan rekomendasi tegas: apakah produk ini adalah "Mobile App (Android/iOS)" atau "Web Application (SaaS/Dashboard)" atau "Cross-Platform", beserta alasan teknis & UX mendalam.
4. Setiap ide harus memiliki penjelasan arsitektur lengkap: Masalah nyata (Problem Statement), Konsep Solusi & Nilai Pembeda, Target Pengguna, Fitur Kunci, dan Rekomendasi Tech Stack.

Format output JSON WAJIB:
{
  "ideas": [
    {
      "id": "slug_unik_1",
      "title": "Nama Produk / Ide",
      "summary": "Ringkasan konsep dalam 1-2 kalimat padat dan menarik",
      "problem_statement": "Deskripsi masalah spesifik & pain point nyata yang dihadapi target pengguna",
      "solution_concept": "Penjelasan cara kerja produk menyelesaikan masalah tersebut dan keunggulan utamanya",
      "target_audience": "Segmen pengguna spesifik (misal: pekerja kreatif freelance, developer backend, manajer logistik)",
      "category": "Kategori produk",
      "recommended_platform": "Mobile App" | "Web Application" | "Cross-Platform",
      "platform_reason": "Analisis mendalam mengapa platform tersebut dipilih dari sudut pandang UX, akses sensor/hardware, portabilitas, atau efisiensi kerja",
      "key_features": ["Fitur 1: Penjelasan singkat", "Fitur 2: Penjelasan singkat", "Fitur 3: Penjelasan singkat"],
      "tech_stack_recommendation": "Rekomendasi stack teknologi spesifik (misal: React Native, Expo, Fastify, Supabase, PostgreSQL)"
    }
  ]
}`;

      const res = await aiProvider.chatStructured<{
        ideas: Array<{
          id: string;
          title: string;
          summary?: string;
          problem_statement?: string;
          solution_concept?: string;
          target_audience?: string;
          category: string;
          recommended_platform: string;
          platform_reason: string;
          key_features?: string[];
          tech_stack_recommendation?: string;
        }>;
      }>([{ role: 'user', content: prompt }], 'Valid JSON matching ideas schema');

      const generatedIdeas = (res.data?.ideas || []).map((item, idx) => {
        const fullContent = item.summary || item.solution_concept || item.problem_statement || 'Konsep produk inovatif hasil eksplorasi AI.';
        return {
          id: `ai-spin-${Date.now()}-${idx}`,
          user_id: user.id,
          title: item.title,
          raw_content: fullContent,
          summary: item.summary || fullContent,
          problem_statement: item.problem_statement || 'Masalah efisiensi dan otomasi proses kerja.',
          solution_concept: item.solution_concept || fullContent,
          target_audience: item.target_audience || 'Pengguna profesional dan tim modern.',
          category: item.category || filterCat,
          recommended_platform: item.recommended_platform || 'Mobile App',
          platform_reason: item.platform_reason || 'Paling optimal untuk interaksi pengguna langsung.',
          key_features: item.key_features || [],
          tech_stack_recommendation: item.tech_stack_recommendation || 'Modern Full-Stack Architecture',
          status: 'EXPLORING',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      });

      return {
        eligibleIdeas: generatedIdeas,
        source: 'AI_INNOVATION_ENGINE',
      };
    } catch (err: any) {
      logger.error({ err }, 'Error generating AI spinner ideas');
      return reply.code(500).send({ error: err.message });
    }
  });

  // Save selected AI idea directly into Inbox or start Discovery
  app.post('/api/spinner/adopt', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const body = req.body as {
      title: string;
      rawContent: string;
      category: string;
      recommendedPlatform: string;
      platformReason: string;
    };

    if (!body.title || !body.rawContent) {
      return reply.code(400).send({ error: 'Title and rawContent are required' });
    }

    try {
      const fullDesc = `${body.rawContent}\n\n📱 *Rekomendasi Platform:* ${body.recommendedPlatform}\n💡 *Pertimbangan:* ${body.platformReason}`;
      const idea = await ideasService.createIdea({
        userId: user.id,
        title: body.title,
        rawContent: fullDesc,
        category: body.category || 'Other',
        tags: [`platform:${body.recommendedPlatform.toLowerCase().replace(/\s+/g, '-')}`],
      });

      return { success: true, idea };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  app.post('/api/spinner/record', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const body = req.body as { ideaId: string; filterCategory?: string };
    if (!body.ideaId) return reply.code(400).send({ error: 'ideaId is required' });

    try {
      await (supabase as any).from('idea_spin_history').insert({
        user_id: user.id,
        idea_id: body.ideaId,
        filter_category: body.filterCategory || null,
      });
      return { success: true };
    } catch (err: any) {
      // Non-fatal if table not migrated yet
      return { success: true, note: err.message };
    }
  });

  // -------------------------------------------------------------
  // MODULE 4: Projects & AI Assistant Discovery
  // -------------------------------------------------------------
  app.get('/api/projects', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    try {
      const projects = await projectsService.listProjects(user.id);
      return { projects };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  app.get('/api/projects/:id', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    let project = await projectsService.getProjectById(id, user.id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    // If project doesn't have an active question yet and not in Phase 8, auto-generate initial question
    const hasQuestion = Boolean(
      (project as any).phase_data?.activeQuestion?.options?.length
    );
    if (!hasQuestion && project.current_phase !== 'PHASE_8_PRD_READY' && !project.is_locked) {
      const phaseMeta = getPhaseMetadata(project.current_phase);
      try {
        await projectsService.setProjectLock(id, true);
        await discoveryService.processUserMessage(
          id,
          project.active_session_id || '',
          `Halo AI, tolong ajukan pertanyaan panduan arah tujuan produk interaktif pertama beserta opsi pilihan jawaban (A, B, C, D) dan rekomendasi cerdas AI untuk proyek "${project.title}" pada Fase ${phaseMeta.number}: ${phaseMeta.title}.`
        );
        project = await projectsService.getProjectById(id, user.id);
      } catch (err) {
        logger.error({ err, projectId: id }, 'Failed to auto-generate initial question on getProjectDetail');
      } finally {
        await projectsService.setProjectLock(id, false);
      }
    }

    // Fetch decisions (structured memory) & latest messages
    const [decisions, messages] = await Promise.all([
      memoryService.getDecisionsByProject(id),
      (supabase as any)
        .from('messages')
        .select('*')
        .eq('session_id', project?.active_session_id)
        .order('created_at', { ascending: true }),
    ]);

    return {
      project,
      decisions,
      messages: messages.data || [],
    };
  });

  // Submit turn to AI Discovery Service
  app.post('/api/projects/:id/discovery/message', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const body = req.body as { message: string };
    if (!body.message) return reply.code(400).send({ error: 'message is required' });

    const project = await projectsService.getProjectById(id, user.id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    if (project.is_locked) {
      return reply.code(429).send({ error: 'AI is currently processing another turn for this project' });
    }

    try {
      await projectsService.setProjectLock(id, true);
      const discoveryReply = await discoveryService.processUserMessage(
        id,
        project.active_session_id || '',
        body.message
      );

      const updatedProject = await projectsService.getProjectById(id, user.id);
      return {
        reply: discoveryReply,
        project: updatedProject,
      };
    } catch (err: any) {
      logger.error({ err, projectId: id }, 'Discovery API error');
      return reply.code(500).send({ error: err.message });
    } finally {
      await projectsService.setProjectLock(id, false);
    }
  });

  // Update project metadata (Module 6: Planning, status, tech stack, notes)
  app.patch('/api/projects/:id', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const body = req.body as {
      status?: any;
      category?: string;
      tech_stack?: string[];
      start_date?: string;
      target_date?: string;
      dev_notes?: string;
    };

    const project = await projectsService.getProjectById(id, user.id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const currentPhaseData = (project as any).phase_data || {};
    const updatedPhaseData = {
      ...currentPhaseData,
      category: body.category !== undefined ? body.category : currentPhaseData.category,
      tech_stack: body.tech_stack !== undefined ? body.tech_stack : currentPhaseData.tech_stack,
      start_date: body.start_date !== undefined ? body.start_date : currentPhaseData.start_date,
      target_date: body.target_date !== undefined ? body.target_date : currentPhaseData.target_date,
      dev_notes: body.dev_notes !== undefined ? body.dev_notes : currentPhaseData.dev_notes,
    };

    const updatePayload: Record<string, any> = {
      phase_data: updatedPhaseData,
      updated_at: new Date().toISOString(),
    };
    if (body.status) updatePayload.status = body.status;

    await (supabase as any)
      .from('projects')
      .update(updatePayload)
      .eq('id', id)
      .eq('user_id', user.id);

    const updated = await projectsService.getProjectById(id, user.id);
    return { project: updated };
  });

  // Delete project and all linked records
  app.delete('/api/projects/:id', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const project = await projectsService.getProjectById(id, user.id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    try {
      // 1. Hapus dokumen PRD dan versi
      const { data: docs } = await (supabase as any)
        .from('prd_documents')
        .select('id')
        .eq('project_id', id);
      if (docs && docs.length > 0) {
        const docIds = docs.map((d: any) => d.id);
        await (supabase as any).from('prd_versions').delete().in('prd_document_id', docIds);
        await (supabase as any).from('prd_documents').delete().in('id', docIds);
      }

      // 2. Hapus decisions & sessions
      await (supabase as any).from('product_decisions').delete().eq('project_id', id);
      await (supabase as any).from('discovery_sessions').delete().eq('project_id', id);

      // 3. Hapus proyek
      await (supabase as any).from('projects').delete().eq('id', id).eq('user_id', user.id);

      return { success: true, projectTitle: project.title };
    } catch (err: any) {
      logger.error({ err, projectId: id }, 'Failed to delete project');
      return reply.code(500).send({ error: err.message });
    }
  });

  // Advance Phase
  app.post('/api/projects/:id/discovery/advance', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const body = req.body as { targetPhase: any };
    if (!body.targetPhase) return reply.code(400).send({ error: 'targetPhase is required' });

    const project = await projectsService.getProjectById(id, user.id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    try {
      await discoveryService.advancePhase(id, body.targetPhase);
      const phaseMeta = getPhaseMetadata(body.targetPhase);

      // Auto-generate guided question for the new phase
      if (body.targetPhase !== 'PHASE_8_PRD_READY') {
        try {
          await projectsService.setProjectLock(id, true);
          await discoveryService.processUserMessage(
            id,
            project.active_session_id || '',
            `Halo AI, kita sekarang beralih ke Fase ${phaseMeta.number}: ${phaseMeta.title} untuk proyek "${project.title}". Tolong ajukan pertanyaan panduan arah tujuan beserta opsi pilihan terarah (A, B, C, D) dan rekomendasi cerdas AI.`
          );
        } catch (err) {
          logger.error({ err, projectId: id }, 'Failed to auto-generate question on advancePhase');
        } finally {
          await projectsService.setProjectLock(id, false);
        }
      }

      const updated = await projectsService.getProjectById(id, user.id);
      return { success: true, project: updated };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Fast-track
  app.post('/api/projects/:id/discovery/fast-track', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    try {
      const res = await discoveryService.fastTrackDiscovery(id);
      const project = await projectsService.getProjectById(id, user.id);
      return { success: true, result: res, project };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // -------------------------------------------------------------
  // MODULE 5: PRD Management & Export
  // -------------------------------------------------------------
  // List all PRDs across user's projects for unified catalog & preview
  app.get('/api/prds', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    try {
      const { data: userProjects, error: projError } = await (supabase as any)
        .from('projects')
        .select('id, title, summary, status, current_phase')
        .eq('user_id', user.id);

      if (projError) throw projError;

      if (!userProjects || userProjects.length === 0) {
        return { prds: [] };
      }

      const projectIds = userProjects.map((p: any) => p.id);
      
      // 1. Fetch prd_documents
      const { data: docs, error: docError } = await (supabase as any)
        .from('prd_documents')
        .select('*')
        .in('project_id', projectIds)
        .order('updated_at', { ascending: false });

      if (docError) throw docError;

      const docIds = (docs || []).map((d: any) => d.id);
      
      // 2. Fetch prd_versions explicitly to avoid PostgREST relationship ambiguity (PGRST201)
      const { data: allVersions, error: verError } = docIds.length > 0
        ? await (supabase as any)
            .from('prd_versions')
            .select('*')
            .in('prd_document_id', docIds)
        : { data: [], error: null };

      if (verError) throw verError;

      const prdList = (docs || []).map((doc: any) => {
        const proj = userProjects.find((p: any) => p.id === doc.project_id);
        const versions = (allVersions || [])
          .filter((v: any) => v.prd_document_id === doc.id)
          .sort((a: any, b: any) => b.version_number - a.version_number);

        const latestVersion =
          versions.find((v: any) => v.id === doc.current_version_id) || versions[0] || null;

        return {
          id: doc.id,
          projectId: doc.project_id,
          projectTitle: proj?.title || doc.title,
          projectCategory: proj?.category || 'General',
          title: doc.title,
          status: doc.status,
          versionCount: versions.length,
          latestVersion,
          versions,
          created_at: doc.created_at,
          updated_at: doc.updated_at,
        };
      });

      return { prds: prdList };
    } catch (err: any) {
      logger.error({ err }, 'Failed to list all PRDs');
      return reply.code(500).send({ error: err.message });
    }
  });

  app.get('/api/projects/:id/prds', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    try {
      const versions = await prdService.listVersions(id);
      const latest = await prdService.getLatestPRD(id);
      return { versions, latest };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  app.post('/api/projects/:id/prds/generate', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const body = (req.body as { revisionFeedback?: string; targetSectionNumber?: number }) || {};

    try {
      const result = await prdService.generateOrRevisePRD(
        id,
        body.revisionFeedback,
        body.targetSectionNumber
      );
      const latest = await prdService.getLatestPRD(id);
      return { result, latest };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Export PRD as Markdown or PDF
  app.get('/api/prds/export/:versionId/:format', async (req, reply) => {
    const user = await resolveUser(req, reply);
    if (!user) return;

    const { versionId, format } = req.params as { versionId: string; format: string };

    const { data: version } = await (supabase as any)
      .from('prd_versions')
      .select('*, prd_documents(project_id, title)')
      .eq('id', versionId)
      .single();

    if (!version) return reply.code(404).send({ error: 'PRD version not found' });

    try {
      if (format.toLowerCase() === 'pdf') {
        const result = await exportService.exportToPdf(
          version.id,
          version.title,
          version.content_markdown
        );
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `attachment; filename="${result.fileName}"`);
        const fs = await import('node:fs/promises');
        const fileBuf = await fs.readFile(result.filePath);
        return reply.send(fileBuf);
      } else {
        const result = await exportService.exportToMarkdown(
          version.id,
          version.title,
          version.content_markdown
        );
        reply.header('Content-Type', 'text/markdown; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="${result.fileName}"`);
        const fs = await import('node:fs/promises');
        const fileBuf = await fs.readFile(result.filePath);
        return reply.send(fileBuf);
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  return app;
}

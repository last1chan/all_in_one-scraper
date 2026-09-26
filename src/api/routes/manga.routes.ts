import { FastifyInstance, FastifyRequest } from 'fastify';
import { unifiedMangaService } from '../../services/unified-manga.service.js';
import { mangaProviderRegistry } from '../../providers/manga/index.js';

interface MangaSearchQuery {
  q?: string;
  provider?: string;
}

interface MangaChaptersQuery {
  provider?: string;
  mangaId?: string;
}

interface MangaPagesQuery {
  provider?: string;
  chapterId?: string;
}

export async function mangaRoutes(fastify: FastifyInstance) {
  // GET /api/manga/search?q=naruto&provider=comix
  fastify.get('/api/manga/search', async (request: FastifyRequest<{ Querystring: MangaSearchQuery }>, reply) => {
    const { q, provider } = request.query;

    if (!q) {
      return reply.code(400).send({ error: 'Query parameter "q" is required' });
    }

    try {
      const results = await unifiedMangaService.search(q, provider);
      return { success: true, count: results.length, data: results };
    } catch (err: any) {
      request.log.error(err);
      return reply.code(500).send({ error: err.message || 'Manga search failed' });
    }
  });

  // GET /api/manga/chapters?provider=comix&mangaId=...
  fastify.get('/api/manga/chapters', async (request: FastifyRequest<{ Querystring: MangaChaptersQuery }>, reply) => {
    const { provider, mangaId } = request.query;

    if (!provider || !mangaId) {
      return reply.code(400).send({ error: 'Parameters "provider" and "mangaId" are required' });
    }

    try {
      const chapters = await unifiedMangaService.getChapters(provider, mangaId);
      return { success: true, provider, mangaId, count: chapters.length, chapters };
    } catch (err: any) {
      request.log.error(err);
      return reply.code(500).send({ error: err.message || 'Failed to fetch chapters' });
    }
  });

  // GET /api/manga/pages?provider=comix&chapterId=...
  fastify.get('/api/manga/pages', async (request: FastifyRequest<{ Querystring: MangaPagesQuery }>, reply) => {
    const { provider, chapterId } = request.query;

    if (!provider || !chapterId) {
      return reply.code(400).send({ error: 'Parameters "provider" and "chapterId" are required' });
    }

    try {
      const pages = await unifiedMangaService.getPages(provider, chapterId);
      return { success: true, provider, chapterId, count: pages.length, pages };
    } catch (err: any) {
      request.log.error(err);
      return reply.code(500).send({ error: err.message || 'Failed to fetch pages' });
    }
  });

  // GET /api/manga/providers
  fastify.get('/api/manga/providers', async () => {
    const providers = unifiedMangaService.getProviders();
    return {
      success: true,
      count: providers.length,
      selfHostedCount: mangaProviderRegistry.getSelfHostedProviders().length,
      providers,
    };
  });
}

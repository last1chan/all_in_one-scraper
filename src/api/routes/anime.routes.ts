import { FastifyInstance, FastifyRequest } from 'fastify';
import { providerRegistry } from '../../providers/index.js';
import { mangaProviderRegistry } from '../../providers/manga/index.js';
import { unifiedScraperService } from '../../services/unified-scraper.service.js';
import { scheduleService } from '../../services/schedule.service.js';
import { getTargetReferer } from './proxy.routes.js';

interface SearchQuery {
  query?: string;
  provider?: string;
}

interface EpisodesQuery {
  provider: string;
  id: string;
}

interface ServersQuery {
  provider: string;
  id: string;
  episode: string;
}

interface SourcesQuery {
  provider: string;
  id: string;
  episode: string;
  server: string;
  subType?: 'sub' | 'dub';
}

interface UnifiedStreamQuery {
  anilistId: string;
  episode: string;
  audio?: 'sub' | 'dub';
  provider?: string;
  lang?: string;
}

interface EpisodesByAniListQuery {
  anilistId: string;
  provider?: string;
}

interface AnivexaWatchParams {
  provider?: string;
  anilistId: string;
  audio: string;
  episodeNumber: string;
  epSlug?: string;
}

export async function animeRoutes(fastify: FastifyInstance) {
  // GET /api/everything-moe
  fastify.get('/api/everything-moe', async () => {
    const animeSources = providerRegistry.getEverythingMoeIndex();
    const mangaSources = mangaProviderRegistry.getEverythingMoeIndex();
    const allSources = [...animeSources, ...mangaSources];

    return {
      status: 'ok',
      totalSources: allSources.length,
      totalAnime: animeSources.length,
      totalManga: mangaSources.length,
      selfHostedCount:
        providerRegistry.getSelfHostedProviders().length +
        mangaProviderRegistry.getSelfHostedProviders().length,
      animeSources,
      mangaSources,
      sources: allSources,
    };
  });

  // GET /api/anime/providers
  fastify.get('/api/anime/providers', async () => {
    const providers = providerRegistry.getAllProviders().map((p) => ({
      name: p.name,
      defaultUrl: p.defaultBaseUrl,
      activeUrl: p.getBaseUrl(),
      mirrors: p.mirrorUrls,
      languages: p.languages,
      isSelfHosted: p.isSelfHosted ?? false,
      librarySize: p.librarySize ?? 'Unknown',
      serverType: p.serverType ?? 'third-party',
    }));
    return { providers };
  });

  // GET /api/anime/resolve-stream?anilistId=21&episode=1&audio=sub
  fastify.get('/api/anime/resolve-stream', async (request: FastifyRequest<{ Querystring: UnifiedStreamQuery }>, reply) => {
    const { anilistId, episode, audio = 'sub', provider, lang } = request.query;
    const alId = parseInt(anilistId, 10);
    const epNum = parseInt(episode, 10);

    if (isNaN(alId) || isNaN(epNum)) {
      return reply.code(400).send({ error: 'Valid numeric "anilistId" and "episode" are required' });
    }

    try {
      const stream = await unifiedScraperService.resolveStream(alId, epNum, audio, provider, lang);
      const host = request.headers.host;
      const protocol = request.protocol;
      const referer = stream.headers?.Referer || (providerRegistry.getProvider(stream.provider)?.getBaseUrl() + '/');

      const sourcesWithProxy = stream.sources.map((s) => {
        let effectiveRef = referer;
        try {
          effectiveRef = getTargetReferer(new URL(s.url), effectiveRef) || effectiveRef;
        } catch {}
        return {
          ...s,
          referer: effectiveRef,
          proxyUrl: `${protocol}://${host}/api/proxy/m3u8?url=${encodeURIComponent(s.url)}${effectiveRef ? `&referer=${encodeURIComponent(effectiveRef)}` : ''}`,
        };
      });

      return {
        ...stream,
        sources: sourcesWithProxy,
      };
    } catch (err: any) {
      request.log.error(err);
      return reply.code(502).send({ error: err.message });
    }
  });

  // GET /api/anime/episodes-by-anilist?anilistId=21
  fastify.get('/api/anime/episodes-by-anilist', async (request: FastifyRequest<{ Querystring: EpisodesByAniListQuery }>, reply) => {
    const { anilistId, provider } = request.query;
    const alId = parseInt(anilistId, 10);
    if (isNaN(alId)) {
      return reply.code(400).send({ error: 'Valid numeric "anilistId" is required' });
    }

    try {
      const result = await unifiedScraperService.getAiredEpisodesForMedia(alId, provider);
      return result;
    } catch (err: any) {
      request.log.error(err);
      return reply.code(502).send({ error: err.message });
    }
  });

  // GET /watch/:provider/:anilistId/:audio/:epSlug (Drop-in compatibility for AniLast AnivexaProvider)
  fastify.get('/watch/:provider/:anilistId/:audio/:epSlug', async (request: FastifyRequest<{ Params: AnivexaWatchParams }>, reply) => {
    const { provider, anilistId, audio, epSlug } = request.params;
    const alId = parseInt(anilistId, 10);
    const epMatch = epSlug ? epSlug.match(/\d+$/) : null;
    const epNum = epMatch ? parseInt(epMatch[0], 10) : 1;
    const subType = audio === 'dub' ? 'dub' : 'sub';

    const providerMap: Record<string, string> = {
      anidbapp: 'animeheaven', // Megumin -> AnimeHeaven
      reanime: 'animegg',      // Taiga -> AnimeGG
      animedunya: 'animeonsen', // Zero Two -> AnimeOnsen
      aniwaves: 'aniwaves',     // Mikasa -> AniWaves
      anikoto: 'anichan',      // Asuna -> AniChan
      anibd: 'anichan',        // Rem -> AniChan
    };
    const targetProvider = provider ? (providerMap[provider.toLowerCase()] || provider) : undefined;

    try {
      const result = await unifiedScraperService.resolveStream(alId, epNum, subType, targetProvider);
      const host = request.headers.host;
      const protocol = request.protocol;
      const referer = result.headers?.Referer || (providerRegistry.getProvider(result.provider)?.getBaseUrl() + '/');
      
      const streams = result.sources.map((s) => {
        let effectiveRef = referer;
        try {
          effectiveRef = getTargetReferer(new URL(s.url), effectiveRef) || effectiveRef;
        } catch {}
        return {
          url: s.url,
          proxyUrl: `${protocol}://${host}/api/proxy/m3u8?url=${encodeURIComponent(s.url)}${effectiveRef ? `&referer=${encodeURIComponent(effectiveRef)}` : ''}`,
          type: s.type === 'hls' ? 'hls' : s.type,
          quality: s.quality || 'HD',
          referer: effectiveRef,
          subtitles: result.subtitles,
          isActive: true,
        };
      });

      return {
        anilistId: alId,
        episode: epNum,
        audio: subType,
        streams,
        subtitles: result.subtitles,
        skip_data: {
          intro: result.intro ? [result.intro.start, result.intro.end] : [0, 0],
          outro: result.outro ? [result.outro.start, result.outro.end] : [0, 0],
        },
      };
    } catch (err: any) {
      return reply.code(502).send({ error: err.message });
    }
  });

  // GET /api/anime/downloads/:anilistId/:episode?audio=sub
  fastify.get('/api/anime/downloads/:anilistId/:episode', async (request: FastifyRequest<{ Params: { anilistId: string; episode: string }; Querystring: { audio?: 'sub' | 'dub' } }>, reply) => {
    const { anilistId, episode } = request.params;
    const { audio = 'sub' } = request.query;
    const alId = parseInt(anilistId, 10);
    const epNum = parseInt(episode, 10);
    if (isNaN(alId) || isNaN(epNum)) {
      return reply.code(400).send({ error: 'Valid numeric "anilistId" and "episode" are required' });
    }

    const downloadResults: Array<{ server: string; quality: string; url: string; format: string }> = [];

    const [ggResult, heavenResult, paheResult, anikotoResult, aniwavesResult, anichanResult] = await Promise.allSettled([
      unifiedScraperService.resolveStream(alId, epNum, audio, 'animegg'),
      unifiedScraperService.resolveStream(alId, epNum, audio, 'animeheaven'),
      unifiedScraperService.resolveStream(alId, epNum, audio, 'animepahe'),
      unifiedScraperService.resolveStream(alId, epNum, audio, 'anikoto'),
      unifiedScraperService.resolveStream(alId, epNum, audio, 'aniwaves'),
      unifiedScraperService.resolveStream(alId, epNum, audio, 'anichan'),
    ]);

    const addSources = (result: PromiseSettledResult<any>, serverName: string, formatName: string = 'MP4') => {
      if (result.status === 'fulfilled') {
        const sources = result.value.sources.filter((s: any) => (s.type === 'mp4' || s.url.includes('.mp4')) && !s.isBackup);
        for (const s of sources) {
          let quality = s.quality || '720p';
          if (quality === 'default') quality = 'HD (720p)';
          downloadResults.push({ server: serverName, quality, url: s.url, format: formatName });
        }
      }
    };

    addSources(ggResult, 'Holo');
    addSources(heavenResult, 'Kurisu');
    addSources(paheResult, 'Kwik');
    addSources(anikotoResult, 'Koto');
    addSources(aniwavesResult, 'Wave');
    addSources(anichanResult, 'Chan');

    // Remove duplicates based on URL
    const uniqueDownloads = Array.from(new Map(downloadResults.map(item => [item.url, item])).values());

    return {
      anilistId: alId,
      episode: epNum,
      downloads: uniqueDownloads,
    };
  });

  // GET /api/anime/search?query=naruto&provider=aniwaves
  fastify.get('/api/anime/search', async (request: FastifyRequest<{ Querystring: SearchQuery }>, reply) => {
    const { query, provider } = request.query;
    if (!query || query.trim().length === 0) {
      return reply.code(400).send({ error: 'Query parameter is required' });
    }

    if (provider) {
      const p = providerRegistry.getProvider(provider);
      if (!p) {
        return reply.code(404).send({ error: `Provider "${provider}" not found. Available: ${providerRegistry.getProviderNames().join(', ')}` });
      }
      try {
        const results = await p.search(query);
        return { provider: p.name, results };
      } catch (err: any) {
        request.log.error(err);
        return reply.code(502).send({ error: `Search failed on provider ${provider}: ${err.message}` });
      }
    }

    const allProviders = providerRegistry.getAllProviders();
    const settled = await Promise.allSettled(
      allProviders.map(async (p) => {
        const results = await p.search(query);
        return { provider: p.name, results };
      })
    );

    const successful = settled
      .filter((s): s is PromiseFulfilledResult<{ provider: string; results: any[] }> => s.status === 'fulfilled')
      .map((s) => s.value);

    return { results: successful };
  });

  // GET /api/anime/episodes?provider=anikoto&id=road-of-naruto-ggjw8
  fastify.get('/api/anime/episodes', async (request: FastifyRequest<{ Querystring: EpisodesQuery }>, reply) => {
    const { provider, id } = request.query;
    if (!provider || !id) {
      return reply.code(400).send({ error: 'Missing required query parameters: "provider" and "id"' });
    }

    const p = providerRegistry.getProvider(provider);
    if (!p) {
      return reply.code(404).send({ error: `Provider "${provider}" not found` });
    }

    try {
      const episodes = await p.getEpisodes(id);
      return { provider: p.name, animeId: id, totalEpisodes: episodes.length, episodes };
    } catch (err: any) {
      request.log.error(err);
      return reply.code(502).send({ error: `Failed to fetch episodes from ${provider}: ${err.message}` });
    }
  });

  // GET /api/anime/servers?provider=aniwaves&id=naruto-76396&episode=1
  fastify.get('/api/anime/servers', async (request: FastifyRequest<{ Querystring: ServersQuery }>, reply) => {
    const { provider, id, episode } = request.query;
    const epNum = parseInt(episode, 10);
    if (!provider || !id || isNaN(epNum)) {
      return reply.code(400).send({ error: 'Missing required query parameters: "provider", "id", and numeric "episode"' });
    }

    const p = providerRegistry.getProvider(provider);
    if (!p) {
      return reply.code(404).send({ error: `Provider "${provider}" not found` });
    }

    try {
      const servers = await p.getServers(id, epNum);
      return { provider: p.name, animeId: id, episode: epNum, servers };
    } catch (err: any) {
      request.log.error(err);
      return reply.code(502).send({ error: `Failed to fetch servers from ${provider}: ${err.message}` });
    }
  });

  // GET /api/anime/sources?provider=aniwaves&id=naruto-76396&episode=1&server=UWxwb...&subType=sub
  fastify.get('/api/anime/sources', async (request: FastifyRequest<{ Querystring: SourcesQuery }>, reply) => {
    const { provider, id, episode, server, subType = 'sub' } = request.query;
    const epNum = parseInt(episode, 10);
    if (!provider || !id || isNaN(epNum) || !server) {
      return reply.code(400).send({ error: 'Missing required query parameters: "provider", "id", "episode", and "server"' });
    }

    const p = providerRegistry.getProvider(provider);
    if (!p) {
      return reply.code(404).send({ error: `Provider "${provider}" not found` });
    }

    try {
      const sources = await p.getSources(id, epNum, server, subType);
      return sources;
    } catch (err: any) {
      request.log.error(err);
      return reply.code(502).send({ error: `Failed to resolve sources from ${provider}: ${err.message}` });
    }
  });

  // GET /api/schedule
  fastify.get('/api/schedule', async (request, reply) => {
    try {
      const timetable = await scheduleService.getTimetable();
      return timetable;
    } catch (err: any) {
      request.log.error(err);
      return reply.code(502).send({ error: `Failed to fetch timetable: ${err.message}` });
    }
  });

  // GET /api/schedule/seasonal
  fastify.get('/api/schedule/seasonal', async (request: FastifyRequest<{ Querystring: { season?: string } }>, reply) => {
    const season = request.query?.season || 'fall-2026';
    try {
      const seasonal = await scheduleService.getSeasonalSchedule(season);
      return seasonal;
    } catch (err: any) {
      request.log.error(err);
      return reply.code(502).send({ error: `Failed to fetch seasonal schedule: ${err.message}` });
    }
  });
}

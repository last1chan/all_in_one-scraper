import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { HttpClient } from '../../core/http-client.js';
import { extractorManager } from '../../extractors/index.js';
import { globalCache } from '../../core/cache.js';

interface AnimePaheSearchItem {
  id: number;
  title: string;
  type: string;
  episodes: number;
  status: string;
  season: string;
  year: number;
  score: number;
  poster: string;
  session: string;
}

interface AnimePaheReleaseItem {
  id: number;
  anime_id: number;
  episode: number;
  title: string;
  snapshot: string;
  duration: string;
  session: string;
  filler: number;
  created_at: string;
}

export class AnimePaheProvider extends BaseProvider {
  readonly name = 'animepahe';
  readonly defaultBaseUrl = 'https://animepahe.pw';
  readonly mirrorUrls = [
    'https://animepahe.pw',
    'https://animepahe.org',
    'https://animepahe.com',
  ];
  readonly isSelfHosted = true;
  readonly librarySize = '4,500+';
  readonly serverType = 'self-hosted' as const;
  readonly notes = 'Might require residential proxy to bypass Cloudflare protection';

  private clearanceCookie: string | null = null;
  private userAgent: string =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

  constructor() {
    super();
    this.init();
  }

  private async fetchPaheJson<T = any>(url: string): Promise<T> {
    const baseUrl = this.getBaseUrl();
    const cookie =
      this.clearanceCookie ||
      process.env.ANIMEPAHE_COOKIE ||
      process.env.CF_CLEARANCE ||
      '';

    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `${baseUrl}/`,
      ...(cookie ? { Cookie: cookie.startsWith('cf_clearance=') ? cookie : `cf_clearance=${cookie}` } : {}),
    };

    try {
      const res = await fetch(url, { headers });
      if (res.ok) {
        return (await res.json()) as T;
      }

      // If Cloudflare blocks (403) and FlareSolverr is available, try FlareSolverr
      const flaresolverrUrl = process.env.FLARESOLVERR_URL;
      if (res.status === 403 && flaresolverrUrl) {
        const fsRes = await fetch(flaresolverrUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cmd: 'request.get',
            url,
            userAgent: this.userAgent,
            maxTimeout: 30000,
          }),
        });

        if (fsRes.ok) {
          const fsData: any = await fsRes.json();
          if (fsData.status === 'ok') {
            const cookies = fsData.solution?.cookies || [];
            const cfClearance = cookies.find((c: any) => c.name === 'cf_clearance');
            if (cfClearance) {
              this.clearanceCookie = `cf_clearance=${cfClearance.value}`;
            }
            if (fsData.solution?.userAgent) {
              this.userAgent = fsData.solution.userAgent;
            }
            return JSON.parse(fsData.solution.response) as T;
          }
        }
      }

      if (res.status === 403) {
        throw new Error(
          `AnimePahe returned HTTP 403 (Cloudflare Turnstile). To bypass, provide ANIMEPAHE_COOKIE / CF_CLEARANCE in .env, or set FLARESOLVERR_URL.`
        );
      }

      throw new Error(`AnimePahe request to ${url} failed with HTTP ${res.status}`);
    } catch (err: any) {
      throw err;
    }
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<AnimeSearchResult[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/api?m=search&q=${encodeURIComponent(query)}`;
    const data = await this.fetchPaheJson<{ data?: AnimePaheSearchItem[] }>(url);

    const results: AnimeSearchResult[] = (data?.data || []).map((item) => ({
      id: String(item.id || item.session),
      title: item.title,
      poster: item.poster,
      type: item.type || 'TV',
      episodesCount: item.episodes,
      provider: this.name,
      url: `${baseUrl}/anime/${item.session}`,
    }));

    globalCache.set(cacheKey, results, 600);
    return results;
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    const cacheKey = this.getCacheKey('episodes', animeId);
    const cached = globalCache.get<Episode[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const episodes: Episode[] = [];
    let page = 1;
    let lastPage = 1;

    do {
      const url = `${baseUrl}/api?m=release&id=${animeId}&sort=episode_asc&page=${page}`;
      const res = await this.fetchPaheJson<any>(url);
      lastPage = res?.last_page || 1;
      const items: AnimePaheReleaseItem[] = res?.data || [];

      for (const item of items) {
        episodes.push({
          id: `${animeId}$${item.episode}$${item.session}`,
          number: item.episode,
          sourceNumber: item.session,
          title: item.title ? `Episode ${item.episode} - ${item.title}` : `Episode ${item.episode}`,
          filler: item.filler === 1,
          image: item.snapshot,
          hasSub: true,
          hasDub: true,
        });
      }

      page++;
    } while (page <= lastPage && page <= 10);

    episodes.sort((a, b) => a.number - b.number);
    globalCache.set(cacheKey, episodes, 1800);
    return episodes;
  }

  async getServers(animeId: string, episodeNumber: number): Promise<Server[]> {
    const episodes = await this.getEpisodes(animeId);
    const ep = episodes.find((e) => e.number === episodeNumber);
    if (!ep || !ep.sourceNumber) {
      throw new Error(`AnimePahe: Episode ${episodeNumber} not found for ${animeId}`);
    }

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/api?m=links&id=${animeId}&session=${ep.sourceNumber}&p=kwik`;
    const data = await this.fetchPaheJson<{ data?: any[] }>(url);

    const servers: Server[] = [];
    const items = data?.data || [];

    for (const group of items) {
      for (const [quality, linkObj] of Object.entries(group as Record<string, any>)) {
        if (linkObj && typeof linkObj === 'object' && linkObj.kwik) {
          const isDub = Boolean(linkObj.audio === 'eng' || linkObj.dub);
          servers.push({
            id: encodeURIComponent(linkObj.kwik),
            name: `Kwik (${quality}) ${isDub ? '[DUB]' : '[SUB]'}`,
            subType: isDub ? 'dub' : 'sub',
          });
        }
      }
    }

    if (servers.length === 0) {
      servers.push({
        id: ep.sourceNumber,
        name: 'AnimePahe Default (Kwik)',
        subType: 'sub',
      });
    }

    return servers;
  }

  async getSources(
    animeId: string,
    episodeNumber: number,
    serverId: string,
    subType: 'sub' | 'dub' = 'sub'
  ): Promise<StreamResolutionResult> {
    const cacheKey = this.getCacheKey('sources', animeId, episodeNumber, serverId, subType);
    const cached = globalCache.get<StreamResolutionResult>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    let kwikUrl = serverId.startsWith('http') ? serverId : decodeURIComponent(serverId);

    if (!kwikUrl.startsWith('http')) {
      const servers = await this.getServers(animeId, episodeNumber);
      const matched = servers.find((s) => s.subType === subType) || servers[0];
      if (matched && matched.id.startsWith('http')) {
        kwikUrl = decodeURIComponent(matched.id);
      }
    }

    const sources: VideoSource[] = [];
    try {
      const extracted = await extractorManager.extract(kwikUrl, `${baseUrl}/`);
      if (extracted && extracted.sources.length > 0) {
        sources.push(...extracted.sources);
      }
    } catch {
      sources.push({
        url: kwikUrl,
        type: 'embed',
        isM3U8: false,
      });
    }

    if (sources.length === 0) {
      sources.push({
        url: kwikUrl,
        type: 'embed',
        isM3U8: false,
      });
    }

    const result: StreamResolutionResult = {
      provider: this.name,
      animeId,
      episodeNumber,
      subType,
      server: 'Kwik',
      sources,
      subtitles: [],
      headers: {
        Referer: `${baseUrl}/`,
      },
      isDub: subType === 'dub',
    };

    globalCache.set(cacheKey, result, 900);
    return result;
  }
}

export const animePaheProvider = new AnimePaheProvider();

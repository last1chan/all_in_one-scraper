import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { HttpClient } from '../../core/http-client.js';
import { globalCache } from '../../core/cache.js';
import * as cheerio from 'cheerio';

export class AniHQProvider extends BaseProvider {
  readonly name = 'anihq';
  readonly defaultBaseUrl = 'https://anihq.cc';
  readonly mirrorUrls = [
    'https://anihq.cc',
    'https://anihq.to',
  ];

  constructor() {
    super();
    this.init();
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<AnimeSearchResult[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/search?s_keyword=${encodeURIComponent(query)}`;
    const html = await HttpClient.get(url, { referer: `${baseUrl}/` });

    const results: AnimeSearchResult[] = [];
    const seen = new Set<string>();

    const $ = cheerio.load(html);
    $('.film-item, .film-poster, .anime-card, .film-detail, a[href*="/watch/"]').each((_, el) => {
      const link = $(el).is('a') ? $(el) : $(el).find('a').first();
      const href = link.attr('href') || '';
      const slugMatch = href.match(/\/watch\/([a-zA-Z0-9_-]+)/i);
      if (!slugMatch) return;

      const rawSlug = slugMatch[1].replace(/-episode-\d+-(?:english-)?(?:subbed|dubbed)/i, '');
      if (seen.has(rawSlug)) return;
      seen.add(rawSlug);

      const title = link.attr('title') || link.text().trim() || rawSlug.replace(/-/g, ' ');
      const poster = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');

      results.push({
        id: rawSlug,
        title,
        poster,
        type: 'TV',
        provider: this.name,
        url: `${baseUrl}/watch/${rawSlug}-episode-1-english-subbed/`,
      });
    });

    globalCache.set(cacheKey, results, 600);
    return results;
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    const cacheKey = this.getCacheKey('episodes', animeId);
    const cached = globalCache.get<Episode[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/watch/${animeId}-episode-1-english-subbed/`;
    const html = await HttpClient.get(url, { referer: `${baseUrl}/` });

    const episodes: Episode[] = [];
    const seen = new Set<number>();

    const epRegex = /episode-(\d+)-(?:english-)?(subbed|dubbed)/gi;
    for (const match of html.matchAll(epRegex)) {
      const num = Number(match[1]);
      if (!Number.isFinite(num) || num < 1 || seen.has(num)) continue;
      seen.add(num);

      episodes.push({
        id: `${animeId}$${num}`,
        number: num,
        sourceNumber: String(num),
        title: `Episode ${num}`,
        hasSub: true,
        hasDub: true,
      });
    }

    if (episodes.length === 0) {
      episodes.push({
        id: `${animeId}$1`,
        number: 1,
        sourceNumber: '1',
        title: 'Episode 1',
        hasSub: true,
        hasDub: true,
      });
    }

    episodes.sort((a, b) => a.number - b.number);
    globalCache.set(cacheKey, episodes, 1800);
    return episodes;
  }

  async getServers(animeId: string, episodeNumber: number): Promise<Server[]> {
    return [
      { id: 'voe', name: 'VOE Server (SUB)', subType: 'sub' },
      { id: 'voe-dub', name: 'VOE Server (DUB)', subType: 'dub' },
    ];
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
    const mode = subType === 'dub' ? 'dubbed' : 'subbed';
    const epUrl = `${baseUrl}/watch/${animeId}-episode-${episodeNumber}-english-${mode}/`;

    let html = '';
    try {
      html = await HttpClient.get(epUrl, { referer: `${baseUrl}/` });
    } catch {
      // Fallback without "english-"
      const fallbackUrl = `${baseUrl}/watch/${animeId}-episode-${episodeNumber}-${mode}/`;
      html = await HttpClient.get(fallbackUrl, { referer: `${baseUrl}/` });
    }

    const $ = cheerio.load(html);
    const iframeUrl = $('iframe').attr('src');
    if (!iframeUrl) {
      throw new Error(`AniHQ: No video iframe found for ${animeId} ep ${episodeNumber}`);
    }

    const sources: VideoSource[] = [
      {
        url: iframeUrl,
        type: 'embed',
        isM3U8: false,
      },
    ];

    const result: StreamResolutionResult = {
      provider: this.name,
      animeId,
      episodeNumber,
      subType,
      server: 'VOE',
      sources,
      subtitles: [],
      headers: {
        Referer: epUrl,
      },
      isDub: subType === 'dub',
    };

    globalCache.set(cacheKey, result, 900);
    return result;
  }
}

export const aniHQProvider = new AniHQProvider();

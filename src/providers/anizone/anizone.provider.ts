import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { HttpClient } from '../../core/http-client.js';
import { globalCache } from '../../core/cache.js';
import * as cheerio from 'cheerio';

export class AniZoneProvider extends BaseProvider {
  readonly name = 'anizone';
  readonly defaultBaseUrl = 'https://anizone.to';
  readonly mirrorUrls = [
    'https://anizone.to',
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
    const url = `${baseUrl}/anime?keyword=${encodeURIComponent(query)}`;
    const html = await HttpClient.get(url, { referer: `${baseUrl}/` });

    const results: AnimeSearchResult[] = [];
    const seen = new Set<string>();

    const $ = cheerio.load(html);
    $('.film-name a, .item a, .flw-item a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const slugMatch = href.match(/\/watch\/([a-zA-Z0-9_-]+)/i) || href.match(/\/anime\/([a-zA-Z0-9_-]+)/i);
      if (!slugMatch) return;

      const slug = slugMatch[1];
      if (seen.has(slug)) return;
      seen.add(slug);

      const title = $(el).text().trim();
      if (!title) return;

      const poster = $(el).closest('.film-poster, .item, .flw-item').find('img').attr('data-src') ||
                     $(el).closest('.film-poster, .item, .flw-item').find('img').attr('src');

      results.push({
        id: slug,
        title,
        poster,
        type: 'TV',
        provider: this.name,
        url: `${baseUrl}/watch/${slug}`,
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
    const url = `${baseUrl}/watch/${animeId}`;
    const html = await HttpClient.get(url, { referer: `${baseUrl}/` });

    const episodes: Episode[] = [];
    const seen = new Set<number>();

    const epRegex = /data-number=['"](\d+)['"]|ep-(\d+)|episode-(\d+)/gi;
    for (const match of html.matchAll(epRegex)) {
      const num = Number(match[1] || match[2] || match[3]);
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
      { id: 'server-1', name: 'AniZone Vidstream (SUB)', subType: 'sub' },
      { id: 'server-1-dub', name: 'AniZone Vidstream (DUB)', subType: 'dub' },
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
    const epUrl = `${baseUrl}/watch/${animeId}/ep-${episodeNumber}`;
    const html = await HttpClient.get(epUrl, { referer: `${baseUrl}/` });
    const $ = cheerio.load(html);

    const iframe = $('iframe').attr('src') || '';
    const sources: VideoSource[] = [];

    if (iframe) {
      sources.push({
        url: iframe,
        type: 'embed',
        isM3U8: false,
      });
    } else {
      sources.push({
        url: epUrl,
        type: 'embed',
        isM3U8: false,
      });
    }

    const result: StreamResolutionResult = {
      provider: this.name,
      animeId,
      episodeNumber,
      subType,
      server: 'Vidstream',
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

export const aniZoneProvider = new AniZoneProvider();

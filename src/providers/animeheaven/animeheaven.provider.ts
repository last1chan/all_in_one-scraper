import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { HttpClient } from '../../core/http-client.js';
import { globalCache } from '../../core/cache.js';
import * as cheerio from 'cheerio';

export class AnimeHeavenProvider extends BaseProvider {
  readonly name = 'animeheaven';
  readonly defaultBaseUrl = 'https://animeheaven.me';
  readonly mirrorUrls = [
    'https://animeheaven.me',
    'https://animeheaven.ru',
  ];
  readonly isSelfHosted = true;
  readonly librarySize = '3,000+';
  readonly serverType = 'self-hosted' as const;

  constructor() {
    super();
    this.init();
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<AnimeSearchResult[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/search.php?s=${encodeURIComponent(query)}`;
    const html = await HttpClient.get(url, { referer: `${baseUrl}/` });

    const results: AnimeSearchResult[] = [];
    const map = new Map<string, { title: string; poster?: string }>();

    const $ = cheerio.load(html);
    $('a[href*="anime.php?"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const slugMatch = href.match(/anime\.php\?([a-zA-Z0-9_-]+)/i);
      if (!slugMatch) return;
      const slug = slugMatch[1];

      const current = map.get(slug) || { title: '' };
      const text = $(el).text().trim();
      if (text && text.length > current.title.length) {
        current.title = text;
      }
      const img = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');
      if (img) {
        current.poster = img.startsWith('http') ? img : `${baseUrl}/${img}`;
      }
      const alt = $(el).find('img').attr('alt');
      if (alt && alt.length > current.title.length) {
        current.title = alt;
      }
      map.set(slug, current);
    });

    for (const [slug, item] of map.entries()) {
      if (item.title) {
        results.push({
          id: slug,
          title: item.title,
          poster: item.poster,
          type: 'TV',
          provider: this.name,
          url: `${baseUrl}/anime.php?${slug}`,
        });
      }
    }

    globalCache.set(cacheKey, results, 600);
    return results;
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    const cacheKey = this.getCacheKey('episodes', animeId);
    const cached = globalCache.get<Episode[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/anime.php?${animeId}`;
    const html = await HttpClient.get(url, { referer: `${baseUrl}/` });

    const episodes: Episode[] = [];
    const seen = new Set<number>();
    const $ = cheerio.load(html);

    $('a[href*="gate.php"]').each((_, el) => {
      const onclick = $(el).attr('onclick') || '';
      const keyMatch = onclick.match(/gatea\(['"]([a-zA-Z0-9]+)['"]\)/i);
      const key = keyMatch ? keyMatch[1] : $(el).attr('id');
      const numText = $(el).find('.watch2').text().trim() || $(el).text().match(/Episode\s*(\d+)/i)?.[1];
      const num = Number(String(numText).replace(/\D/g, ''));
      if (key && Number.isFinite(num) && num >= 1 && !seen.has(num)) {
        seen.add(num);
        episodes.push({
          id: `${animeId}$${num}$${key}`,
          number: num,
          sourceNumber: key,
          title: `Episode ${num}`,
          hasSub: true,
          hasDub: false,
        });
      }
    });

    episodes.sort((a, b) => a.number - b.number);
    globalCache.set(cacheKey, episodes, 1800);
    return episodes;
  }

  async getServers(animeId: string, episodeNumber: number): Promise<Server[]> {
    const episodes = await this.getEpisodes(animeId);
    const ep = episodes.find((e) => e.number === episodeNumber);
    if (!ep || !ep.sourceNumber) {
      throw new Error(`AnimeHeaven: Episode ${episodeNumber} not found for ${animeId}`);
    }

    return [
      {
        id: ep.sourceNumber,
        name: 'AnimeHeaven MP4 Server',
        subType: 'sub',
      },
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
    const referer = `${baseUrl}/anime.php?${animeId}`;

    // Request gate.php with key cookie
    const html = await HttpClient.get(`${baseUrl}/gate.php`, {
      referer,
      headers: {
        Cookie: `key=${serverId}`,
      },
    });

    const sources: VideoSource[] = [];
    const $ = cheerio.load(html);

    $('video source').each((_, el) => {
      const src = $(el).attr('src');
      if (src && !sources.some((s) => s.url === src)) {
        sources.push({
          url: src,
          type: 'mp4',
          quality: 'default',
          isM3U8: false,
        });
      }
    });

    if (sources.length === 0) {
      const mp4Matches = html.match(/https?:\/\/[^"'\s]+\.mp4\?[^"'\s]*/gi) || [];
      for (const url of mp4Matches) {
        if (!sources.some((s) => s.url === url)) {
          sources.push({
            url,
            type: 'mp4',
            quality: 'default',
            isM3U8: false,
          });
        }
      }
    }

    if (sources.length === 0) {
      throw new Error(`AnimeHeaven: No MP4 video stream resolved for episode ${episodeNumber} (${serverId})`);
    }

    const result: StreamResolutionResult = {
      provider: this.name,
      animeId,
      episodeNumber,
      subType,
      server: serverId,
      sources,
      subtitles: [],
      headers: {
        Referer: `${baseUrl}/gate.php`,
      },
      mp4Sources: sources,
    };

    globalCache.set(cacheKey, result, 900);
    return result;
  }
}

export const animeHeavenProvider = new AnimeHeavenProvider();

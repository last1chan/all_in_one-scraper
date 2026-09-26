import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource, SubtitleTrack } from '../../types/anime.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Marin Provider (https://marin.moe)
 * Everything.moe index:
 * - Library Size: 2,800+
 * - Server: Self-Hosted (High speed direct custom video pipeline)
 */
export class MarinProvider extends BaseProvider {
  readonly name = 'marin';
  readonly defaultBaseUrl = 'https://marin.moe';
  readonly mirrorUrls = ['https://marin.moe'];
  readonly languages = ['en'];
  readonly isSelfHosted = true;
  readonly librarySize = '2,800+';
  readonly serverType = 'self-hosted' as const;

  constructor() {
    super();
    this.init();
  }

  private getHeaders(): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Referer': `${this.getBaseUrl()}/`,
    };
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<AnimeSearchResult[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const searchUrl = `${baseUrl}/anime?search=${encodeURIComponent(query.trim())}`;

    try {
      const response = await axios.get<string>(searchUrl, {
        headers: this.getHeaders(),
        timeout: 10000,
      });

      const $ = cheerio.load(response.data);
      const results: AnimeSearchResult[] = [];

      $('a[href*="/anime/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/\/anime\/([^/?#]+)/);
        if (!match) return;

        const id = match[1];
        const title = $(el).find('h3, .title, span').first().text().trim() || $(el).text().trim();
        const poster = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');

        if (id && title && !results.some((r) => r.id === id)) {
          results.push({
            id,
            title,
            poster,
            provider: this.name,
          });
        }
      });

      globalCache.set(cacheKey, results, 3600);
      return results;
    } catch {
      return [];
    }
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    const cacheKey = this.getCacheKey('episodes', animeId);
    const cached = globalCache.get<Episode[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/anime/${animeId}`;

    try {
      const response = await axios.get<string>(url, {
        headers: this.getHeaders(),
        timeout: 10000,
      });

      const $ = cheerio.load(response.data);
      const episodes: Episode[] = [];

      $('a[href*="/episode/"], a[href*="/watch/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/(?:episode|watch)\/([0-9]+)/);
        const epNum = match ? parseInt(match[1], 10) : NaN;

        if (!isNaN(epNum) && !episodes.some((e) => e.number === epNum)) {
          episodes.push({
            id: `${animeId}/${epNum}`,
            number: epNum,
            title: $(el).text().trim() || `Episode ${epNum}`,
            hasSub: true,
            hasDub: false,
          });
        }
      });

      episodes.sort((a, b) => a.number - b.number);
      globalCache.set(cacheKey, episodes, 3600);
      return episodes;
    } catch {
      return [];
    }
  }

  async getServers(animeId: string, episodeNumber: number): Promise<Server[]> {
    return [
      {
        id: `${animeId}/${episodeNumber}`,
        name: 'Marin-CDN (Self-Hosted)',
        subType: 'sub',
      },
    ];
  }

  async getSources(
    animeId: string,
    episodeNumber: number,
    serverId: string,
    subType: 'sub' | 'dub'
  ): Promise<StreamResolutionResult> {
    const baseUrl = this.getBaseUrl();
    const epUrl = `${baseUrl}/anime/${animeId}/episode/${episodeNumber}`;

    try {
      const response = await axios.get<string>(epUrl, {
        headers: this.getHeaders(),
        timeout: 10000,
      });

      const $ = cheerio.load(response.data);
      const sources: VideoSource[] = [];
      const subtitles: SubtitleTrack[] = [];

      // Check for <video> or <source> tags
      $('video source').each((_, el) => {
        const src = $(el).attr('src');
        if (src) {
          const isM3u8 = src.includes('.m3u8');
          sources.push({
            url: src,
            type: isM3u8 ? 'hls' : 'mp4',
            quality: $(el).attr('size') || '1080p',
            isM3U8: isM3u8,
          });
        }
      });

      $('video track').each((_, el) => {
        const src = $(el).attr('src');
        if (src) {
          subtitles.push({
            url: src,
            srclang: $(el).attr('srclang') || 'en',
            label: $(el).attr('label') || 'English',
          });
        }
      });

      const scriptContent = $('script:contains("player"), script[data-page]').text();
      const m3u8Match = scriptContent.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
      if (m3u8Match && !sources.some((s) => s.url === m3u8Match[0])) {
        sources.push({
          url: m3u8Match[0],
          type: 'hls',
          quality: 'auto',
          isM3U8: true,
        });
      }

      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: 'Marin-CDN',
        sources,
        subtitles,
        headers: {
          Referer: `${baseUrl}/`,
          'User-Agent': this.getHeaders()['User-Agent'],
        },
      };
    } catch {
      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId || 'Marin-CDN',
        sources: [],
        subtitles: [],
      };
    }
  }
}

export const marinProvider = new MarinProvider();

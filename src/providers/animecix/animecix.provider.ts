import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult } from '../../types/anime.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class AnimecixProvider extends BaseProvider {
  readonly name = 'Animecix';
  readonly defaultBaseUrl = 'https://animecix.tv';
  readonly mirrorUrls = ['https://animecix.tv', 'https://animecix.net', 'https://animecix.com'];
  readonly languages = ['tr'];
  readonly isSelfHosted = true;
  readonly librarySize = '2,200+';
  readonly serverType = 'self-hosted' as const;

  constructor() {
    super();
    this.init();
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': this.getBaseUrl() + '/',
    };

    const cookie = process.env.ANIMECIX_COOKIE;
    if (cookie) {
      headers['Cookie'] = cookie;
    }

    return headers;
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    try {
      // Animecix uses /secure/search or query search
      const url = `${this.getBaseUrl()}/secure/search/${encodeURIComponent(query.trim())}`;
      const response = await axios.get(url, {
        headers: this.getHeaders(),
        timeout: 10000,
        validateStatus: (status) => status < 500,
      });

      if (response.status === 403) {
        console.warn(
          '[Animecix] Cloudflare challenge encountered. Configure ANIMECIX_COOKIE in .env if bypassing is required.'
        );
        return [];
      }

      if (Array.isArray(response.data)) {
        return response.data.map((item: any) => ({
          id: String(item.id || item.slug || item.name_slug || item.title),
          title: item.title || item.name || item.original_title || query,
          poster: item.poster || item.cover || item.image || undefined,
          type: 'TV',
          episodesCount: item.episodes_count || 0,
          provider: this.name,
          url: `${this.getBaseUrl()}/titles/${item.slug || item.id}`,
        }));
      }

      // Fallback HTML parsing
      const $ = cheerio.load(response.data);
      const results: AnimeSearchResult[] = [];
      const seen = new Set<string>();

      $('a[href*="/titles/"], a[href*="/anime/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const title = $(el).find('h3, .title, .name').text().trim() || $(el).text().trim();
        const match = href.match(/\/(titles|anime)\/([a-zA-Z0-9_\-]+)/);
        if (match && match[2] && title.length > 1) {
          const id = match[2];
          if (!seen.has(id)) {
            seen.add(id);
            const poster = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');
            results.push({
              id,
              title: title.split('\n')[0].trim(),
              poster: poster ? (poster.startsWith('//') ? `https:${poster}` : poster) : undefined,
              type: 'TV',
              episodesCount: 0,
              provider: this.name,
              url: href.startsWith('http') ? href : `${this.getBaseUrl()}${href}`,
            });
          }
        }
      });

      return results;
    } catch (e: any) {
      console.error('Animecix search error:', e?.message || e);
      return [];
    }
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    try {
      const url = `${this.getBaseUrl()}/titles/${animeId}`;
      const response = await axios.get(url, {
        headers: this.getHeaders(),
        timeout: 10000,
        validateStatus: (status) => status < 500,
      });

      if (response.status === 403) {
        console.warn('[Animecix] Cloudflare challenge encountered on getEpisodes.');
        return [];
      }

      const $ = cheerio.load(response.data);
      const episodes: Episode[] = [];
      const seen = new Set<number>();

      $('a[href*="/bolum/"], a[href*="/episode/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/(\d+)-(?:bolum|episode)/i) || href.match(/\/(\d+)\/?$/);
        if (match && match[1]) {
          const num = parseInt(match[1], 10);
          if (!seen.has(num)) {
            seen.add(num);
            episodes.push({
              id: `${animeId}-${num}`,
              number: num,
              title: `${num}. Bölüm`,
              hasSub: true,
              hasDub: false,
            });
          }
        }
      });

      if (episodes.length === 0) {
        episodes.push({
          id: `${animeId}-1`,
          number: 1,
          title: '1. Bölüm',
          hasSub: true,
          hasDub: false,
        });
      }

      return episodes.sort((a, b) => a.number - b.number);
    } catch (e: any) {
      console.error('Animecix getEpisodes error:', e?.message || e);
      return [];
    }
  }

  async getServers(animeId: string, episodeNumber: number): Promise<Server[]> {
    return [
      {
        id: 'animecix-sub',
        name: 'Animecix (Türkçe Altyazı)',
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
    try {
      const epUrl = `${this.getBaseUrl()}/titles/${animeId}/season/1/episode/${episodeNumber}`;
      const response = await axios.get(epUrl, {
        headers: this.getHeaders(),
        timeout: 10000,
        validateStatus: (status) => status < 500,
      });

      if (response.status === 403) {
        console.warn('[Animecix] Cloudflare challenge encountered on getSources.');
      }

      const html = String(response.data);
      const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      let embedUrl = iframeMatch ? iframeMatch[1] : '';

      if (embedUrl && embedUrl.startsWith('//')) {
        embedUrl = `https:${embedUrl}`;
      }

      if (!embedUrl) {
        // Direct video source regex fallback
        const videoMatch = html.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
        if (videoMatch) {
          return {
            provider: this.name,
            animeId,
            episodeNumber,
            subType,
            server: serverId,
            sources: [
              {
                url: videoMatch[1],
                quality: 'auto',
                type: 'hls',
                isM3U8: true,
              },
            ],
            subtitles: [],
          };
        }
      }

      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId,
        sources: embedUrl
          ? [
              {
                url: embedUrl,
                quality: 'HD',
                type: 'embed',
                isM3U8: false,
              },
            ]
          : [],
        subtitles: [],
        headers: this.getHeaders(),
      };
    } catch (e: any) {
      console.error('Animecix getSources error:', e?.message || e);
      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId,
        sources: [],
        subtitles: [],
      };
    }
  }
}

export const animecixProvider = new AnimecixProvider();

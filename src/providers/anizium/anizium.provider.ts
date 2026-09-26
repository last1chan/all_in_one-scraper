import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult } from '../../types/anime.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class AniziumProvider extends BaseProvider {
  readonly name = 'Anizium';
  readonly defaultBaseUrl = 'https://anizium.com';
  readonly mirrorUrls = ['https://anizium.com', 'https://anizium.net', 'https://anizium.tv'];
  readonly languages = ['tr'];

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

    const cookie = process.env.ANIZIUM_COOKIE;
    if (cookie) {
      headers['Cookie'] = cookie;
    }

    return headers;
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    try {
      const cookie = process.env.ANIZIUM_COOKIE;
      if (!cookie) {
        console.info(
          '[Anizium] Notice: Anizium requires a premium subscription. Set ANIZIUM_COOKIE in .env to authenticate.'
        );
      }

      const response = await axios.get(`${this.getBaseUrl()}/arama`, {
        params: { q: query.trim() },
        headers: this.getHeaders(),
        timeout: 10000,
        validateStatus: (status) => status < 500,
      });

      if (response.status === 403) {
        console.warn(
          '[Anizium] Cloudflare challenge or premium access required (HTTP 403). Configure ANIZIUM_COOKIE in .env.'
        );
        return [];
      }

      const $ = cheerio.load(response.data);
      const results: AnimeSearchResult[] = [];
      const seen = new Set<string>();

      $('a[href*="/anime/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const title = $(el).find('h3, .title, .card-title').text().trim() || $(el).text().trim();
        const match = href.match(/\/anime\/([a-zA-Z0-9_\-]+)/);
        if (match && match[1] && title.length > 1) {
          const id = match[1];
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
      console.error('Anizium search error:', e?.message || e);
      return [];
    }
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    try {
      const response = await axios.get(`${this.getBaseUrl()}/anime/${animeId}`, {
        headers: this.getHeaders(),
        timeout: 10000,
        validateStatus: (status) => status < 500,
      });

      if (response.status === 403) {
        console.warn('[Anizium] Cloudflare challenge or premium required on getEpisodes.');
        return [];
      }

      const $ = cheerio.load(response.data);
      const episodes: Episode[] = [];
      const seen = new Set<number>();

      $('a[href*="-bolum"], a[href*="/bolum/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/(\d+)-bolum/i) || href.match(/\/(\d+)\/?$/);
        if (match && match[1]) {
          const num = parseInt(match[1], 10);
          if (!seen.has(num)) {
            seen.add(num);
            episodes.push({
              id: `${animeId}-${num}`,
              number: num,
              title: `${num}. Bölüm (Premium)`,
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
          title: '1. Bölüm (Premium)',
          hasSub: true,
          hasDub: false,
        });
      }

      return episodes.sort((a, b) => a.number - b.number);
    } catch (e: any) {
      console.error('Anizium getEpisodes error:', e?.message || e);
      return [];
    }
  }

  async getServers(animeId: string, episodeNumber: number): Promise<Server[]> {
    return [
      {
        id: 'anizium-premium',
        name: 'Anizium Premium (1080p)',
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
      const epUrl = `${this.getBaseUrl()}/anime/${animeId}/${episodeNumber}-bolum`;
      const response = await axios.get(epUrl, {
        headers: this.getHeaders(),
        timeout: 10000,
        validateStatus: (status) => status < 500,
      });

      const html = String(response.data);
      const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      let embedUrl = iframeMatch ? iframeMatch[1] : '';

      if (embedUrl && embedUrl.startsWith('//')) {
        embedUrl = `https:${embedUrl}`;
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
                quality: '1080p',
                type: 'embed',
                isM3U8: false,
              },
            ]
          : [],
        subtitles: [],
        headers: this.getHeaders(),
      };
    } catch (e: any) {
      console.error('Anizium getSources error:', e?.message || e);
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

export const aniziumProvider = new AniziumProvider();

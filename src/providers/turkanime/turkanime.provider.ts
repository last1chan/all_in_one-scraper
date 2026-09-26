import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult } from '../../types/anime.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class TurkAnimeProvider extends BaseProvider {
  readonly name = 'TurkAnime';
  readonly defaultBaseUrl = 'https://turkanime.net';
  readonly mirrorUrls = ['https://turkanime.net', 'https://www.turkanime.tv'];
  readonly languages = ['tr'];

  constructor() {
    super();
    this.init();
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    try {
      const response = await axios.get(`${this.getBaseUrl()}/arama`, {
        params: { arama: query.trim() },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      const results: AnimeSearchResult[] = [];
      const seen = new Set<string>();

      $('a[href*="/anime/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const title = $(el).find('h3, .panel-title, .title').text().trim() || $(el).text().trim();
        const match = href.match(/\/anime\/([a-zA-Z0-9_\-]+)\/?$/);
        if (match && match[1] && title.length > 2) {
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
              url: href.startsWith('//') ? `https:${href}` : href,
            });
          }
        }
      });

      return results;
    } catch (e: any) {
      console.error('TurkAnime search failed:', e?.message || e);
      return [];
    }
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    try {
      const response = await axios.get(`https://www.turkanime.tv/anime/${animeId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      const episodes: Episode[] = [];
      const seen = new Set<number>();

      $('a[href*="/video/' + animeId + '-"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const m = href.match(new RegExp(`${animeId}-(\\d+)-bolum`));
        if (m && m[1]) {
          const num = parseInt(m[1], 10);
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

      // If episode list is loaded via pagination or 1st episode fallback
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
      console.error('TurkAnime getEpisodes failed:', e?.message || e);
      return [];
    }
  }

  async getServers(animeId: string, episodeNumber: number): Promise<Server[]> {
    return [
      {
        id: 'turkanime-sub',
        name: 'TurkAnime (TR Altyazı)',
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
      const epUrl = `https://www.turkanime.tv/video/${animeId}-${episodeNumber}-bolum`;
      const response = await axios.get(epUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 15000,
      });

      const html = response.data;
      
      // Look for IndexIcerik videosec call
      const videosecMatch = html.match(/IndexIcerik\(['"](ajax\/videosec[^'"]+)['"]/);
      let embedUrl = '';

      if (videosecMatch && videosecMatch[1]) {
        const videosecUrl = `https://www.turkanime.tv/${videosecMatch[1]}`;
        const secRes = await axios.get(videosecUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': epUrl,
          },
          timeout: 15000,
        });

        const secHtml = secRes.data;
        const iframeMatch = secHtml.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        if (iframeMatch && iframeMatch[1]) {
          embedUrl = iframeMatch[1].startsWith('//') ? `https:${iframeMatch[1]}` : iframeMatch[1];
        }
      }

      if (!embedUrl) {
        // Fallback to any iframe on the page
        const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        if (iframeMatch && iframeMatch[1]) {
          embedUrl = iframeMatch[1].startsWith('//') ? `https:${iframeMatch[1]}` : iframeMatch[1];
        }
      }

      if (!embedUrl) {
        throw new Error('Could not find video player for TurkAnime');
      }

      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId,
        sources: [
          {
            url: embedUrl,
            quality: 'HD',
            type: 'embed',
            isM3U8: false,
          },
        ],
        subtitles: [],
        intro: null,
        outro: null,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': 'https://www.turkanime.tv/',
        },
      };
    } catch (e: any) {
      console.error('TurkAnime getSources failed:', e?.message || e);
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

export const turkAnimeProvider = new TurkAnimeProvider();

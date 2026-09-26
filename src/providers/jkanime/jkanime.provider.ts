import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult } from '../../types/anime.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class JKAnimeProvider extends BaseProvider {
  readonly name = 'JKAnime';
  readonly defaultBaseUrl = 'https://jkanime.net';
  readonly mirrorUrls = ['https://jkanime.net'];
  readonly languages = ['es'];

  constructor() {
    super();
    this.init();
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    try {
      const cleanQuery = encodeURIComponent(query.trim().toLowerCase());
      const response = await axios.get(`${this.getBaseUrl()}/buscar/${cleanQuery}/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 8000,
      });

      const $ = cheerio.load(response.data);
      const results: AnimeSearchResult[] = [];
      const seen = new Set<string>();

      $('.anime__item').each((_, el) => {
        const a = $(el).find('a').first();
        const href = a.attr('href') || '';
        const title = $(el).find('h5').text().trim() || a.text().trim();
        const poster = $(el).find('.anime__item__pic').attr('data-setbg') || $(el).find('img').attr('src');

        const match = href.match(/jkanime\.net\/([^\/]+)\/?$/);
        if (match && match[1]) {
          const id = match[1];
          if (!seen.has(id)) {
            seen.add(id);
            results.push({
              id,
              title,
              poster: poster || `https://cdn.jkdesa.com/assets/images/animes/image/${id}.jpg`,
              type: 'TV',
              episodesCount: 0,
              provider: this.name,
              url: href,
            });
          }
        }
      });

      return results;
    } catch (e: any) {
      console.error('JKAnime search failed:', e?.message || e);
      return [];
    }
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    try {
      const response = await axios.get(`${this.getBaseUrl()}/${animeId}/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 8000,
      });

      const html = response.data;
      const $ = cheerio.load(html);
      
      let maxEp = 1;
      const epLinks = $('a[href*="' + animeId + '/"]');
      epLinks.each((_, el) => {
        const href = $(el).attr('href') || '';
        const m = href.match(new RegExp(`${animeId}/(\\d+)`));
        if (m && m[1]) {
          const num = parseInt(m[1], 10);
          if (num > maxEp) maxEp = num;
        }
      });

      const epScriptMatch = html.match(/href="https:\/\/jkanime\.net\/[^\/]+\/(\d+)\/"/g);
      if (epScriptMatch && Array.isArray(epScriptMatch)) {
        for (const str of epScriptMatch) {
          const m = str.match(/\/(\d+)\//);
          if (m && m[1]) {
            const num = parseInt(m[1], 10);
            if (num > maxEp) maxEp = num;
          }
        }
      }

      const episodes: Episode[] = [];
      for (let i = 1; i <= maxEp; i++) {
        episodes.push({
          id: `${animeId}-${i}`,
          number: i,
          title: `Episodio ${i}`,
          hasSub: true,
          hasDub: false,
        });
      }
      return episodes;
    } catch (e: any) {
      console.error('JKAnime getEpisodes failed:', e?.message || e);
      return [];
    }
  }

  async getServers(animeId: string, episodeNumber: number): Promise<Server[]> {
    return [
      {
        id: 'jkanime-sub',
        name: 'JKAnime (ES Sub)',
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
      const epUrl = `${this.getBaseUrl()}/${animeId}/${episodeNumber}/`;
      const response = await axios.get(epUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 8000,
      });

      const html = response.data;
      // Extract video[0] or any jkplayer iframe
      const playerMatch = html.match(/src=["'](https:\/\/jkanime\.net\/jkplayer\/[^"']+)["']/i);
      if (!playerMatch || !playerMatch[1]) {
        throw new Error('No JKPlayer iframe found in episode page');
      }

      const playerUrl = playerMatch[1];
      const playerRes = await axios.get(playerUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': epUrl,
        },
        timeout: 8000,
      });

      const playerHtml = playerRes.data;
      
      // Look for base64 encoded m3u8 inside atob(...) or direct m3u8
      let m3u8Url = '';
      const atobMatch = playerHtml.match(/url:\s*atob\(['"]([^'"]+)['"]\)/);
      if (atobMatch && atobMatch[1]) {
        m3u8Url = Buffer.from(atobMatch[1], 'base64').toString('utf-8');
      } else {
        const directMatch = playerHtml.match(/hls\.loadSource\(\s*['"]([^'"]+\.m3u8[^'"]*)['"]\)/i) ||
                            playerHtml.match(/url:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
        if (directMatch && directMatch[1]) {
          m3u8Url = directMatch[1];
        }
      }

      if (!m3u8Url) {
        throw new Error('Could not extract HLS stream from JKPlayer');
      }

      // Extract opening skip times if available
      let intro = null;
      const opMatch = playerHtml.match(/let\s+op_data\s*=\s*(\{[^;]+\});/);
      if (opMatch && opMatch[1]) {
        try {
          const opData = JSON.parse(opMatch[1]);
          if (opData?.op?.s != null && opData?.op?.e != null) {
            intro = { start: Math.round(opData.op.s), end: Math.round(opData.op.e) };
          }
        } catch {}
      }

      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId,
        sources: [
          {
            url: m3u8Url,
            quality: 'HD (1080p)',
            type: 'hls',
            isM3U8: true,
          },
        ],
        subtitles: [],
        intro,
        outro: null,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': 'https://jkanime.net/',
          'Origin': 'https://jkanime.net',
        },
      };
    } catch (e: any) {
      console.error('JKAnime getSources failed:', e?.message || e);
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

export const jkAnimeProvider = new JKAnimeProvider();

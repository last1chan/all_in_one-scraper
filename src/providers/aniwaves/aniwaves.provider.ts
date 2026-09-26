import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { HttpClient } from '../../core/http-client.js';
import { extractorManager } from '../../extractors/index.js';
import { globalCache } from '../../core/cache.js';
import * as cheerio from 'cheerio';

interface AniWavesSeriesMeta {
  slug: string;
  siteId: string;
  title: string;
}

export class AniWavesProvider extends BaseProvider {
  readonly name = 'aniwaves';
  readonly defaultBaseUrl = 'https://aniwaves.ru';
  readonly mirrorUrls = [
    'https://aniwaves.ru',
    'https://aniwaves.to',
    'https://aniwave.to',
  ];
  readonly librarySize = '10,000+';
  readonly serverType = 'third-party' as const;

  constructor() {
    super();
    this.init();
  }

  private parseSiteId(slug: string): string {
    const match = slug.match(/-(\d+)$/);
    if (!match) {
      throw new Error(`AniWaves: Could not extract siteId from slug: ${slug}`);
    }
    return match[1];
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<AnimeSearchResult[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/filter?keyword=${encodeURIComponent(query)}`;
    const html = await HttpClient.get(url, { referer: `${baseUrl}/` });

    const results: AnimeSearchResult[] = [];
    const seen = new Set<string>();

    const $ = cheerio.load(html);
    $('.item, .flw-item').each((_, el) => {
      const link = $(el).find('a.name.d-title, a.film-name, .inner > a');
      const href = link.attr('href') || '';
      const slugMatch = href.match(/\/watch\/([a-z0-9-]+)/i);
      if (!slugMatch) return;

      const slug = slugMatch[1];
      if (seen.has(slug)) return;
      seen.add(slug);

      const title = link.text().trim() || $(el).find('.d-title').text().trim();
      const jpTitle = link.attr('data-jp') || undefined;
      const poster = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');
      const type = $(el).find('.type').text().trim() || 'TV';

      results.push({
        id: slug,
        title,
        japaneseTitle: jpTitle,
        poster,
        type,
        provider: this.name,
        url: `${baseUrl}/watch/${slug}`,
      });
    });

    if (results.length === 0) {
      const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
      for (const match of html.matchAll(re)) {
        const tag = match[1];
        if (!/class=["'][^"']*\bname\b[^"']*\bd-title\b/i.test(tag)) continue;
        const href = tag.match(/href=["']([^"']*)["']/i)?.[1];
        const slug = href?.match(/^\/watch\/([a-z0-9-]+)$/i)?.[1];
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);

        const jp = tag.match(/data-jp=["']([^"']*)["']/i)?.[1];
        const title = match[2].replace(/<[^>]*>/g, '').trim();

        results.push({
          id: slug,
          title,
          japaneseTitle: jp || undefined,
          provider: this.name,
          url: `${baseUrl}/watch/${slug}`,
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
    const siteId = this.parseSiteId(animeId);
    const response = await HttpClient.getJson<any>(
      `${baseUrl}/ajax/episode/list/${siteId}?vrf=`,
      {
        referer: `${baseUrl}/watch/${animeId}`,
        isAjax: true,
      }
    );

    const html = response?.result || '';
    const episodes: Episode[] = [];
    const seen = new Set<number>();

    const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(re)) {
      const attrs = match[1];
      const getAttr = (name: string) => {
        const m = attrs.match(new RegExp(`\\bdata-${name}=["']([^"']*)["']`, 'i'));
        return m ? m[1] : '';
      };

      const num = Number(getAttr('num'));
      if (!Number.isFinite(num) || num < 1 || seen.has(num)) continue;
      seen.add(num);

      const title = match[2].replace(/<[^>]*>/g, '').replace(/^\d+\s*/, '').trim() || `Episode ${num}`;
      const hasSub = getAttr('sub') === '1';
      const hasDub = getAttr('dub') === '1';
      const sourceNumber = getAttr('slug') || String(num);

      episodes.push({
        id: `${animeId}$${num}`,
        number: num,
        sourceNumber,
        title,
        hasSub,
        hasDub,
        filler: getAttr('filler') === '1',
        recap: getAttr('recap') === '1',
      });
    }

    episodes.sort((a, b) => a.number - b.number);
    globalCache.set(cacheKey, episodes, 1800);
    return episodes;
  }

  async getServers(animeId: string, episodeNumber: number): Promise<Server[]> {
    const cacheKey = this.getCacheKey('servers', animeId, episodeNumber);
    const cached = globalCache.get<Server[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const siteId = this.parseSiteId(animeId);
    const response = await HttpClient.getJson<any>(
      `${baseUrl}/ajax/server/list?servers=${encodeURIComponent(siteId)}&eps=${encodeURIComponent(episodeNumber)}`,
      {
        referer: `${baseUrl}/watch/${animeId}/ep-${episodeNumber}`,
        isAjax: true,
      }
    );

    const html = response?.result || '';
    const servers: Server[] = [];

    const markers = [...html.matchAll(/<div\b([^>]*)>/gi)]
      .map((match) => {
        const attrs = match[1];
        const typeMatch = attrs.match(/\bdata-type=["']([^"']*)["']/i);
        return { index: match.index ?? 0, type: typeMatch ? typeMatch[1] : '' };
      })
      .filter((item) => item.type === 'sub' || item.type === 'dub');

    for (let i = 0; i < markers.length; i++) {
      const current = markers[i];
      const end = markers[i + 1]?.index ?? html.length;
      const segment = html.slice(current.index, end);

      for (const match of segment.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)) {
        const attrs = match[1];
        const linkId = attrs.match(/\bdata-link-id=["']([^"']*)["']/i)?.[1];
        const serverId = attrs.match(/\bdata-sv-id=["']([^"']*)["']/i)?.[1] || null;
        const name = match[2].replace(/<[^>]*>/g, '').trim() || 'AniWaves Server';

        if (linkId) {
          servers.push({
            id: linkId,
            name,
            serverId,
            subType: current.type as 'sub' | 'dub',
          });
        }
      }
    }

    globalCache.set(cacheKey, servers, 600);
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
    const referer = `${baseUrl}/watch/${animeId}/ep-${episodeNumber}`;
    const response = await HttpClient.getJson<any>(
      `${baseUrl}/ajax/sources?id=${encodeURIComponent(serverId)}&asi=0&autoPlay=0`,
      {
        referer,
        isAjax: true,
      }
    );

    const embedUrl = response?.result?.url;
    if (!embedUrl) {
      throw new Error(`AniWaves: No embed URL in source response for link: ${serverId}`);
    }

    const sources: VideoSource[] = [];
    let subtitles: any[] = [];
    let intro = null;
    let outro = null;

    const skip = response.result?.skip_data || {};
    if (Array.isArray(skip.intro) && skip.intro.length >= 2) {
      intro = { start: Number(skip.intro[0]) || 0, end: Number(skip.intro[1]) || 0 };
    }
    if (Array.isArray(skip.outro) && skip.outro.length >= 2) {
      outro = { start: Number(skip.outro[0]) || 0, end: Number(skip.outro[1]) || 0 };
    }

    try {
      const extracted = await extractorManager.extract(embedUrl, referer);
      if (extracted) {
        sources.push(...extracted.sources);
        subtitles.push(...extracted.subtitles);
        if (!intro && extracted.intro) intro = extracted.intro;
        if (!outro && extracted.outro) outro = extracted.outro;
      }
    } catch (err: any) {
      sources.push({
        url: embedUrl,
        type: 'embed',
        isM3U8: false,
      });
    }

    if (sources.length === 0) {
      sources.push({
        url: embedUrl,
        type: 'embed',
        isM3U8: false,
      });
    }

    const result: StreamResolutionResult = {
      provider: this.name,
      animeId,
      episodeNumber,
      subType,
      server: serverId,
      sources,
      subtitles,
      intro,
      outro,
      headers: {
        Referer: referer,
      },
    };

    globalCache.set(cacheKey, result, 900);
    return result;
  }
}

export const aniWavesProvider = new AniWavesProvider();

import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { HttpClient } from '../../core/http-client.js';
import { extractorManager } from '../../extractors/index.js';
import { globalCache } from '../../core/cache.js';
import * as cheerio from 'cheerio';

interface AnikotoEpisodeCacheData {
  showId: string;
  slug: string;
  episodesMap: Map<number, { ids: string; mal?: string; slug?: string; timestamp?: string }>;
}

export class AnikotoProvider extends BaseProvider {
  readonly name = 'anikoto';
  readonly defaultBaseUrl = 'https://anikototv.to';
  readonly mirrorUrls = [
    'https://anikototv.to',
    'https://anikoto.tv',
    'https://anikoto.net',
    'https://anikoto.cz',
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
    const url = `${baseUrl}/filter?keyword=${encodeURIComponent(query)}`;
    const html = await HttpClient.get(url, { referer: `${baseUrl}/` });

    const results: AnimeSearchResult[] = [];
    const seenSlugs = new Set<string>();

    const $ = cheerio.load(html);
    $('.film_list-wrap .flw-item').each((_, el) => {
      const titleEl = $(el).find('.film-name a, .name.d-title');
      const href = titleEl.attr('href') || '';
      const match = href.match(/\/watch\/([^"/]+)/);
      if (!match) return;

      const fullSlug = match[1];
      const cleanSlug = fullSlug.replace(/\/ep-\d+$/, '');
      if (seenSlugs.has(cleanSlug)) return;
      seenSlugs.add(cleanSlug);

      const title = titleEl.text().trim();
      const jpTitle = titleEl.attr('data-jp') || undefined;
      const poster = $(el).find('.film-poster img').attr('data-src') || $(el).find('.film-poster img').attr('src');
      const type = $(el).find('.fdi-item').first().text().trim() || 'TV';

      results.push({
        id: cleanSlug,
        title,
        japaneseTitle: jpTitle,
        poster,
        type,
        provider: this.name,
        url: `${baseUrl}/watch/${cleanSlug}`,
      });
    });

    // Fallback regex if selector differs
    if (results.length === 0) {
      const re = /<a\s+class="name d-title"\s+href="https?:\/\/[^/]+\/watch\/([^"/]+)(?:\/ep-\d+)?"[^>]*data-jp="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        const slug = m[1];
        if (seenSlugs.has(slug)) continue;
        seenSlugs.add(slug);
        results.push({
          id: slug,
          title: m[3].replace(/<[^>]*>/g, '').trim(),
          japaneseTitle: m[2].trim() || undefined,
          provider: this.name,
          url: `${baseUrl}/watch/${slug}`,
        });
      }
    }

    globalCache.set(cacheKey, results, 600);
    return results;
  }

  private async getShowData(slug: string): Promise<AnikotoEpisodeCacheData> {
    const cacheKey = this.getCacheKey('showData', slug);
    const cached = globalCache.get<AnikotoEpisodeCacheData>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const watchUrl = `${baseUrl}/watch/${slug}`;
    const html = await HttpClient.get(watchUrl, { referer: `${baseUrl}/` });

    const showIdMatch = html.match(/data-id="(\d+)"/);
    if (!showIdMatch) {
      throw new Error(`Anikoto: Could not resolve show ID for anime: ${slug}`);
    }

    const showId = showIdMatch[1];
    const epListJson = await HttpClient.getJson<any>(`${baseUrl}/ajax/episode/list/${showId}`, {
      referer: watchUrl,
      isAjax: true,
    });

    const epHtml = epListJson?.result || '';
    const episodesMap = new Map<number, { ids: string; mal?: string; slug?: string; timestamp?: string }>();

    const re = /<a\s+[^>]*data-id="([^"]*)"[^>]*>/g;
    let m;
    while ((m = re.exec(epHtml)) !== null) {
      const tag = m[0];
      const getAttr = (attr: string) => {
        const x = tag.match(new RegExp(`data-${attr}="([^"]*)"`));
        return x ? x[1] : '';
      };
      const num = parseInt(getAttr('num'), 10);
      const ids = getAttr('ids');
      if (!isNaN(num) && ids) {
        episodesMap.set(num, {
          ids,
          mal: getAttr('mal'),
          slug: getAttr('slug'),
          timestamp: getAttr('timestamp'),
        });
      }
    }

    const data: AnikotoEpisodeCacheData = { showId, slug, episodesMap };
    globalCache.set(cacheKey, data, 1800);
    return data;
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    const cacheKey = this.getCacheKey('episodes', animeId);
    const cached = globalCache.get<Episode[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const showData = await this.getShowData(animeId);
    const epListJson = await HttpClient.getJson<any>(`${baseUrl}/ajax/episode/list/${showData.showId}`, {
      referer: `${baseUrl}/watch/${animeId}`,
      isAjax: true,
    });

    const html = epListJson?.result || '';
    const episodes: Episode[] = [];
    const seen = new Set<number>();

    const re = /<a\s+[^>]*data-id="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const tag = m[0];
      const inner = m[2];
      const getAttr = (attr: string) => {
        const x = tag.match(new RegExp(`data-${attr}="([^"]*)"`));
        return x ? x[1] : '';
      };

      const num = parseInt(getAttr('num'), 10);
      if (isNaN(num) || seen.has(num)) continue;
      seen.add(num);

      const titleMatch = inner.match(/<span class="d-title"[^>]*>([\s\S]*?)<\/span>/);
      const epTitle = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : `Episode ${num}`;

      episodes.push({
        id: `${animeId}$${num}`,
        number: num,
        title: epTitle,
        hasSub: getAttr('sub') === '1',
        hasDub: getAttr('dub') === '1',
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
    const showData = await this.getShowData(animeId);
    const epData = showData.episodesMap.get(episodeNumber);

    if (!epData || !epData.ids) {
      throw new Error(`Anikoto: Episode ${episodeNumber} data not found for ${animeId}`);
    }

    const serverData = await HttpClient.getJson<any>(
      `${baseUrl}/ajax/server/list?servers=${encodeURIComponent(epData.ids)}`,
      {
        referer: `${baseUrl}/`,
        isAjax: true,
      }
    );

    const html = serverData?.result || '';
    const servers: Server[] = [];

    const typeRe = /<div class="type" data-type="([^"]+)">([\s\S]*?)<\/ul>\s*<\/div>/g;
    let typeM;
    while ((typeM = typeRe.exec(html)) !== null) {
      const typeName = typeM[1]; // sub, dub, dl
      if (typeName !== 'sub' && typeName !== 'dub') continue;

      for (const li of typeM[2].matchAll(/<li\s+([^>]*data-link-id[^>]*)>([\s\S]*?)<\/li>/g)) {
        const linkId = li[1].match(/data-link-id="([^"]+)"/)?.[1];
        const serverId = li[1].match(/data-sv-id="([^"]+)"/)?.[1] || null;
        const name = li[2].replace(/<[^>]+>/g, '').trim();

        if (linkId) {
          servers.push({
            id: linkId,
            name,
            serverId,
            subType: typeName as 'sub' | 'dub',
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
    const resolved = serverId.startsWith('http')
      ? { result: { url: serverId } }
      : await HttpClient.getJson<any>(`${baseUrl}/ajax/server?get=${encodeURIComponent(serverId)}`, {
          referer: `${baseUrl}/`,
          isAjax: true,
        });

    const embedUrl = resolved?.result?.url;
    if (!embedUrl) {
      throw new Error(`Anikoto: Unable to resolve server embed URL for ${serverId}`);
    }

    const sources: VideoSource[] = [];
    let subtitles: any[] = [];
    let intro = null;
    let outro = null;

    if (resolved?.result?.skip_data?.intro?.length === 2) {
      const [s, e] = resolved.result.skip_data.intro;
      if (s || e) intro = { start: Number(s) || 0, end: Number(e) || 0 };
    }
    if (resolved?.result?.skip_data?.outro?.length === 2) {
      const [s, e] = resolved.result.skip_data.outro;
      if (s || e) outro = { start: Number(s) || 0, end: Number(e) || 0 };
    }

    // Direct base64 m3u8 embedded in hash
    if (embedUrl.includes('#aHR0c')) {
      const b64 = embedUrl.split('#')[1];
      try {
        const decoded = Buffer.from(b64, 'base64').toString('utf8');
        if (decoded.includes('.m3u8')) {
          sources.push({ url: decoded, type: 'hls', isM3U8: true });
        }
      } catch {}
    }

    // Use extractor manager
    try {
      const extracted = await extractorManager.extract(embedUrl, 'https://hianimes.re/');
      if (extracted) {
        sources.push(...extracted.sources);
        subtitles.push(...extracted.subtitles);
        if (!intro && extracted.intro) intro = extracted.intro;
        if (!outro && extracted.outro) outro = extracted.outro;
      }
    } catch (err: any) {
      // If extractor fails, push fallback embed source
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
        Referer: `${baseUrl}/`,
      },
    };

    globalCache.set(cacheKey, result, 900);
    return result;
  }
}

export const anikotoProvider = new AnikotoProvider();

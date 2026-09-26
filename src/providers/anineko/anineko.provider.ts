import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource, SubtitleTrack } from '../../types/anime.js';
import { HttpClient } from '../../core/http-client.js';
import { globalCache } from '../../core/cache.js';
import * as cheerio from 'cheerio';

export class AniNekoProvider extends BaseProvider {
  readonly name = 'anineko';
  readonly defaultBaseUrl = 'https://anineko.to';
  readonly mirrorUrls = [
    'https://anineko.to',
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
    const url = `${baseUrl}/browser?keyword=${encodeURIComponent(query)}`;
    const html = await HttpClient.get(url, { referer: `${baseUrl}/` });

    const results: AnimeSearchResult[] = [];
    const seen = new Set<string>();

    const $ = cheerio.load(html);
    $('a[href^="/watch/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const slugMatch = href.match(/^\/watch\/([a-zA-Z0-9_-]+)$/i);
      if (!slugMatch) return;

      const slug = slugMatch[1];
      if (seen.has(slug)) return;
      seen.add(slug);

      const title = $(el).find('.title, h3, h2').text().trim() ||
                    $(el).attr('title') ||
                    slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const poster = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');
      const type = $(el).find('.type, .badge').text().trim() || 'TV';

      results.push({
        id: slug,
        title,
        poster,
        type,
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

    const epRegex = /\/watch\/[a-zA-Z0-9_-]+\/ep-(\d+)/gi;
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

    episodes.sort((a, b) => a.number - b.number);
    globalCache.set(cacheKey, episodes, 1800);
    return episodes;
  }

  async getServers(animeId: string, episodeNumber: number): Promise<Server[]> {
    const cacheKey = this.getCacheKey('servers', animeId, episodeNumber);
    const cached = globalCache.get<Server[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const epUrl = `${baseUrl}/watch/${animeId}/ep-${episodeNumber}`;
    const html = await HttpClient.get(epUrl, { referer: `${baseUrl}/watch/${animeId}` });

    const servers: Server[] = [];
    const $ = cheerio.load(html);

    $('button.nv-server-btn, .server-video, .server-item').each((_, el) => {
      const videoUrl = $(el).attr('data-video');
      const tab = $(el).attr('data-tab');
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      if (!videoUrl) return;

      let subType: 'sub' | 'dub' = 'sub';
      if (tab === 'tab_2' || /dub/i.test(text)) {
        subType = 'dub';
      }

      let name = 'HD-1';
      if (/StreamHG/i.test(text)) name = 'StreamHG';
      else if (/Earnvids/i.test(text)) name = 'Earnvids';
      else if (/Doodstream/i.test(text)) name = 'Doodstream';

      servers.push({
        id: encodeURIComponent(videoUrl),
        name: `${name} (${subType.toUpperCase()})`,
        subType,
      });
    });

    if (servers.length === 0) {
      // Default fallback
      servers.push({
        id: 'default',
        name: 'AniNeko HD-1',
        subType: 'sub',
      });
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
    const epUrl = `${baseUrl}/watch/${animeId}/ep-${episodeNumber}`;
    let targetEmbedUrl = serverId !== 'default' ? decodeURIComponent(serverId) : '';

    if (!targetEmbedUrl) {
      const html = await HttpClient.get(epUrl, { referer: `${baseUrl}/watch/${animeId}` });
      const $ = cheerio.load(html);

      // Find matching server button by subType
      $('button.nv-server-btn, .server-video').each((_, el) => {
        const video = $(el).attr('data-video');
        const tab = $(el).attr('data-tab');
        if (!video) return;

        if (subType === 'dub' && (tab === 'tab_2' || $(el).text().includes('DUB'))) {
          if (!targetEmbedUrl || video.includes('vivibebe.site')) targetEmbedUrl = video;
        } else if (subType === 'sub' && (tab === 'tab_0' || tab === 'tab_1')) {
          if (!targetEmbedUrl || video.includes('vivibebe.site')) targetEmbedUrl = video;
        }
      });
    }

    if (!targetEmbedUrl) {
      throw new Error(`AniNeko: No playable stream embed URL found for ${animeId} ep ${episodeNumber}`);
    }

    const sources: VideoSource[] = [];
    const subtitles: SubtitleTrack[] = [];

    // Check if subtitle is passed in URL (e.g. ?sub=... or ?caption_1=...)
    const subMatch = targetEmbedUrl.match(/[?&](?:sub|caption_1)=([^&]+)/i);
    if (subMatch) {
      subtitles.push({
        url: decodeURIComponent(subMatch[1]),
        label: 'English',
        srclang: 'en',
        kind: 'subtitles',
        isDefault: true,
      });
    }

    // If vivibebe.site (VibePlayer)
    if (targetEmbedUrl.includes('vivibebe.site')) {
      const idMatch = targetEmbedUrl.match(/vivibebe\.site\/([a-zA-Z0-9_-]+)/i);
      if (idMatch) {
        const streamId = idMatch[1];
        const masterM3u8 = `https://vivibebe.site/public/stream/${streamId}/master.m3u8`;
        sources.push({
          url: masterM3u8,
          type: 'hls',
          isM3U8: true,
          quality: 'auto',
        });
      }
    }

    if (sources.length === 0) {
      sources.push({
        url: targetEmbedUrl,
        type: 'embed',
        isM3U8: false,
      });
    }

    const result: StreamResolutionResult = {
      provider: this.name,
      animeId,
      episodeNumber,
      subType,
      server: 'HD-1',
      sources,
      subtitles,
      headers: {
        Referer: `${baseUrl}/`,
      },
      isDub: subType === 'dub',
    };

    globalCache.set(cacheKey, result, 900);
    return result;
  }
}

export const aniNekoProvider = new AniNekoProvider();

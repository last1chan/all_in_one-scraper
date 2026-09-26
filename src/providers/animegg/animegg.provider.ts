import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { HttpClient } from '../../core/http-client.js';
import { globalCache } from '../../core/cache.js';
import * as cheerio from 'cheerio';

export class AnimeGGProvider extends BaseProvider {
  readonly name = 'animegg';
  readonly defaultBaseUrl = 'https://www.animegg.org';
  readonly mirrorUrls = [
    'https://www.animegg.org',
  ];
  readonly isSelfHosted = true;
  readonly librarySize = '3,200+';
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
    const url = `${baseUrl}/search?q=${encodeURIComponent(query)}`;
    const html = await HttpClient.get(url, { referer: `${baseUrl}/` });

    const results: AnimeSearchResult[] = [];
    const seen = new Set<string>();

    const $ = cheerio.load(html);
    $('a[href*="/series/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const slugMatch = href.match(/\/series\/([a-zA-Z0-9_-]+)/i);
      if (!slugMatch) return;
      const slug = slugMatch[1];
      if (seen.has(slug)) return;
      seen.add(slug);

      const titleEl = $(el).find('.title, h2, strong').first();
      let title = titleEl.length ? titleEl.text().trim() : $(el).text().trim().split('\n')[0].trim();
      if (!title) title = slug.replace(/-/g, ' ');

      const img = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');
      const poster = img ? (img.startsWith('http') ? img : `${baseUrl}${img}`) : undefined;

      // Extract episode count if available
      const text = $(el).text();
      const epMatch = text.match(/Episodes\s*:\s*(\d+)/i);
      const epCount = epMatch ? parseInt(epMatch[1], 10) : undefined;

      results.push({
        id: slug,
        title,
        poster,
        episodesCount: epCount,
        provider: this.name,
        url: `${baseUrl}/series/${slug}`,
      });
    });

    globalCache.set(cacheKey, results, 300);
    return results;
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    const cacheKey = this.getCacheKey('episodes', animeId);
    const cached = globalCache.get<Episode[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/series/${encodeURIComponent(animeId)}`;
    const html = await HttpClient.get(url, { referer: `${baseUrl}/` });

    const $ = cheerio.load(html);
    const epMap = new Map<number, { hasSub: boolean; hasDub: boolean; slug: string }>();

    $('a[href*="-episode-"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(/\/([a-zA-Z0-9_-]+)-episode-(\d+)(?:#(subbed|dubbed))?/i);
      if (!match) return;

      const fullSlug = match[1];
      const epNum = parseInt(match[2], 10);
      const subOrDub = match[3]?.toLowerCase();

      const existing = epMap.get(epNum) || { hasSub: true, hasDub: false, slug: fullSlug };
      if (subOrDub === 'dubbed') {
        existing.hasDub = true;
      }
      if (subOrDub === 'subbed') {
        existing.hasSub = true;
      }
      epMap.set(epNum, existing);
    });

    const episodes: Episode[] = Array.from(epMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([num, data]) => ({
        id: `${data.slug}-episode-${num}`,
        number: num,
        title: `Episode ${num}`,
        hasSub: data.hasSub,
        hasDub: data.hasDub,
      }));

    globalCache.set(cacheKey, episodes, 600);
    return episodes;
  }

  async getServers(
    _animeId: string,
    _episodeNumber: number
  ): Promise<Server[]> {
    return [
      {
        id: 'animegg-sub',
        name: 'AnimeGG SUB',
        serverId: 'animegg-sub',
        subType: 'sub',
      },
      {
        id: 'animegg-dub',
        name: 'AnimeGG DUB',
        serverId: 'animegg-dub',
        subType: 'dub',
      },
    ];
  }

  async getSources(
    animeId: string,
    episodeNumber: number,
    _serverId?: string,
    subType: 'sub' | 'dub' = 'sub'
  ): Promise<StreamResolutionResult> {
    const cacheKey = this.getCacheKey('sources', `${animeId}-${episodeNumber}-${subType}`);
    const cached = globalCache.get<StreamResolutionResult>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const epNum = episodeNumber;
    const epSlug = `${animeId}-episode-${epNum}`;

    const epUrl = `${baseUrl}/${epSlug}`;
    const epHtml = await HttpClient.get(epUrl, { referer: `${baseUrl}/series/${animeId}` });

    const $ = cheerio.load(epHtml);

    // Target iframe inside subbed-Animegg or dubbed-Animegg container
    let iframeSrc: string | undefined;
    if (subType === 'dub') {
      iframeSrc = $('#dubbed-Animegg iframe').attr('src') || $('[id*="dubbed"] iframe').attr('src');
    }
    if (!iframeSrc) {
      iframeSrc = $('#subbed-Animegg iframe').attr('src') || $('[id*="subbed"] iframe').attr('src');
    }
    if (!iframeSrc) {
      iframeSrc = $('iframe').attr('src');
    }

    if (!iframeSrc) {
      throw new Error(`No player iframe found on AnimeGG for ${epSlug}`);
    }

    const embedUrl = iframeSrc.startsWith('http') ? iframeSrc : `${baseUrl}${iframeSrc}`;
    const embedHtml = await HttpClient.get(embedUrl, { referer: epUrl });

    // Parse videoSources from embed script
    const sourcesMatch = embedHtml.match(/var\s+videoSources\s*=\s*(\[[^\]]+\]);/);
    if (!sourcesMatch) {
      throw new Error(`Failed to extract videoSources from AnimeGG embed ${embedUrl}`);
    }

    let parsedSources: any[] = [];
    try {
      // Clean JSON representation of JS object literal
      const jsonStr = sourcesMatch[1]
        .replace(/([a-zA-Z0-9_]+)\s*:/g, '"$1":')
        .replace(/'/g, '"');
      parsedSources = JSON.parse(jsonStr);
    } catch {
      // Fallback regex matching
      const fileMatches = [...sourcesMatch[1].matchAll(/file:\s*["']([^"']+)["'][^}]*label:\s*["']([^"']+)["']/g)];
      parsedSources = fileMatches.map((m) => ({ file: m[1], label: m[2] }));
    }

    const sources: VideoSource[] = [];
    for (const src of parsedSources) {
      if (src.file) {
        const fileUrl = src.file.startsWith('http') ? src.file : `${baseUrl}${src.file}`;
        sources.push({
          url: fileUrl,
          type: 'mp4',
          quality: src.label || 'auto',
          isM3U8: false,
        });
      }

      // Check for base64 backup link (e.g. mp4upload)
      if (src.bk) {
        try {
          const decoded = decodeURIComponent(Buffer.from(src.bk, 'base64').toString('utf-8'));
          if (decoded.startsWith('http')) {
            sources.push({
              url: decoded,
              type: 'embed',
              quality: `${src.label || 'backup'} (MP4Upload)`,
              isM3U8: false,
              isBackup: true,
            });
          }
        } catch {
          // ignore base64 decode failure
        }
      }
    }

    if (sources.length === 0) {
      throw new Error(`No valid video sources parsed from AnimeGG embed ${embedUrl}`);
    }

    const result: StreamResolutionResult = {
      provider: this.name,
      animeId,
      episodeNumber: epNum,
      subType,
      server: `AnimeGG ${subType.toUpperCase()}`,
      sources,
      subtitles: [],
      headers: {
        'Referer': embedUrl,
      },
      isDub: subType === 'dub',
      isHardSub: subType === 'sub',
      mp4Sources: sources.filter((s) => s.type === 'mp4'),
    };

    globalCache.set(cacheKey, result, 300);
    return result;
  }
}

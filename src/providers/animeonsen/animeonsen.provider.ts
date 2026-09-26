import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, SubtitleTrack, VideoSource } from '../../types/anime.js';
import { globalCache } from '../../core/cache.js';

export class AnimeOnsenProvider extends BaseProvider {
  readonly name = 'animeonsen';
  readonly defaultBaseUrl = 'https://www.animeonsen.xyz';
  readonly mirrorUrls = [
    'https://www.animeonsen.xyz',
  ];
  readonly isSelfHosted = true;
  readonly librarySize = '2,500+';
  readonly serverType = 'self-hosted' as const;

  private readonly meiliToken = '0e36d0275d16b40d7cf153634df78bc229320d073f565db2aaf6d027e0c30b13';
  private bearerToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    super();
    this.init();
  }

  private async getBearerToken(): Promise<string> {
    if (this.bearerToken && Date.now() < this.tokenExpiry) {
      return this.bearerToken;
    }

    const homeRes = await fetch('https://www.animeonsen.xyz/', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    });

    const cookies = homeRes.headers.getSetCookie ? homeRes.headers.getSetCookie() : [homeRes.headers.get('set-cookie')];
    let aoSession = '';
    for (const c of cookies) {
      if (c && c.includes('ao.session=')) {
        const match = c.match(/ao\.session=([^;]+)/);
        if (match) aoSession = decodeURIComponent(match[1]);
      }
    }

    if (!aoSession) {
      throw new Error('Failed to acquire ao.session cookie from AnimeOnsen');
    }

    const decodedSession = Buffer.from(aoSession, 'base64').toString('utf-8');
    const token = decodedSession.split('').reduce((t, e) => t + String.fromCharCode(e.charCodeAt(0) + 1), '');

    this.bearerToken = token;
    this.tokenExpiry = Date.now() + 3600 * 1000;
    return token;
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<AnimeSearchResult[]>(cacheKey);
    if (cached) return cached;

    const res = await fetch('https://search.animeonsen.xyz/indexes/content/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.meiliToken}`,
      },
      body: JSON.stringify({ q: query, limit: 15 }),
    });

    if (!res.ok) {
      throw new Error(`AnimeOnsen search failed: HTTP ${res.status}`);
    }

    const data: any = await res.json();
    const results: AnimeSearchResult[] = (data.hits || []).map((h: any) => ({
      id: h.content_id,
      title: h.content_title_en || h.content_title_jp || '',
      japaneseTitle: h.content_title_jp,
      poster: h.poster_image,
      episodesCount: h.total_episodes,
      provider: this.name,
      url: `https://www.animeonsen.xyz/details/${h.content_id}`,
    }));

    globalCache.set(cacheKey, results, 300);
    return results;
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    const cacheKey = this.getCacheKey('episodes', animeId);
    const cached = globalCache.get<Episode[]>(cacheKey);
    if (cached) return cached;

    const token = await this.getBearerToken();
    const res = await fetch(`https://api.animeonsen.xyz/v4/content/${encodeURIComponent(animeId)}/episodes`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error(`AnimeOnsen episodes failed: HTTP ${res.status}`);
    }

    const data: any = await res.json();
    const episodes: Episode[] = [];

    const keys = Object.keys(data).sort((a, b) => Number(a) - Number(b));
    for (const k of keys) {
      const epNum = Number(k);
      const epInfo = data[k] || {};
      episodes.push({
        id: k,
        number: epNum,
        title: epInfo.contentTitle_episode_en || epInfo.contentTitle_episode_jp || `Episode ${epNum}`,
        hasSub: true,
        hasDub: false,
      });
    }

    globalCache.set(cacheKey, episodes, 600);
    return episodes;
  }

  async getServers(
    _animeId: string,
    _episodeNumber: number
  ): Promise<Server[]> {
    return [
      {
        id: 'dash-master',
        name: 'AnimeOnsen DASH',
        serverId: 'animeonsen-dash',
        subType: 'sub',
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

    const token = await this.getBearerToken();
    const epNum = episodeNumber;

    const res = await fetch(`https://api.animeonsen.xyz/v4/content/${encodeURIComponent(animeId)}/video/${epNum}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error(`AnimeOnsen video metadata failed: HTTP ${res.status}`);
    }

    const data: any = await res.json();
    const uri = data.uri || {};
    const streamUrl = uri.stream;
    if (!streamUrl) {
      throw new Error(`No stream URL returned for AnimeOnsen animeId=${animeId} ep=${epNum}`);
    }

    const sources: VideoSource[] = [
      {
        url: streamUrl,
        type: 'dash',
        isM3U8: false,
        quality: 'auto',
      },
    ];

    const subtitles: SubtitleTrack[] = [];
    if (uri.subtitles && typeof uri.subtitles === 'object') {
      for (const [langCode, subUrl] of Object.entries(uri.subtitles)) {
        subtitles.push({
          url: subUrl as string,
          label: langCode,
          srclang: langCode.split('-')[0],
          kind: 'subtitles',
          isDefault: langCode === 'en-US',
        });
      }
    }

    // Intro / Outro timestamps
    let intro = null;
    let outro = null;
    const epMeta = data.metadata?.episode?.[1];
    if (epMeta) {
      const skipIntroStart = Number(epMeta.skipIntro_s) || 0;
      const skipIntroEnd = Number(epMeta.skipIntro_e) || 0;
      if (skipIntroEnd > skipIntroStart) {
        intro = { start: skipIntroStart, end: skipIntroEnd };
      }
      const nextEpStart = Number(epMeta.nextEpisode_s) || 0;
      if (nextEpStart > 0) {
        outro = { start: nextEpStart, end: nextEpStart + 90 };
      }
    }

    const result: StreamResolutionResult = {
      provider: this.name,
      animeId,
      episodeNumber: epNum,
      subType,
      server: 'AnimeOnsen DASH',
      sources,
      subtitles,
      intro,
      outro,
      headers: {
        'Referer': 'https://www.animeonsen.xyz/',
        'Origin': 'https://www.animeonsen.xyz',
      },
      isDub: false,
      isSoftSub: subtitles.length > 0,
    };

    globalCache.set(cacheKey, result, 300);
    return result;
  }
}

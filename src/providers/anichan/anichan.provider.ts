import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, SubtitleTrack, VideoSource } from '../../types/anime.js';
import { globalCache } from '../../core/cache.js';

interface AniChanServer {
  name: string;
  label: string;
  host: string;
  type: string;
  rank: number;
  stream?: string;
  embed?: string;
  subtitles?: Array<{ lang: string; default?: boolean; url?: string; ass?: string }>;
  intro?: { start: number; end: number } | null;
  outro?: { start: number; end: number } | null;
  subType?: string;
}

export class AniChanProvider extends BaseProvider {
  readonly name = 'anichan';
  readonly defaultBaseUrl = 'https://anichan.to';
  readonly mirrorUrls = [
    'https://anichan.to',
    'https://anichan.net',
  ];

  private sessionCookie: string | null = null;
  private sessionExpiry: number = 0;

  constructor() {
    super();
    this.init();
  }

  private async getSessionCookie(): Promise<string> {
    if (this.sessionCookie && Date.now() < this.sessionExpiry) {
      return this.sessionCookie;
    }

    const baseUrl = this.getBaseUrl();
    const res = await fetch(`${baseUrl}/api/watch/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Origin': 'https://anichan.net',
        'Referer': 'https://anichan.net/',
      },
      body: JSON.stringify({ token: '' }),
    });

    if (!res.ok) {
      throw new Error(`Failed to acquire AniChan session: HTTP ${res.status}`);
    }

    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
    let session = '';
    for (const c of cookies) {
      if (c && c.includes('anichan_ws=')) {
        session = c.split(';')[0];
        break;
      }
    }

    if (!session) {
      throw new Error('No anichan_ws cookie returned from session endpoint');
    }

    this.sessionCookie = session;
    // Expire in 1 hour
    this.sessionExpiry = Date.now() + 3600 * 1000;
    return session;
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<AnimeSearchResult[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const res = await fetch(`${baseUrl}/api/suggest?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Origin': 'https://anichan.net',
        'Referer': 'https://anichan.net/',
      },
    });

    if (!res.ok) {
      throw new Error(`AniChan search failed with HTTP ${res.status}`);
    }

    const data: any = await res.json();
    const results: AnimeSearchResult[] = (data.results || []).map((item: any) => ({
      id: String(item.id),
      title: item.titleRomaji || item.title || '',
      japaneseTitle: item.titleNative,
      poster: item.poster,
      type: item.format,
      episodesCount: item.episodes,
      provider: this.name,
      url: `https://anichan.net/anime/${item.id}`,
    }));

    globalCache.set(cacheKey, results, 300);
    return results;
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    const cacheKey = this.getCacheKey('episodes', animeId);
    const cached = globalCache.get<Episode[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const res = await fetch(`${baseUrl}/api/watch/episodes?anilistId=${encodeURIComponent(animeId)}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Origin': 'https://anichan.net',
        'Referer': 'https://anichan.net/',
      },
    });

    if (!res.ok) {
      throw new Error(`AniChan episodes failed with HTTP ${res.status}`);
    }

    const data: any = await res.json();
    const count: number = Number(data.episodes) || 0;
    const hasDub: boolean = !!data.dubAvailable;

    const episodes: Episode[] = [];
    for (let i = 1; i <= count; i++) {
      episodes.push({
        id: String(i),
        number: i,
        title: `Episode ${i}`,
        hasSub: true,
        hasDub,
      });
    }

    globalCache.set(cacheKey, episodes, 600);
    return episodes;
  }

  async getServers(
    animeId: string,
    episodeNumber: number
  ): Promise<Server[]> {
    const cookie = await this.getSessionCookie();
    const baseUrl = this.getBaseUrl();
    const epNum = episodeNumber;

    const [subRes, dubRes] = await Promise.allSettled([
      fetch(`${baseUrl}/api/watch/servers?anilistId=${encodeURIComponent(animeId)}&ep=${epNum}&category=sub`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Origin': 'https://anichan.net',
          'Referer': 'https://anichan.net/',
          'Cookie': cookie,
        },
      }),
      fetch(`${baseUrl}/api/watch/servers?anilistId=${encodeURIComponent(animeId)}&ep=${epNum}&category=dub`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Origin': 'https://anichan.net',
          'Referer': 'https://anichan.net/',
          'Cookie': cookie,
        },
      }),
    ]);

    const servers: Server[] = [];

    if (subRes.status === 'fulfilled' && subRes.value.ok) {
      const data: any = await subRes.value.json();
      for (const s of data.servers || []) {
        servers.push({
          id: `${s.name}-sub`,
          name: `${s.label || s.name} (Sub)`,
          serverId: s.name,
          subType: 'sub',
        });
      }
    }

    if (dubRes.status === 'fulfilled' && dubRes.value.ok) {
      const data: any = await dubRes.value.json();
      for (const s of data.servers || []) {
        servers.push({
          id: `${s.name}-dub`,
          name: `${s.label || s.name} (Dub)`,
          serverId: s.name,
          subType: 'dub',
        });
      }
    }

    return servers;
  }

  async getSources(
    animeId: string,
    episodeNumber: number,
    serverId?: string,
    subType: 'sub' | 'dub' = 'sub'
  ): Promise<StreamResolutionResult> {
    const cacheKey = this.getCacheKey('sources', `${animeId}-${episodeNumber}-${serverId || 'def'}-${subType}`);
    const cached = globalCache.get<StreamResolutionResult>(cacheKey);
    if (cached) return cached;

    const cookie = await this.getSessionCookie();
    const baseUrl = this.getBaseUrl();
    const epNum = episodeNumber;

    const res = await fetch(
      `${baseUrl}/api/watch/servers?anilistId=${encodeURIComponent(animeId)}&ep=${epNum}&category=${subType}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Origin': 'https://anichan.net',
          'Referer': 'https://anichan.net/',
          'Cookie': cookie,
        },
      }
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch servers: HTTP ${res.status}`);
    }

    const data: any = await res.json();
    const servers: AniChanServer[] = data.servers || [];
    if (servers.length === 0) {
      throw new Error(`No video servers available for AniChan animeId=${animeId} ep=${epNum}`);
    }

    let selected = servers[0];
    if (serverId) {
      const cleanServerId = serverId.replace(/-(sub|dub)$/, '');
      const found = servers.find((s) => s.name.toLowerCase() === cleanServerId.toLowerCase());
      if (found) selected = found;
    }

    const sources: VideoSource[] = [];
    const subtitles: SubtitleTrack[] = [];

    const rawStream = selected.stream || selected.embed || '';
    const fullStreamUrl = rawStream.startsWith('http')
      ? rawStream
      : `${baseUrl}${rawStream}`;

    sources.push({
      url: fullStreamUrl,
      type: selected.type === 'embed' ? 'embed' : 'hls',
      isM3U8: fullStreamUrl.includes('.m3u8') || selected.type === 'hls',
      quality: 'auto',
    });

    if (selected.subtitles) {
      for (const sub of selected.subtitles) {
        if (sub.url) {
          subtitles.push({
            url: sub.url,
            label: sub.lang || 'English',
            srclang: (sub.lang || 'en').toLowerCase().slice(0, 2),
            kind: 'subtitles',
            isDefault: !!sub.default,
          });
        }
      }
    }

    const result: StreamResolutionResult = {
      provider: this.name,
      animeId,
      episodeNumber: epNum,
      subType,
      server: selected.name,
      sources,
      subtitles,
      intro: selected.intro && (selected.intro.start > 0 || selected.intro.end > 0)
        ? { start: selected.intro.start, end: selected.intro.end }
        : null,
      outro: selected.outro && (selected.outro.start > 0 || selected.outro.end > 0)
        ? { start: selected.outro.start, end: selected.outro.end }
        : null,
      headers: {
        'Referer': 'https://anichan.net/',
        'Origin': 'https://anichan.net',
        'Cookie': cookie,
      },
      isDub: subType === 'dub',
      isSoftSub: subtitles.length > 0,
    };

    globalCache.set(cacheKey, result, 300);
    return result;
  }
}

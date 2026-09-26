import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult } from '../../types/anime.js';
import axios from 'axios';

export class AnilibriaProvider extends BaseProvider {
  readonly name = 'Anilibria';
  readonly defaultBaseUrl = 'https://anilibria.top/api/v1';
  readonly mirrorUrls = ['https://anilibria.top/api/v1'];
  readonly languages = ['ru'];
  readonly isSelfHosted = true;
  readonly librarySize = '2,000+';
  readonly serverType = 'self-hosted' as const;

  constructor() {
    super();
    this.init();
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    try {
      const response = await axios.get(`${this.getBaseUrl()}/app/search/releases`, {
        params: { query: query.trim() },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000,
      });

      const list = Array.isArray(response.data) ? response.data : [];
      return list.map((item: any) => ({
        id: String(item.alias || item.id),
        title: item.name?.main || item.name?.english || query,
        japaneseTitle: item.name?.english || undefined,
        poster: item.poster?.optimized?.src || item.poster?.src
          ? `https://anilibria.top${item.poster.optimized?.src || item.poster.src}`
          : undefined,
        type: item.type?.value || 'TV',
        episodesCount: item.episodes_total || 0,
        provider: this.name,
        url: `https://anilibria.top/anime/releases/${item.alias || item.id}`,
      }));
    } catch (e: any) {
      console.error('AniLiberty search failed:', e?.message || e);
      return [];
    }
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    try {
      const response = await axios.get(`${this.getBaseUrl()}/anime/releases/${animeId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000,
      });

      const release = response.data;
      if (!release || !Array.isArray(release.episodes)) return [];

      return release.episodes.map((ep: any) => ({
        id: `${animeId}-${ep.ordinal}`,
        number: ep.ordinal,
        title: ep.name || `Episode ${ep.ordinal}`,
        image: ep.preview?.optimized?.src
          ? `https://anilibria.top${ep.preview.optimized.src}`
          : undefined,
        duration: ep.duration || undefined,
        url: `https://anilibria.top/anime/releases/${animeId}`,
      })).sort((a: Episode, b: Episode) => a.number - b.number);
    } catch (e: any) {
      console.error('AniLiberty getEpisodes failed:', e?.message || e);
      return [];
    }
  }

  async getServers(animeId: string, episodeNumber: number): Promise<Server[]> {
    return [
      {
        id: 'anilibria-dub',
        name: 'AniLiberty (RU Dub)',
        subType: 'dub',
      },
      {
        id: 'anilibria-sub',
        name: 'AniLiberty (RU Sub)',
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
      const response = await axios.get(`${this.getBaseUrl()}/anime/releases/${animeId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000,
      });

      const release = response.data;
      if (!release || !Array.isArray(release.episodes)) {
        throw new Error('No episodes array found');
      }

      const ep = release.episodes.find((e: any) => e.ordinal === episodeNumber);
      if (!ep) {
        throw new Error(`Episode ${episodeNumber} not found on AniLiberty`);
      }

      const sources: any[] = [];
      if (ep.hls_1080) {
        sources.push({ url: ep.hls_1080, quality: '1080p', type: 'hls', isM3U8: true });
      }
      if (ep.hls_720) {
        sources.push({ url: ep.hls_720, quality: '720p', type: 'hls', isM3U8: true });
      }
      if (ep.hls_480) {
        sources.push({ url: ep.hls_480, quality: '480p', type: 'hls', isM3U8: true });
      }

      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId,
        sources,
        subtitles: [],
        intro: ep.opening?.start != null && ep.opening?.stop != null
          ? { start: ep.opening.start, end: ep.opening.stop }
          : null,
        outro: ep.ending?.start != null && ep.ending?.stop != null
          ? { start: ep.ending.start, end: ep.ending.stop }
          : null,
        headers: {
          'Origin': 'https://anilibria.top',
          'Referer': 'https://anilibria.top/',
          'User-Agent': 'Mozilla/5.0',
        },
      };
    } catch (e: any) {
      console.error('AniLiberty getSources failed:', e?.message || e);
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

export const anilibriaProvider = new AnilibriaProvider();

import { AniListClient, AniListMedia } from '../core/anilist.js';
import { calculateCandidateScore } from '../core/matcher.js';
import { providerRegistry } from '../providers/index.js';
import { AnimeSearchResult, StreamResolutionResult, Episode, VideoSource, SubtitleTrack, TimeRange } from '../types/anime.js';
import { globalCache } from '../core/cache.js';

export interface UnifiedStreamResponse {
  anilistId: number;
  animeTitle: string;
  episodeNumber: number;
  episodeTitle?: string | null;
  thumbnail?: string | null;
  overview?: string | null;
  duration?: number | null;
  airDate?: string | null;
  latestAiredEpisode: number;
  isReleased: boolean;
  provider: string;
  providerAnimeId: string;
  subType: 'sub' | 'dub';
  isDub: boolean;
  isHardSub: boolean;
  isSoftSub: boolean;
  hasSubtitles: boolean;
  server: string;
  sources: VideoSource[];
  subtitles: SubtitleTrack[];
  intro: TimeRange | null;
  outro: TimeRange | null;
  skipTimes: {
    intro?: TimeRange | null;
    outro?: TimeRange | null;
  };
  mp4Backup: VideoSource | null;
  mp4Sources: VideoSource[];
  headers?: Record<string, string>;
  fallbackProvidersAttempted: string[];
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export class UnifiedScraperService {

  async resolveMedia(anilistId: number): Promise<AniListMedia> {
    return AniListClient.getMedia(anilistId);
  }

  async findBestShowMatch(
    providerName: string,
    media: AniListMedia
  ): Promise<{ result: AnimeSearchResult; score: number } | null> {
    const provider = providerRegistry.getProvider(providerName);
    if (!provider) return null;

    if (providerName === 'anichan') {
      return {
        result: {
          id: String(media.id),
          title: media.title.english || media.title.romaji || '',
          provider: 'anichan',
        },
        score: 100,
      };
    }

    const titlesToSearch = Array.from(
      new Set([media.title.english, media.title.romaji, ...(media.synonyms || [])].filter(Boolean) as string[])
    );

    const candidateMap = new Map<string, AnimeSearchResult>();
    for (const title of titlesToSearch.slice(0, 4)) {
      try {
        const list = await provider.search(title);
        for (const item of list) {
          candidateMap.set(item.id, item);
        }
      } catch {}
    }

    const candidates = Array.from(candidateMap.values());
    if (candidates.length === 0) return null;

    const scored = candidates.map((c) => ({
      result: c,
      score: calculateCandidateScore(
        c.title,
        c.id,
        c.japaneseTitle,
        media.title.english,
        media.title.romaji,
        media.synonyms
      ),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.score > 0 ? scored[0] : null;
  }

  async getAiredEpisodesForMedia(
    anilistId: number,
    preferredProvider?: string
  ): Promise<{
    media: AniListMedia;
    provider: string;
    matchedAnimeId: string;
    episodes: Episode[];
  }> {
    const media = await this.resolveMedia(anilistId);
    const providersToTry = preferredProvider
      ? [preferredProvider, ...providerRegistry.getProviderNames().filter((p) => p !== preferredProvider)]
      : providerRegistry.getProviderNames();

    for (const pName of providersToTry) {
      const best = await this.findBestShowMatch(pName, media);
      if (!best) continue;

      const provider = providerRegistry.getProvider(pName)!;
      try {
        const allEpisodes = await provider.getEpisodes(best.result.id);
        const filtered =
          media.status === 'RELEASING' && media.latestAiredEpisode > 0
            ? allEpisodes.filter((ep) => ep.number <= media.latestAiredEpisode)
            : allEpisodes;

        // Enrich with AniZip metadata if available
        const enriched = filtered.map((ep) => {
          const azMeta = media.episodesMeta?.[String(ep.number)];
          return {
            ...ep,
            title: azMeta?.title?.en || azMeta?.title?.['x-jat'] || ep.title,
            image: azMeta?.image || ep.image || null,
            description: azMeta?.overview || azMeta?.summary || ep.description || null,
            airDate: azMeta?.airDate || azMeta?.airdate || ep.airDate || null,
            duration: azMeta?.runtime || azMeta?.length || ep.duration || null,
          };
        });

        return {
          media,
          provider: pName,
          matchedAnimeId: best.result.id,
          episodes: enriched,
        };
      } catch (err) {
        console.warn(`[UnifiedScraper] Error fetching episodes from ${pName}:`, err instanceof Error ? err.message : err);
      }
    }

    throw new Error(`Could not resolve episodes for AniList ID ${anilistId} on any active provider`);
  }

  async resolveStream(
    anilistId: number,
    episodeNumber: number,
    subType: 'sub' | 'dub' = 'sub',
    preferredProvider?: string,
    language: string = 'en'
  ): Promise<UnifiedStreamResponse> {
    const cacheKey = `unified:stream:${anilistId}:${episodeNumber}:${subType}:${preferredProvider || 'auto'}:${language}`;
    const cached = globalCache.get<UnifiedStreamResponse>(cacheKey);
    if (cached) return cached;

    const media = await this.resolveMedia(anilistId);
    const isReleased =
      media.status === 'FINISHED' ||
      (media.status === 'RELEASING' && episodeNumber <= media.latestAiredEpisode) ||
      media.latestAiredEpisode === 0;

    let providersToTry: string[];

    if (preferredProvider) {
      // Attempt the preferred provider first, but fall back to self-hosted sources if it fails
      const fallbackList = ['anichan', 'marin', 'animeheaven', 'animegg', 'animeonsen', 'allanime', 'kickassanime', 'animepahe'];
      providersToTry = [
        preferredProvider,
        ...fallbackList.filter((p) => p.toLowerCase() !== preferredProvider.toLowerCase()),
      ];
    } else {
      // Filter providers by requested language
      const regional = providerRegistry
        .getAllProviders()
        .filter((p) => p.languages && p.languages.includes(language))
        .map((p) => p.name.toLowerCase());

      if (regional.length > 0) {
        providersToTry = regional;
      } else {
        // Prioritize self-hosted Everything.moe sources first
        const selfHosted = providerRegistry
          .getSelfHostedProviders()
          .map((p) => p.name.toLowerCase());
        const others = providerRegistry
          .getAllProviders()
          .filter((p) => !p.isSelfHosted)
          .map((p) => p.name.toLowerCase());

        providersToTry = ['anichan', ...selfHosted.filter((p) => p !== 'anichan'), ...others];
      }
    }

    const attempted: string[] = [];

    // Check AniZip episode metadata
    const epMeta = media.episodesMeta?.[String(episodeNumber)];
    const epTitle = epMeta?.title?.en || epMeta?.title?.['x-jat'] || `Episode ${episodeNumber}`;
    const thumbnail = epMeta?.image || null;
    const overview = epMeta?.overview || epMeta?.summary || null;
    const duration = epMeta?.runtime || epMeta?.length || null;
    const airDate = epMeta?.airDate || epMeta?.airdate || null;

    for (const pName of providersToTry) {
      attempted.push(pName);

      let match;
      try {
        match = await this.findBestShowMatch(pName, media);
      } catch (err) {
        console.warn(`[UnifiedScraper] findBestShowMatch failed for ${pName}:`, err instanceof Error ? err.message : err);
        continue;
      }
      if (!match) continue;

      const provider = providerRegistry.getProvider(pName);
      if (!provider) continue;

      try {
        const servers = await withTimeout(
          provider.getServers(match.result.id, episodeNumber),
          8000,
          `${pName}.getServers`
        );
        const validServers = servers.filter((s) => s.subType === subType);
        if (validServers.length === 0) continue;

        for (const s of validServers) {
          try {
            const streamResult = await withTimeout(
              provider.getSources(match.result.id, episodeNumber, s.id, subType),
              8000,
              `${pName}.getSources`
            );
            if (streamResult.sources && streamResult.sources.length > 0) {
              // Normalize subtitles
              const subtitles: SubtitleTrack[] = (streamResult.subtitles || []).map((sub) => ({
                url: sub.url,
                label: sub.label || 'English',
                srclang: sub.srclang || (sub.label || 'en').toLowerCase().slice(0, 2),
                kind: sub.kind || 'subtitles',
                isDefault: !!sub.isDefault,
              }));

              // Sub / Dub / HardSub / SoftSub classification
              const isDub = subType === 'dub';
              const isSoftSub = subtitles.length > 0;
              const isHardSub = !isDub && !isSoftSub;
              const hasSubtitles = !isDub;

              // Intro & Outro normalization
              const cleanRange = (r?: TimeRange | null): TimeRange | null => {
                if (!r || (r.start === 0 && r.end === 0) || r.end <= r.start) return null;
                return r;
              };

              const intro = cleanRange(streamResult.intro);
              const outro = cleanRange(streamResult.outro);

              // MP4 backup source extraction
              const mp4Sources = streamResult.sources.filter((src) => src.type === 'mp4' || src.url.endsWith('.mp4'));
              const mp4Backup = mp4Sources.length > 0 ? mp4Sources[0] : null;

              const response: UnifiedStreamResponse = {
                anilistId,
                animeTitle: media.title.english || media.title.romaji || match.result.title,
                episodeNumber,
                episodeTitle: epTitle,
                thumbnail,
                overview,
                duration,
                airDate,
                latestAiredEpisode: media.latestAiredEpisode,
                isReleased,
                provider: pName,
                providerAnimeId: match.result.id,
                subType,
                isDub,
                isHardSub,
                isSoftSub,
                hasSubtitles,
                server: s.name,
                sources: streamResult.sources,
                subtitles,
                intro,
                outro,
                skipTimes: {
                  intro,
                  outro,
                },
                mp4Backup,
                mp4Sources,
                headers: streamResult.headers,
                fallbackProvidersAttempted: attempted,
              };

              globalCache.set(cacheKey, response, 600);
              return response;
            }
          } catch (err) {
            console.warn(`[UnifiedScraper] Server ${s.name} on ${pName} failed:`, err instanceof Error ? err.message : err);
          }
        }
      } catch (err) {
        console.warn(`[UnifiedScraper] Failed resolving stream from ${pName}:`, err instanceof Error ? err.message : err);
      }
    }

    throw new Error(
      `No stream sources could be resolved for AniList ID ${anilistId}, Episode ${episodeNumber} (${subType}). Providers attempted: ${attempted.join(', ')}`
    );
  }
}

export const unifiedScraperService = new UnifiedScraperService();

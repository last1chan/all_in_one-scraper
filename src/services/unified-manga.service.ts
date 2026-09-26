import { mangaProviderRegistry } from '../providers/manga/index.js';
import { MangaSearchResult, MangaChapter, MangaChapterPage } from '../types/manga.js';
import { globalCache } from '../core/cache.js';

export class UnifiedMangaService {
  async search(query: string, preferredProvider?: string): Promise<{ provider: string; results: MangaSearchResult[] }[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    if (preferredProvider) {
      const provider = mangaProviderRegistry.getProvider(preferredProvider);
      if (provider) {
        const results = await provider.search(trimmed);
        return [{ provider: provider.name, results }];
      }
    }

    // Default search: run across self-hosted providers in parallel first
    const primaryProviders = mangaProviderRegistry.getSelfHostedProviders();
    const settled = await Promise.allSettled(
      primaryProviders.map(async (p) => {
        const results = await p.search(trimmed);
        return { provider: p.name, results };
      })
    );

    const successful = settled
      .filter((s): s is PromiseFulfilledResult<{ provider: string; results: MangaSearchResult[] }> => s.status === 'fulfilled')
      .map((s) => s.value)
      .filter((s) => s.results.length > 0);

    if (successful.length > 0) {
      return successful;
    }

    // Fallback to remaining providers if primary returned no results
    const remaining = mangaProviderRegistry.getAllProviders().filter((p) => !p.isSelfHosted);
    const fallbackSettled = await Promise.allSettled(
      remaining.map(async (p) => {
        const results = await p.search(trimmed);
        return { provider: p.name, results };
      })
    );

    return fallbackSettled
      .filter((s): s is PromiseFulfilledResult<{ provider: string; results: MangaSearchResult[] }> => s.status === 'fulfilled')
      .map((s) => s.value)
      .filter((s) => s.results.length > 0);
  }

  async getChapters(providerName: string, mangaId: string): Promise<MangaChapter[]> {
    const provider = mangaProviderRegistry.getProvider(providerName);
    if (!provider) {
      throw new Error(`Manga provider "${providerName}" not found`);
    }
    return provider.getChapters(mangaId);
  }

  async getPages(providerName: string, chapterId: string): Promise<MangaChapterPage[]> {
    const provider = mangaProviderRegistry.getProvider(providerName);
    if (!provider) {
      throw new Error(`Manga provider "${providerName}" not found`);
    }
    return provider.getPages(chapterId);
  }

  getProviders() {
    return mangaProviderRegistry.getAllProviders().map((p) => ({
      name: p.name,
      baseUrl: p.defaultBaseUrl,
      isSelfHosted: p.isSelfHosted ?? false,
      librarySize: p.librarySize ?? 'Unknown',
      serverType: p.serverType ?? 'third-party',
      languages: p.languages,
      notes: p.notes,
    }));
  }
}

export const unifiedMangaService = new UnifiedMangaService();

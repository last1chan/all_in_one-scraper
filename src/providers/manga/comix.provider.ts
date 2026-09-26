import { BaseMangaProvider } from './base-manga-provider.js';
import { MangaSearchResult, MangaChapter, MangaChapterPage } from '../../types/manga.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';

export class ComixProvider extends BaseMangaProvider {
  readonly name = 'comix';
  readonly defaultBaseUrl = 'https://comix.to';
  readonly mirrorUrls = ["https://comix.to","https://api.comick.fun"];
  readonly languages = ['en'];
  readonly isSelfHosted = true;
  readonly librarySize = '65,000+';
  readonly serverType = 'self-hosted' as const;

  constructor() {
    super();
    this.init();
  }

  async search(query: string): Promise<MangaSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<MangaSearchResult[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await axios.get(`${this.getBaseUrl()}/v1.0/search`, {
        params: { q: query, limit: 20 },
        timeout: 10000,
      });

      const items = Array.isArray(response.data) ? response.data : [];
      const results: MangaSearchResult[] = items.map((item: any) => ({
        id: item.hid || item.slug,
        title: item.title,
        cover: item.md_covers?.[0]?.b2key
          ? `https://meo.comick.pictures/${item.md_covers[0].b2key}`
          : null,
        provider: this.name,
        status: item.status === 1 ? 'ongoing' : 'completed',
        latestChapter: item.last_chapter ? String(item.last_chapter) : undefined,
      }));

      globalCache.set(cacheKey, results, 3600);
      return results;
    } catch {
      return [];
    }
  }

  async getChapters(mangaId: string): Promise<MangaChapter[]> {
    const cacheKey = this.getCacheKey('chapters', mangaId);
    const cached = globalCache.get<MangaChapter[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await axios.get(`${this.getBaseUrl()}/comic/${mangaId}/chapters`, {
        params: { lang: 'en', limit: 1000 },
        timeout: 10000,
      });

      const chapters: MangaChapter[] = (response.data?.chapters || []).map((ch: any) => ({
        id: ch.hid,
        chapter: ch.chap || '0',
        title: ch.title || `Chapter ${ch.chap || '0'}`,
        releaseDate: ch.created_at || null,
      }));

      globalCache.set(cacheKey, chapters, 3600);
      return chapters;
    } catch {
      return [];
    }
  }

  async getPages(chapterId: string): Promise<MangaChapterPage[]> {
    const cacheKey = this.getCacheKey('pages', chapterId);
    const cached = globalCache.get<MangaChapterPage[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await axios.get(`${this.getBaseUrl()}/chapter/${chapterId}`, {
        timeout: 10000,
      });

      const images: any[] = response.data?.chapter?.images || [];
      const pages: MangaChapterPage[] = images.map((img: any, idx: number) => ({
        page: idx + 1,
        img: `https://meo.comick.pictures/${img.b2key}`,
        headerReferer: 'https://comick.io/',
      }));

      globalCache.set(cacheKey, pages, 3600);
      return pages;
    } catch {
      return [];
    }
  }
}

export const comixProvider = new ComixProvider();

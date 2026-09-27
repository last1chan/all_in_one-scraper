import { BaseMangaProvider } from './base-manga-provider.js';
import { MangaSearchResult, MangaChapter, MangaChapterPage } from '../../types/manga.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class WeebCentralProvider extends BaseMangaProvider {
  readonly name = 'weebcentral';
  readonly defaultBaseUrl = 'https://weebcentral.com';
  readonly mirrorUrls = ['https://weebcentral.com'];
  readonly languages = ['en'];
  readonly isSelfHosted = true;
  readonly librarySize = '35,000+';
  readonly serverType = 'self-hosted' as const;

  constructor() {
    super();
    this.init();
  }

  private getHeaders(customReferer?: string): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Referer': customReferer || `${this.getBaseUrl()}/`,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
  }

  async search(query: string): Promise<MangaSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<MangaSearchResult[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/search/data?text=${encodeURIComponent(query.trim())}`;

    try {
      const response = await axios.get<string>(url, {
        headers: this.getHeaders(`${baseUrl}/search`),
        timeout: 15000,
      });
      const $ = cheerio.load(response.data);
      const results: MangaSearchResult[] = [];

      $('article').each((_, el) => {
        const link = $(el).find('a[href*="/series/"]').first();
        const href = link.attr('href') || '';
        const match = href.match(/\/series\/([a-zA-Z0-9]+)(?:\/([^/?#]+))?/);
        if (!match) return;

        const id = match[1];
        const slug = match[2] || '';
        const title = $(el).find('.font-bold').text().trim() || slug.replace(/-/g, ' ');
        const cover = $(el).find('img').attr('src') || $(el).find('source').attr('srcset') || null;

        if (id && title && !results.some((r) => r.id === id)) {
          results.push({
            id,
            title,
            cover,
            provider: this.name,
          });
        }
      });

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

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/series/${mangaId}/full-chapter-list`;

    try {
      const response = await axios.get<string>(url, {
        headers: this.getHeaders(),
        timeout: 15000,
      });
      const $ = cheerio.load(response.data);
      const chapters: MangaChapter[] = [];

      $('a[href*="/chapters/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/\/chapters\/([a-zA-Z0-9]+)/);
        if (!match) return;

        const id = match[1];
        const titleSpan = $(el).find('span.grow > span').first().text().trim();
        const text = titleSpan || $(el).text().replace(/\s+/g, ' ').trim();
        const numMatch = text.match(/Chapter\s+([\d.]+)/i) || text.match(/([\d.]+)/);
        const chapter = numMatch ? numMatch[1] : '1';

        if (!chapters.some((c) => c.id === id)) {
          chapters.push({
            id,
            chapter,
            title: text || `Chapter ${chapter}`,
          });
        }
      });

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

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/chapters/${chapterId}/images?reading_style=long_strip`;

    try {
      const response = await axios.get<string>(url, {
        headers: this.getHeaders(),
        timeout: 15000,
      });
      const $ = cheerio.load(response.data);
      const pages: MangaChapterPage[] = [];

      $('img').each((idx, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && (src.startsWith('http') || src.startsWith('//'))) {
          const img = src.startsWith('//') ? `https:${src}` : src;
          pages.push({
            page: idx + 1,
            img,
            headerReferer: `${baseUrl}/`,
          });
        }
      });

      globalCache.set(cacheKey, pages, 3600);
      return pages;
    } catch {
      return [];
    }
  }
}

export const weebCentralProvider = new WeebCentralProvider();

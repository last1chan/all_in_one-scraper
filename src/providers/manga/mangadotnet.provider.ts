import { BaseMangaProvider } from './base-manga-provider.js';
import { MangaSearchResult, MangaChapter, MangaChapterPage } from '../../types/manga.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class MangaDotNetProvider extends BaseMangaProvider {
  readonly name = 'mangadotnet';
  readonly defaultBaseUrl = 'https://mangadot.net';
  readonly mirrorUrls = ["https://mangadot.net","https://manga.net"];
  readonly languages = ['en'];
  readonly isSelfHosted = false;
  readonly librarySize = '30,000+';
  readonly serverType = 'third-party' as const;
  

  constructor() {
    super();
    this.init();
  }

  private getHeaders(): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Referer': `${this.getBaseUrl()}/`,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
  }

  async search(query: string): Promise<MangaSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<MangaSearchResult[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/search?keyword=${encodeURIComponent(query.trim())}`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 10000 });
      const $ = cheerio.load(response.data);
      const results: MangaSearchResult[] = [];

      $('.media, .manga-card').each((_, el) => {
        const link = $(el).is('a') ? $(el) : $(el).find('a').first();
        const href = link.attr('href') || '';
        const match = href.match(new RegExp('/manga/([^/?#]+)'));
        if (!match) return;

        const id = match[1];
        const title = $(el).find('h3, h2, .title, .name').text().trim() || link.attr('title') || link.text().trim();
        const cover = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || null;

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
    const url = `${baseUrl}/manga/${mangaId}`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 10000 });
      const $ = cheerio.load(response.data);
      const chapters: MangaChapter[] = [];

      $('.chapter-list a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const chId = href.split('/').filter(Boolean).pop() || href;
        const text = $(el).text().trim();
        const chNumMatch = text.match(/(\d+(?:\.\d+)?)/);
        const chapter = chNumMatch ? chNumMatch[1] : '1';

        if (chId && !chapters.some((c) => c.id === chId)) {
          chapters.push({
            id: chId,
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
    const url = `${baseUrl}/read/${chapterId}`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 10000 });
      const $ = cheerio.load(response.data);
      const pages: MangaChapterPage[] = [];

      $('.page-list img').each((idx, el) => {
        const src = $(el).attr('data-src') || $(el).attr('src');
        if (src && !src.includes('placeholder') && !src.includes('loading')) {
          pages.push({
            page: idx + 1,
            img: src.startsWith('//') ? `https:${src}` : src,
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

export const mangaDotNetProvider = new MangaDotNetProvider();

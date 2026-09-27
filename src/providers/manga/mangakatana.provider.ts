import { BaseMangaProvider } from './base-manga-provider.js';
import { MangaSearchResult, MangaChapter, MangaChapterPage } from '../../types/manga.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class MangaKatanaProvider extends BaseMangaProvider {
  readonly name = 'mangakatana';
  readonly defaultBaseUrl = 'https://mangakatana.com';
  readonly mirrorUrls = ['https://mangakatana.com'];
  readonly languages = ['en'];
  readonly isSelfHosted = true;
  readonly librarySize = '38,000+';
  readonly serverType = 'self-hosted' as const;

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
    const url = `${baseUrl}/?search=${encodeURIComponent(query.trim())}&search_by=book_name`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 15000 });
      const $ = cheerio.load(response.data);
      const results: MangaSearchResult[] = [];

      $('#book_list .item, .unit').each((_, el) => {
        const link = $(el).is('a') ? $(el) : $(el).find('h3.title a, .title a, a').first();
        const href = link.attr('href') || '';
        const match = href.match(/\/manga\/([^/?#]+)/);
        if (!match) return;

        const id = match[1];
        const title = link.text().trim() || $(el).find('h3, h2, .title').text().trim();
        const cover = $(el).find('.wrap_img img, img').attr('src') || $(el).find('img').attr('data-src') || null;

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
    const cleanId = mangaId.replace(/^(https?:\/\/[^/]+\/manga\/|\/manga\/)/, '');
    const url = `${baseUrl}/manga/${cleanId}`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 15000 });
      const $ = cheerio.load(response.data);
      const chapters: MangaChapter[] = [];

      $('.chapters table tr, .chapters .chapter').each((_, el) => {
        const link = $(el).find('.chapter a, a').first();
        const href = link.attr('href') || '';
        const match = href.match(/\/manga\/[^/]+\/(c[^/?#]+)/);
        const chSlug = match ? match[1] : href.split('/').filter(Boolean).pop();
        if (!chSlug) return;

        const text = link.text().trim();
        const chNumMatch = text.match(/Chapter\s+([\d.]+)/i) || text.match(/([\d.]+)/);
        const chapter = chNumMatch ? chNumMatch[1] : '1';
        const fullId = `${cleanId}$${chSlug}`;

        if (!chapters.some((c) => c.id === fullId)) {
          chapters.push({
            id: fullId,
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
    let url: string;
    if (chapterId.startsWith('http')) {
      url = chapterId;
    } else if (chapterId.includes('$')) {
      const [mId, ch] = chapterId.split('$');
      url = `${baseUrl}/manga/${mId}/${ch}`;
    } else {
      url = `${baseUrl}/manga/${chapterId}`;
    }

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 20000 });
      const pages: MangaChapterPage[] = [];

      // MangaKatana embeds images in JavaScript variable array (var thzq = ['...'])
      const jsMatch = response.data.match(/var\s+(?:thzq|\w+)\s*=\s*(\[[^\]]+\]);?/);
      if (jsMatch) {
        const raw = jsMatch[1];
        const urls = [...raw.matchAll(/['"](https?:[^'"]+)['"]/g)].map((m) => m[1]);
        urls.forEach((img, idx) => {
          pages.push({
            page: idx + 1,
            img,
            headerReferer: `${baseUrl}/`,
          });
        });
      }

      if (pages.length === 0) {
        const $ = cheerio.load(response.data);
        $('#imgs img, .wrap_img img, .chapter_content img').each((idx, el) => {
          const src = $(el).attr('data-src') || $(el).attr('src');
          if (src && !src.includes('placeholder') && !src.includes('loading')) {
            pages.push({
              page: idx + 1,
              img: src.startsWith('//') ? `https:${src}` : src,
              headerReferer: `${baseUrl}/`,
            });
          }
        });
      }

      globalCache.set(cacheKey, pages, 3600);
      return pages;
    } catch {
      return [];
    }
  }
}

export const mangaKatanaProvider = new MangaKatanaProvider();

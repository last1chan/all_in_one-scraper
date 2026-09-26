import { BaseMangaProvider } from './base-manga-provider.js';
import { MangaSearchResult, MangaChapter, MangaChapterPage } from '../../types/manga.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class MangaKProvider extends BaseMangaProvider {
  readonly name = 'mangak';
  readonly defaultBaseUrl = 'https://mangak.io';
  readonly mirrorUrls = ["https://mangak.io","https://mangakakalot.com","https://chapmanganato.to"];
  readonly languages = ['en'];
  readonly isSelfHosted = true;
  readonly librarySize = '55,000+';
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
    const url = `${baseUrl}/search?q=${encodeURIComponent(query.trim())}`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 10000 });
      const results: MangaSearchResult[] = [];

      // 1. Try Next.js __NEXT_DATA__ SSR items
      const nextMatch = response.data.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextMatch) {
        try {
          const parsed = JSON.parse(nextMatch[1]);
          const ssrItems = parsed.props?.pageProps?.ssrItems || [];
          for (const item of ssrItems) {
            const id = item.slug || item.id;
            const title = item.name || item.title || item.displayAltName;
            const cover = item.cover || null;
            if (id && title) {
              results.push({
                id,
                title,
                cover,
                provider: this.name,
              });
            }
          }
        } catch {
          // fallback to cheerio
        }
      }

      // 2. Fallback to Cheerio HTML parsing
      if (results.length === 0) {
        const $ = cheerio.load(response.data);
        $('.story_item, .search-story-item, a[href*="/manga/"], a[href*="/comic/"]').each((_, el) => {
          const link = $(el).is('a') ? $(el) : $(el).find('a').first();
          const href = link.attr('href') || '';
          const match = href.match(new RegExp('/(?:manga|story|comic)/([^/?#]+)'));
          const id = match ? match[1] : href.replace(/^\//, '');
          const title = $(el).find('h3, h2, .title, .name').text().trim() || link.attr('title') || link.text().trim();
          const cover = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || null;

          if (id && title && !results.some((r) => r.id === id)) {
            results.push({ id, title, cover, provider: this.name });
          }
        });
      }

      globalCache.set(cacheKey, results, 3600);
      return results;
    } catch (err: any) {
      console.error('MangaK search error:', err?.message || err);
      return [];
    }
  }

  async getChapters(mangaId: string): Promise<MangaChapter[]> {
    const cacheKey = this.getCacheKey('chapters', mangaId);
    const cached = globalCache.get<MangaChapter[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const cleanId = mangaId.replace(/^\//, '');
    const url = `${baseUrl}/${cleanId}`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 10000 });
      const chapters: MangaChapter[] = [];

      // 1. Try Next.js __NEXT_DATA__
      const nextMatch = response.data.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextMatch) {
        try {
          const parsed = JSON.parse(nextMatch[1]);
          const chList = parsed.props?.pageProps?.initialManga?.chapters || [];
          for (const ch of chList) {
            const chId = ch.url || ch.slug || ch.id;
            const chapterNum = String(ch.number || '1');
            const title = ch.name || `Chapter ${chapterNum}`;
            if (chId) {
              chapters.push({
                id: chId.startsWith('/') ? chId : `/${cleanId}/${chId}`,
                chapter: chapterNum,
                title,
              });
            }
          }
        } catch {
          // fallback to cheerio
        }
      }

      // 2. Fallback to Cheerio HTML
      if (chapters.length === 0) {
        const $ = cheerio.load(response.data);
        $('.chapter-list .row span a, .row-content-chapter li a, .list-chapter a, a[href*="chapter"]').each((_, el) => {
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
      }

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
    const cleanPath = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
    const url = `${baseUrl}${cleanPath}`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 10000 });
      const pages: MangaChapterPage[] = [];

      // 1. Try Next.js __NEXT_DATA__
      const nextMatch = response.data.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextMatch) {
        try {
          const parsed = JSON.parse(nextMatch[1]);
          const initialChapter = parsed.props?.pageProps?.initialChapter || parsed.props?.pageProps?.chapter;
          const imgList = initialChapter?.images || initialChapter?.pages || [];
          imgList.forEach((src: string, idx: number) => {
            if (src) {
              pages.push({
                page: idx + 1,
                img: src,
                headerReferer: `${baseUrl}/`,
              });
            }
          });
        } catch {
          // fallback to cheerio
        }
      }

      // 2. Fallback to Cheerio HTML
      if (pages.length === 0) {
        const $ = cheerio.load(response.data);
        $('.container-chapter-reader img, img.reader-img').each((idx, el) => {
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

export const mangaKProvider = new MangaKProvider();

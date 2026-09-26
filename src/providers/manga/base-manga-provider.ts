import { IMangaProvider, MangaSearchResult, MangaChapter, MangaChapterPage } from '../../types/manga.js';
import { domainManager } from '../../core/domain-manager.js';

export abstract class BaseMangaProvider implements IMangaProvider {
  abstract readonly name: string;
  abstract readonly defaultBaseUrl: string;
  abstract readonly mirrorUrls: string[];
  readonly languages: string[] = ['en'];
  readonly isSelfHosted: boolean = false;
  readonly librarySize: string = 'Unknown';
  readonly serverType: 'self-hosted' | 'hybrid' | 'third-party' = 'third-party';
  readonly notes?: string;

  protected init(): void {
    domainManager.registerProvider(`manga:${this.name}`, this.defaultBaseUrl, this.mirrorUrls);
  }

  getBaseUrl(): string {
    return domainManager.getActiveDomain(`manga:${this.name}`) || this.defaultBaseUrl;
  }

  setBaseUrl(url: string): void {
    domainManager.setDomain(`manga:${this.name}`, url);
  }

  protected getCacheKey(prefix: string, ...parts: (string | number)[]): string {
    return `manga:${this.name}:${prefix}:${parts.join(':')}`;
  }

  abstract search(query: string): Promise<MangaSearchResult[]>;
  abstract getChapters(mangaId: string): Promise<MangaChapter[]>;
  abstract getPages(chapterId: string): Promise<MangaChapterPage[]>;
}

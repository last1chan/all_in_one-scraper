export interface MangaSearchResult {
  id: string;
  title: string;
  cover?: string | null;
  altTitles?: string[];
  provider: string;
  status?: string;
  latestChapter?: string;
}

export interface MangaChapter {
  id: string;
  chapter: string | number;
  title?: string;
  releaseDate?: string | null;
}

export interface MangaChapterPage {
  page: number;
  img: string;
  headerReferer?: string;
}

export interface IMangaProvider {
  readonly name: string;
  readonly defaultBaseUrl: string;
  readonly mirrorUrls: string[];
  readonly languages: string[];
  readonly isSelfHosted?: boolean;
  readonly librarySize?: string;
  readonly serverType?: 'self-hosted' | 'hybrid' | 'third-party';
  readonly notes?: string;

  getBaseUrl(): string;
  setBaseUrl(url: string): void;
  search(query: string): Promise<MangaSearchResult[]>;
  getChapters(mangaId: string): Promise<MangaChapter[]>;
  getPages(chapterId: string): Promise<MangaChapterPage[]>;
}

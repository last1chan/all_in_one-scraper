import { IMangaProvider } from '../../types/manga.js';
import { EverythingMoeSourceInfo } from '../../types/provider.js';

import { comixProvider, ComixProvider } from './comix.provider.js';
import { mangaFireProvider, MangaFireProvider } from './mangafire.provider.js';
import { weebCentralProvider, WeebCentralProvider } from './weebcentral.provider.js';
import { mangaKatanaProvider, MangaKatanaProvider } from './mangakatana.provider.js';
import { mangaKProvider, MangaKProvider } from './mangak.provider.js';
import { atsumaruProvider, AtsumaruProvider } from './atsumaru.provider.js';
import { mangaCloudProvider, MangaCloudProvider } from './mangacloud.provider.js';
import { vyMangaProvider, VyMangaProvider } from './vymanga.provider.js';
import { chikariMoeProvider, ChikariMoeProvider } from './chikarimoe.provider.js';
import { scansGgProvider, ScansGgProvider } from './scansgg.provider.js';
import { mangaDotNetProvider, MangaDotNetProvider } from './mangadotnet.provider.js';
import { mangaBallProvider, MangaBallProvider } from './mangaball.provider.js';
import { mangaGoProvider, MangaGoProvider } from './mangago.provider.js';
import { oniSagaProvider, OniSagaProvider } from './onisaga.provider.js';
import { mKissaMangaProvider, MKissaMangaProvider } from './mkissamanga.provider.js';
import { mangaTaroProvider, MangaTaroProvider } from './mangataro.provider.js';
import { xComicProvider, XComicProvider } from './xcomic.provider.js';
import { kaliScanProvider, KaliScanProvider } from './kaliscan.provider.js';
import { likeMangaProvider, LikeMangaProvider } from './likemanga.provider.js';
import { mangaHubProvider, MangaHubProvider } from './mangahub.provider.js';

export {
  BaseMangaProvider,
} from './base-manga-provider.js';

export {
  comixProvider,
  ComixProvider,
  mangaFireProvider,
  MangaFireProvider,
  weebCentralProvider,
  WeebCentralProvider,
  mangaKatanaProvider,
  MangaKatanaProvider,
  mangaKProvider,
  MangaKProvider,
  atsumaruProvider,
  AtsumaruProvider,
  mangaCloudProvider,
  MangaCloudProvider,
  vyMangaProvider,
  VyMangaProvider,
  chikariMoeProvider,
  ChikariMoeProvider,
  scansGgProvider,
  ScansGgProvider,
  mangaDotNetProvider,
  MangaDotNetProvider,
  mangaBallProvider,
  MangaBallProvider,
  mangaGoProvider,
  MangaGoProvider,
  oniSagaProvider,
  OniSagaProvider,
  mKissaMangaProvider,
  MKissaMangaProvider,
  mangaTaroProvider,
  MangaTaroProvider,
  xComicProvider,
  XComicProvider,
  kaliScanProvider,
  KaliScanProvider,
  likeMangaProvider,
  LikeMangaProvider,
  mangaHubProvider,
  MangaHubProvider,
};

export class MangaProviderRegistry {
  private providers: Map<string, IMangaProvider> = new Map();

  constructor() {
    // Priority: self-hosted servers with confirmed library sizes first
    this.register(comixProvider);
    this.register(mangaFireProvider);
    this.register(weebCentralProvider);
    this.register(mangaKatanaProvider);
    this.register(mangaKProvider);
    this.register(atsumaruProvider);
    this.register(mangaCloudProvider);
    this.register(vyMangaProvider);
    this.register(chikariMoeProvider);
    this.register(scansGgProvider);

    // Third-party manga aggregators
    this.register(mangaDotNetProvider);
    this.register(mangaBallProvider);
    this.register(mangaGoProvider);
    this.register(oniSagaProvider);
    this.register(mKissaMangaProvider);
    this.register(mangaTaroProvider);
    this.register(xComicProvider);
    this.register(kaliScanProvider);
    this.register(likeMangaProvider);
    this.register(mangaHubProvider);
  }

  register(provider: IMangaProvider): void {
    this.providers.set(provider.name.toLowerCase(), provider);
  }

  getProvider(name: string): IMangaProvider | undefined {
    return this.providers.get(name.toLowerCase());
  }

  getAllProviders(): IMangaProvider[] {
    return Array.from(this.providers.values());
  }

  getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }

  getSelfHostedProviders(): IMangaProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.isSelfHosted === true);
  }

  getEverythingMoeIndex(): EverythingMoeSourceInfo[] {
    return Array.from(this.providers.values()).map((p) => ({
      name: p.name,
      baseUrl: p.defaultBaseUrl,
      isSelfHosted: p.isSelfHosted ?? false,
      librarySize: p.librarySize ?? 'Unknown',
      serverType: p.serverType ?? 'third-party',
      languages: p.languages,
      notes: p.notes,
      mediaType: 'manga',
    }));
  }
}

export const mangaProviderRegistry = new MangaProviderRegistry();

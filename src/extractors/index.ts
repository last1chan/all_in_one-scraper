import { IVideoExtractor, ExtractedDetails } from './types.js';
import { vidplayExtractor } from './vidplay.js';
import { megaPlayExtractor } from './megaplay.js';
import { dataSvExtractor } from './datasv.js';
import { vidmolyExtractor } from './vidmoly.js';
import { kwikExtractor } from './kwik.js';

export type { IVideoExtractor, ExtractedDetails };
export { vidplayExtractor } from './vidplay.js';
export { megaPlayExtractor } from './megaplay.js';
export { dataSvExtractor } from './datasv.js';
export { vidmolyExtractor } from './vidmoly.js';
export { kwikExtractor } from './kwik.js';

export class ExtractorManager {
  private extractors: IVideoExtractor[] = [
    vidplayExtractor,
    megaPlayExtractor,
    dataSvExtractor,
    vidmolyExtractor,
    kwikExtractor,
  ];

  registerExtractor(extractor: IVideoExtractor): void {
    this.extractors.unshift(extractor);
  }

  findExtractor(url: string): IVideoExtractor | null {
    return this.extractors.find((ext) => ext.matches(url)) ?? null;
  }

  async extract(embedUrl: string, referer?: string): Promise<ExtractedDetails | null> {
    const extractor = this.findExtractor(embedUrl);
    if (!extractor) return null;
    return extractor.extract(embedUrl, referer);
  }
}

export const extractorManager = new ExtractorManager();

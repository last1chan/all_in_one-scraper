import { IVideoExtractor, ExtractedDetails } from './types.js';
import { HttpClient } from '../core/http-client.js';
import { VideoSource } from '../types/anime.js';

export class DataSvExtractor implements IVideoExtractor {
  readonly name = 'datasv';

  matches(url: string): boolean {
    return /play\.echovideo\.ru\/embed-20\//i.test(url);
  }

  async extract(embedUrl: string, referer?: string): Promise<ExtractedDetails> {
    const url = new URL(embedUrl);
    const id = url.pathname.match(/^\/embed-20\/([^/]+)$/i)?.[1];
    if (!id) {
      throw new Error(`DataSvExtractor: Cannot extract ID from ${embedUrl}`);
    }

    const endpoint = new URL('/embed-20/getSources', url.origin);
    endpoint.searchParams.set('id', id);

    const data = await HttpClient.getJson<any>(endpoint.href, {
      referer: embedUrl,
      isAjax: true,
    });

    const sources: VideoSource[] = [];
    for (const [quality, urls] of Object.entries(data?.sources ?? {})) {
      for (const source of Array.isArray(urls) ? urls : [urls]) {
        if (typeof source === 'string' && source) {
          sources.push({
            url: source,
            type: source.includes('.m3u8') ? 'hls' : 'mp4',
            quality,
            isM3U8: source.includes('.m3u8'),
          });
        }
      }
    }

    if (!sources.length) {
      throw new Error(`DataSvExtractor: No sources found in response from ${embedUrl}`);
    }

    return {
      origin: url.origin,
      sources,
      subtitles: [],
    };
  }
}

export const dataSvExtractor = new DataSvExtractor();

import { IVideoExtractor, ExtractedDetails } from './types.js';
import { HttpClient } from '../core/http-client.js';
import { VideoSource } from '../types/anime.js';

export class VidmolyExtractor implements IVideoExtractor {
  readonly name = 'vidmoly';

  matches(url: string): boolean {
    return /vidmoly\.(net|biz|to|me)/i.test(url);
  }

  async extract(embedUrl: string, referer?: string): Promise<ExtractedDetails> {
    const url = embedUrl.startsWith('//') ? `https:${embedUrl}` : embedUrl;
    const html = await HttpClient.get(url, {
      referer: referer || 'https://vidmoly.to/',
    });

    const match = html.match(/sources:\s*\[\s*\{\s*file:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/);
    if (!match) {
      throw new Error(`VidmolyExtractor: m3u8 playlist not found in embed HTML: ${url}`);
    }

    const m3u8Url = match[1];
    const sources: VideoSource[] = [
      {
        url: m3u8Url,
        type: 'hls',
        isM3U8: true,
      },
    ];

    return {
      origin: new URL(url).origin,
      sources,
      subtitles: [],
    };
  }
}

export const vidmolyExtractor = new VidmolyExtractor();

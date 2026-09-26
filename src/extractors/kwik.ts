import { IVideoExtractor, ExtractedDetails } from './types.js';
import { HttpClient } from '../core/http-client.js';
import { VideoSource } from '../types/anime.js';

function safeUnpack(packedSource: string): string {
  try {
    const argsRegex = /}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'/;
    const match = argsRegex.exec(packedSource);
    if (!match) return packedSource;

    const [_, p, aStr, cStr, kStr] = match;
    const a = parseInt(aStr);
    const c = parseInt(cStr);
    const k = kStr.split('|');

    const base62 = (n: number): string => {
      const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      return n < a ? chars[n] : base62(Math.floor(n / a)) + chars[n % a];
    };

    const dict: Record<string, string> = {};
    for (let i = 0; i < c; i++) {
      const key = base62(i);
      dict[key] = k[i] || key;
    }

    return p.replace(/\b\w+\b/g, (word) => dict[word] || word);
  } catch {
    return packedSource;
  }
}

export class KwikExtractor implements IVideoExtractor {
  readonly name = 'kwik';

  matches(url: string): boolean {
    return /kwik\.[^/]+\//i.test(url) || /kwikk\.[^/]+\//i.test(url);
  }

  async extract(embedUrl: string, referer?: string): Promise<ExtractedDetails> {
    const html = await HttpClient.get(embedUrl, {
      referer: referer || 'https://animepahe.ru/',
    });

    const unpacked = safeUnpack(html);
    const m3u8Match = unpacked.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i) ||
                      html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);

    const sources: VideoSource[] = [];

    if (m3u8Match) {
      sources.push({
        url: m3u8Match[0],
        type: 'hls',
        isM3U8: true,
        quality: 'auto',
      });
    } else {
      sources.push({
        url: embedUrl,
        type: 'embed',
        isM3U8: false,
      });
    }

    return {
      origin: this.name,
      sources,
      subtitles: [],
    };
  }
}

export const kwikExtractor = new KwikExtractor();

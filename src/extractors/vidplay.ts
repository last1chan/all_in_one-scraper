import { IVideoExtractor, ExtractedDetails } from './types.js';
import { HttpClient } from '../core/http-client.js';
import { SubtitleTrack, VideoSource } from '../types/anime.js';

export class VidplayExtractor implements IVideoExtractor {
  readonly name = 'vidplay';

  matches(url: string): boolean {
    return /play\.echovideo\.ru\/embed-[01]\//i.test(url) || /vidplay\.[^/]+\/embed-[01]\//i.test(url);
  }

  async extract(embedUrl: string, referer?: string): Promise<ExtractedDetails> {
    const url = new URL(embedUrl);
    const match = url.pathname.match(/^\/(embed-[01])\/([^/]+)$/i);
    const type = match?.[1];
    const id = match?.[2];

    if (!id || !type) {
      throw new Error(`Cannot parse Vidplay parameters from: ${embedUrl}`);
    }

    const endpoint = new URL(`/${type}/getSources`, url.origin);
    endpoint.searchParams.set('id', id);

    const data = await HttpClient.getJson<any>(endpoint.href, {
      referer: embedUrl,
      isAjax: true,
    });

    const rawSources = Array.isArray(data?.sources)
      ? data.sources.map((item: any) => (typeof item === 'string' ? item : item?.file ?? item?.url)).filter(Boolean)
      : typeof data?.sources === 'string'
      ? [data.sources]
      : [];

    const sources: VideoSource[] = rawSources.map((srcUrl: string) => ({
      url: srcUrl,
      type: srcUrl.includes('.m3u8') ? 'hls' : 'mp4',
      isM3U8: srcUrl.includes('.m3u8'),
    }));

    const subtitles: SubtitleTrack[] = Array.isArray(data?.tracks)
      ? data.tracks
          .filter((t: any) => t.file || t.url)
          .map((t: any) => ({
            url: t.file || t.url,
            label: t.label || 'English',
            srclang: (t.label || 'en').toLowerCase().slice(0, 2),
            isDefault: !!t.default,
          }))
      : [];

    return {
      origin: url.origin,
      sources,
      subtitles,
      intro: data?.intro || null,
      outro: data?.outro || null,
    };
  }
}

export const vidplayExtractor = new VidplayExtractor();

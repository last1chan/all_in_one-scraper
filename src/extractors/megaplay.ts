import crypto from 'node:crypto';
import { IVideoExtractor, ExtractedDetails } from './types.js';
import { HttpClient } from '../core/http-client.js';
import { VideoSource, SubtitleTrack } from '../types/anime.js';

function decodeScriptString(value: string): string {
  return value.replace(/\\u([\dA-Fa-f]{4})|\\x([\dA-Fa-f]{2})|\\([\\'"bnfrtv0])/g, (_, unicode, hex, escaped) => {
    if (unicode) return String.fromCharCode(Number.parseInt(unicode, 16));
    if (hex) return String.fromCharCode(Number.parseInt(hex, 16));
    const escapes: Record<string, string> = { b: '\b', n: '\n', f: '\f', r: '\r', t: '\t', v: '\v', '0': '\0' };
    return escapes[escaped] ?? escaped;
  });
}

function getScriptStrings(script: string): string[] {
  const strings: string[] = [];
  let index = 0;
  let previous = '';
  while (index < script.length) {
    const char = script[index];
    if (char === '/' && script[index + 1] === '/') {
      index = script.indexOf('\n', index + 2);
      if (index < 0) break;
      continue;
    }
    if (char === '/' && script[index + 1] === '*') {
      index = script.indexOf('*/', index + 2);
      if (index < 0) break;
      index += 2;
      continue;
    }
    if (char === '/' && /[=(:,[!&|?{};]/.test(previous)) {
      index++;
      let inClass = false;
      while (index < script.length) {
        if (script[index] === '\\') {
          index += 2;
          continue;
        }
        if (script[index] === '[') inClass = true;
        if (script[index] === ']') inClass = false;
        if (script[index] === '/' && !inClass) {
          index++;
          while (/[a-z]/i.test(script[index] ?? '')) index++;
          break;
        }
        index++;
      }
      continue;
    }
    if (char === '\'' || char === '"') {
      const quote = char;
      let value = '';
      index++;
      while (index < script.length && script[index] !== quote) {
        if (script[index] === '\\' && index + 1 < script.length) value += script[index++];
        value += script[index++];
      }
      strings.push(decodeScriptString(value));
      index++;
      continue;
    }
    if (char === '`') {
      index++;
      while (index < script.length && script[index] !== '`') index += script[index] === '\\' ? 2 : 1;
      index++;
      continue;
    }
    if (!/\s/.test(char)) previous = char;
    index++;
  }
  return [...new Set(strings)];
}

function getMegaPlayRoutes(script: string): { legacy: string | null; modern: string | null } {
  const routes = getScriptStrings(script)
    .filter((value) => /^stream\/getSources[\w/-]*$/i.test(value))
    .sort((left, right) => left.length - right.length);
  const legacy = routes[0] ?? null;
  const modern = routes.find((route) => route !== legacy && route.startsWith(legacy)) ?? null;
  return { legacy, modern };
}

function decryptMegaPlaySource(value: string | undefined, script: string): string | null {
  if (!value) return null;
  const encrypted = Buffer.from(value, 'base64url');
  if (!encrypted.length || encrypted.length % 16) return null;
  const values = getScriptStrings(script).filter(
    (item) => Buffer.byteLength(item) > 0 && Buffer.byteLength(item) <= 32
  );
  const ivs = values.filter((item) => Buffer.byteLength(item) === 16);
  for (const keyValue of values) {
    const key = Buffer.alloc(32);
    Buffer.from(keyValue).copy(key);
    for (const ivValue of ivs) {
      try {
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivValue));
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        const data = JSON.parse(decrypted.toString('utf8'));
        const source = data?.file ?? data?.url;
        if (typeof source === 'string' && source) return source;
      } catch {}
    }
  }
  return null;
}

export class MegaPlayExtractor implements IVideoExtractor {
  readonly name = 'megaplay';

  matches(url: string): boolean {
    return /megaplay\.[^/]+\/stream\//i.test(url) || /rabbitstream\.[^/]+\/stream\//i.test(url);
  }

  async extract(embedUrl: string, referer?: string): Promise<ExtractedDetails> {
    const pageUrl = new URL(embedUrl);
    const pageHtml = await HttpClient.get(pageUrl.href, {
      referer: referer ?? `${pageUrl.origin}/`,
    });

    const fileId = pageHtml.match(/data-id=["']([^"']+)["']/i)?.[1];
    if (!fileId) throw new Error(`MegaPlay file ID not found in page: ${embedUrl}`);

    const scriptUrls = [...pageHtml.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(
      (match) => new URL(match[1], pageUrl).href
    );

    const scripts = await Promise.all(
      scriptUrls.map(async (url) => {
        try {
          return await HttpClient.get(url, { referer: pageUrl.href });
        } catch {
          return null;
        }
      })
    );

    const script = scripts.find((value) => value && /getSources/i.test(value) && /AES-CBC/i.test(value));
    if (!script) throw new Error(`MegaPlay client script not found: ${embedUrl}`);

    const { legacy, modern } = getMegaPlayRoutes(script);
    if (!legacy && !modern) throw new Error(`MegaPlay source routes not found: ${embedUrl}`);

    const buildEndpoint = (path: string) => {
      const ep = new URL(path, pageUrl.origin);
      ep.searchParams.append('id', fileId);
      return ep.href;
    };

    const [modernData, legacyData] = await Promise.all([
      modern
        ? HttpClient.getJson<any>(buildEndpoint(modern), {
            referer: pageUrl.href,
            isAjax: true,
          }).catch(() => null)
        : null,
      legacy
        ? HttpClient.getJson<any>(buildEndpoint(legacy), {
            referer: pageUrl.href,
            isAjax: true,
          }).catch(() => null)
        : null,
    ]);

    const directUrl =
      modernData?.sources?.file ??
      legacyData?.sources?.file ??
      decryptMegaPlaySource(legacyData?.enc || modernData?.enc, script);

    if (!directUrl) {
      throw new Error(`MegaPlay response contains no extractable video sources: ${embedUrl}`);
    }

    const sources: VideoSource[] = [
      {
        url: directUrl,
        type: directUrl.includes('.m3u8') ? 'hls' : 'mp4',
        isM3U8: directUrl.includes('.m3u8'),
      },
    ];

    const metadata = modernData ?? legacyData ?? {};
    const subtitles: SubtitleTrack[] = Array.isArray(metadata?.tracks)
      ? metadata.tracks
          .filter((t: any) => t.file)
          .map((t: any) => ({
            url: t.file,
            label: t.label || 'English',
            srclang: (t.label || 'en').toLowerCase().slice(0, 2),
            isDefault: !!t.default,
          }))
      : [];

    return {
      origin: pageUrl.origin,
      sources,
      subtitles,
      intro: metadata.intro || null,
      outro: metadata.outro || null,
    };
  }
}

export const megaPlayExtractor = new MegaPlayExtractor();

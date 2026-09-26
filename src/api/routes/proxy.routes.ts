import { FastifyInstance, FastifyRequest } from 'fastify';
import { Readable } from 'stream';

interface ProxyQuery {
  url: string;
  referer?: string;
}

function unwrapToroplayUrl(rawUrl: string, rawRef?: string): { url: string; referer?: string } {
  try {
    const u = new URL(rawUrl);
    if (
      (u.hostname.includes('toroplay') || u.hostname.includes('cymru') || u.pathname.includes('/watch/')) &&
      u.searchParams.has('url')
    ) {
      const innerUrl = u.searchParams.get('url')!;
      const innerRef = u.searchParams.get('ref') || rawRef || 'https://megaplay.buzz/';
      return { url: innerUrl, referer: innerRef };
    }
  } catch {}
  return { url: rawUrl, referer: rawRef };
}

export function getTargetReferer(parsed: URL, incomingRef?: string): string | null {
  const lower = parsed.hostname.toLowerCase();
  if (
    lower.includes('streamzone') ||
    lower.includes('nexabloom') ||
    lower.includes('megaplay') ||
    lower.includes('quavex') ||
    lower.includes('tyrionx') ||
    lower.includes('toroplay') ||
    lower.includes('cymru') ||
    lower.includes('lunarfrontier') ||
    lower.includes('zhaevor') ||
    lower.includes('echovideo') ||
    lower.includes('anichan')
  ) {
    return 'https://megaplay.buzz/';
  }
  if (
    lower.includes('flixcloud') ||
    lower.includes('megacloud') ||
    lower.includes('rabbitstream') ||
    lower.includes('dokicloud')
  ) {
    return 'https://megacloud.tv/';
  }
  if (lower.includes('anime-dunya') || lower.includes('animedunya')) {
    return 'https://anime-dunya.com/';
  }
  return incomingRef || null;
}

export async function proxyRoutes(fastify: FastifyInstance) {
  fastify.options('/api/proxy/m3u8', async (_request, reply) => {
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      .header('Access-Control-Allow-Headers', '*')
      .code(204)
      .send();
  });

  fastify.options('/api/proxy/segment', async (_request, reply) => {
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization, Accept, Origin, Referer')
      .header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length')
      .code(204)
      .send();
  });

  fastify.get('/api/proxy/m3u8', async (request: FastifyRequest<{ Querystring: ProxyQuery }>, reply) => {
    const { url: rawUrl, referer: rawRef } = request.query;
    if (!rawUrl) {
      return reply.code(400).send({ error: 'Missing "url" query parameter' });
    }

    try {
      const unwrapped = unwrapToroplayUrl(rawUrl, rawRef);
      const targetUrl = unwrapped.url;
      const parsed = new URL(targetUrl);
      const effectiveRef = getTargetReferer(parsed, unwrapped.referer);

      const reqHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      };
      if (effectiveRef) {
        reqHeaders.Referer = effectiveRef;
        try {
          reqHeaders.Origin = new URL(effectiveRef).origin;
        } catch {}
      }

      let response = await fetch(targetUrl, {
        headers: reqHeaders,
        signal: AbortSignal.timeout(30000),
      });
      if (response.status === 403 && reqHeaders.Referer) {
        delete reqHeaders.Referer;
        delete reqHeaders.Origin;
        response = await fetch(targetUrl, {
          headers: reqHeaders,
          signal: AbortSignal.timeout(30000),
        });
      }

      if (!response.ok) {
        return reply.code(response.status).send({ error: `Upstream HTTP ${response.status}` });
      }

      const m3u8Content = await response.text();
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

      const host = request.headers.host;
      const protocol = request.protocol;
      const lines = m3u8Content.split('\n');
      const isMaster = m3u8Content.includes('#EXT-X-STREAM-INF');
      let isVariantNext = false;
      const parsedParent = parsed;

      const rewritten = lines
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;

          if (trimmed.startsWith('#EXT-X-STREAM-INF') || trimmed.startsWith('#EXT-X-MEDIA:')) {
            isVariantNext = true;
          }

          if (trimmed.startsWith('#')) {
            return trimmed.replace(/URI="([^"]+)"/g, (_m, uri) => {
              let abs = uri;
              if (!abs.startsWith('http://') && !abs.startsWith('https://')) {
                const resolved = new URL(abs, baseUrl);
                if (!resolved.search && parsedParent.search) resolved.search = parsedParent.search;
                abs = resolved.href;
              }
              const unwrappedChild = unwrapToroplayUrl(abs, effectiveRef || undefined);
              let childRef = unwrappedChild.referer || effectiveRef;
              try {
                childRef = getTargetReferer(new URL(unwrappedChild.url), childRef || undefined);
              } catch {}
              const finalRef = childRef || effectiveRef;
              const encRef = finalRef ? `&referer=${encodeURIComponent(finalRef)}` : '';
              const target = unwrappedChild.url.includes('.m3u8')
                ? `${protocol}://${host}/api/proxy/m3u8`
                : `${protocol}://${host}/api/proxy/segment`;
              return `URI="${target}?url=${encodeURIComponent(unwrappedChild.url)}${encRef}"`;
            });
          }

          const isSegment =
            trimmed.includes('.ts.') ||
            trimmed.includes('.ts.css') ||
            trimmed.includes('.ts.js') ||
            trimmed.endsWith('.ts') ||
            trimmed.endsWith('.m4s') ||
            trimmed.endsWith('.mp4') ||
            /(?:^|\/|[_-])(?:seg|segment|frag|fragment|chunk|video|audio|track)[-_0-9a-z.]*\.(?:html?|css|js|txt|bin|jpg|png|svg)$/i.test(
              trimmed,
            ) ||
            trimmed.includes('/assets/ey');
          const isPlaylistLine = isVariantNext || (!isSegment && (trimmed.includes('.m3u8') || (isMaster && !trimmed.endsWith('.ts'))));
          isVariantNext = false;

          let absoluteUrl = trimmed;
          if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
            const resolved = new URL(trimmed, baseUrl);
            if (!resolved.search && parsedParent.search) {
              resolved.search = parsedParent.search;
            }
            absoluteUrl = resolved.href;
          }

          const unwrappedChild = unwrapToroplayUrl(absoluteUrl, effectiveRef || undefined);
          let childRef = unwrappedChild.referer || effectiveRef;
          try {
            childRef = getTargetReferer(new URL(unwrappedChild.url), childRef || undefined);
          } catch {}
          const encodedUrl = encodeURIComponent(unwrappedChild.url);
          const finalRef = childRef || effectiveRef;
          const encodedRef = finalRef ? `&referer=${encodeURIComponent(finalRef)}` : '';
          const targetEndpoint = isPlaylistLine
            ? `${protocol}://${host}/api/proxy/m3u8`
            : `${protocol}://${host}/api/proxy/segment`;

          return `${targetEndpoint}?url=${encodedUrl}${encodedRef}`;
        })
        .join('\n');

      reply
        .header('Content-Type', 'application/vnd.apple.mpegurl')
        .header('Access-Control-Allow-Origin', '*')
        .header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        .header('Cache-Control', 'public, max-age=30')
        .send(rewritten);
    } catch (err: any) {
      reply.code(502).send({ error: `Proxy failed: ${err.message}` });
    }
  });

  fastify.get('/api/proxy/segment', async (request: FastifyRequest<{ Querystring: ProxyQuery }>, reply) => {
    const { url: rawUrl, referer: rawRef } = request.query;
    if (!rawUrl) {
      return reply.code(400).send({ error: 'Missing "url" query parameter' });
    }

    try {
      const unwrapped = unwrapToroplayUrl(rawUrl, rawRef);
      const targetUrl = unwrapped.url;
      const parsed = new URL(targetUrl);
      const effectiveRef = getTargetReferer(parsed, unwrapped.referer);

      const reqHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ...(request.headers.range ? { Range: String(request.headers.range) } : {}),
      };
      if (effectiveRef) {
        reqHeaders.Referer = effectiveRef;
        try {
          reqHeaders.Origin = new URL(effectiveRef).origin;
        } catch {}
      }

      let response = await fetch(targetUrl, {
        headers: reqHeaders,
        signal: AbortSignal.timeout(45000),
      });
      if (response.status === 403 && reqHeaders.Referer) {
        delete reqHeaders.Referer;
        delete reqHeaders.Origin;
        response = await fetch(targetUrl, {
          headers: reqHeaders,
          signal: AbortSignal.timeout(45000),
        });
      }

      if (!response.ok && response.status !== 206) {
        return reply.code(response.status).send({ error: `Upstream HTTP ${response.status}` });
      }

      const rawContentType = response.headers.get('content-type');
      const isTs =
        targetUrl.includes('.ts.') ||
        targetUrl.includes('.ts.css') ||
        targetUrl.includes('.ts.js') ||
        targetUrl.endsWith('.ts') ||
        targetUrl.endsWith('.m4s') ||
        targetUrl.endsWith('.mp4') ||
        /(?:^|\/|[_-])(?:seg|segment|frag|fragment|chunk|video|audio|track)[-_0-9a-z.]*\.(?:html?|css|js|txt|bin|jpg|png|svg)/i.test(
          targetUrl,
        ) ||
        targetUrl.includes('/assets/ey');
      const contentType = isTs ? 'video/MP2T' : rawContentType || 'video/MP2T';

      reply
        .header('Content-Type', contentType)
        .header('Access-Control-Allow-Origin', '*')
        .header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        .header('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization, Accept, Origin, Referer')
        .header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length')
        .header('Accept-Ranges', 'bytes');

      if (response.status === 206) {
        reply.code(206);
        const contentRange = response.headers.get('content-range');
        if (contentRange) {
          reply.header('Content-Range', contentRange);
        }
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
          reply.header('Content-Length', contentLength);
        }
      } else {
        reply.header('Cache-Control', 'public, max-age=604800, immutable');
      }

      // Stream directly without in-memory buffering to prevent filling VPS RAM
      // Chunked / partial stream piping ensures ERR_CONTENT_LENGTH_MISMATCH is prevented while supporting byte seeking
      if (response.body) {
        return reply.send(Readable.fromWeb(response.body as any));
      }

      return reply.code(response.status === 206 ? 206 : 200).send();
    } catch (err: any) {
      reply.code(502).send({ error: `Segment proxy failed: ${err.message}` });
    }
  });
}

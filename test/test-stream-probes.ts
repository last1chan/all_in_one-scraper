import axios from 'axios';
import { providerRegistry } from '../src/providers/index.js';
import { unifiedScraperService } from '../src/services/unified-scraper.service.js';

interface StreamTestResult {
  anime: string;
  provider: string;
  server?: string;
  sourceUrl: string;
  streamType: string;
  headersUsed: Record<string, string>;
  masterStatus: number | string;
  variantStatus?: number | string;
  segmentStatus?: number | string;
  segmentUrl?: string;
  error?: string;
  timeMs: number;
}

const TEST_SHOWS = [
  { title: 'Naruto', anilistId: 20, episode: 1 },
  { title: 'One Piece', anilistId: 21, episode: 1 },
  { title: 'Jujutsu Kaisen', anilistId: 113415, episode: 1 },
  { title: 'Attack on Titan', anilistId: 16498, episode: 1 },
];

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

function getTargetReferer(parsed: URL, incomingRef?: string): string | null {
  const lower = parsed.hostname.toLowerCase();
  if (
    lower.includes('streamzone') ||
    lower.includes('nexabloom') ||
    lower.includes('megaplay') ||
    lower.includes('quavex') ||
    lower.includes('tyrionx') ||
    lower.includes('toroplay') ||
    lower.includes('cymru')
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

async function probeUrl(url: string, headers: Record<string, string>): Promise<{ status: number; text?: string; dataLength?: number; err?: string }> {
  try {
    const res = await axios.get(url, {
      headers,
      timeout: 10000,
      validateStatus: () => true,
      responseType: 'text',
      maxRedirects: 5,
    });
    return {
      status: res.status,
      text: typeof res.data === 'string' ? res.data : '',
      dataLength: typeof res.data === 'string' ? res.data.length : 0,
    };
  } catch (err: any) {
    return {
      status: err.response?.status || err.code || 'ERR',
      err: err.message,
    };
  }
}

async function testSingleStream(showTitle: string, anilistId: number, epNum: number, pName: string): Promise<StreamTestResult[]> {
  const results: StreamTestResult[] = [];
  const start = Date.now();
  console.log(`\n--------------------------------------------------------------`);
  console.log(`[TEST] ${showTitle} (AniList: ${anilistId}, Ep: ${epNum}) on Provider: ${pName.toUpperCase()}`);

  try {
    const streamResp = await unifiedScraperService.resolveStream(anilistId, epNum, 'sub', pName);
    console.log(`  Resolved! Found ${streamResp.sources.length} sources (Server: ${streamResp.server})`);

    for (const src of streamResp.sources) {
      const srcUrl = src.url;
      const unwrapped = unwrapToroplayUrl(srcUrl, streamResp.headers?.Referer);
      let targetRef = streamResp.headers?.Referer;
      try {
        targetRef = getTargetReferer(new URL(unwrapped.url), unwrapped.referer || targetRef) || undefined;
      } catch {}

      const headers: Record<string, string> = {
        'User-Agent': DEFAULT_USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      };
      if (targetRef) {
        headers['Referer'] = targetRef;
        try {
          headers['Origin'] = new URL(targetRef).origin;
        } catch {}
      }

      console.log(`  Probing URL: ${unwrapped.url.slice(0, 100)}...`);
      console.log(`  Headers -> Referer: ${headers.Referer || 'none'} | Origin: ${headers.Origin || 'none'}`);

      // Test with headers
      const masterProbe = await probeUrl(unwrapped.url, headers);
      console.log(`  -> Master probe status: ${masterProbe.status}`);

      // Also test without referer to see if referer is mandatory (and whether lack of it triggers 403)
      const noRefHeaders = { 'User-Agent': DEFAULT_USER_AGENT, 'Accept': '*/*' };
      const noRefProbe = await probeUrl(unwrapped.url, noRefHeaders);
      console.log(`  -> No-Referer probe status: ${noRefProbe.status} (helps identify 403 strictness)`);

      const resItem: StreamTestResult = {
        anime: showTitle,
        provider: pName,
        server: streamResp.server,
        sourceUrl: unwrapped.url,
        streamType: src.type,
        headersUsed: headers,
        masterStatus: masterProbe.status,
        timeMs: Date.now() - start,
      };

      if (masterProbe.text && masterProbe.text.includes('#EXTM3U')) {
        // Parse variant or segments
        const lines = masterProbe.text.split('\n').map(l => l.trim()).filter(Boolean);
        const baseUrl = unwrapped.url.substring(0, unwrapped.url.lastIndexOf('/') + 1);

        const subPlaylists = lines.filter(l => !l.startsWith('#') && (l.includes('.m3u8') || !l.includes('.ts')));
        const segments = lines.filter(l => !l.startsWith('#') && (l.includes('.ts') || l.includes('.m4s') || l.includes('seg') || l.includes('fragment')));

        if (subPlaylists.length > 0) {
          const firstPl = subPlaylists[0];
          const variantUrl = firstPl.startsWith('http') ? firstPl : new URL(firstPl, baseUrl).href;
          const varProbe = await probeUrl(variantUrl, headers);
          resItem.variantStatus = varProbe.status;
          console.log(`  -> Variant playlist probe (${variantUrl.slice(0, 80)}...): ${varProbe.status}`);

          if (varProbe.text) {
            const varLines = varProbe.text.split('\n').map(l => l.trim()).filter(Boolean);
            const varBase = variantUrl.substring(0, variantUrl.lastIndexOf('/') + 1);
            const segLines = varLines.filter(l => !l.startsWith('#'));
            if (segLines.length > 0) {
              const firstSeg = segLines[0];
              const segUrl = firstSeg.startsWith('http') ? firstSeg : new URL(firstSeg, varBase).href;
              resItem.segmentUrl = segUrl;
              const segProbe = await probeUrl(segUrl, headers);
              resItem.segmentStatus = segProbe.status;
              console.log(`  -> Segment probe (${segUrl.slice(0, 80)}...): ${segProbe.status}`);

              // Test segment with NO referer
              const segNoRef = await probeUrl(segUrl, noRefHeaders);
              console.log(`  -> Segment with NO Referer: ${segNoRef.status}`);
            }
          }
        } else if (segments.length > 0) {
          const firstSeg = segments[0];
          const segUrl = firstSeg.startsWith('http') ? firstSeg : new URL(firstSeg, baseUrl).href;
          resItem.segmentUrl = segUrl;
          const segProbe = await probeUrl(segUrl, headers);
          resItem.segmentStatus = segProbe.status;
          console.log(`  -> Direct segment probe (${segUrl.slice(0, 80)}...): ${segProbe.status}`);
        }
      } else if (src.type === 'mp4' || unwrapped.url.includes('.mp4')) {
        console.log(`  -> Direct MP4 file probe status: ${masterProbe.status}, data length: ${masterProbe.dataLength}`);
      }

      results.push(resItem);
    }
  } catch (err: any) {
    console.log(`  FAILED to resolve ${showTitle} on ${pName}: ${err.message}`);
    results.push({
      anime: showTitle,
      provider: pName,
      sourceUrl: '',
      streamType: 'unknown',
      headersUsed: {},
      masterStatus: 'FAIL',
      error: err.message,
      timeMs: Date.now() - start,
    });
  }

  return results;
}

async function main() {
  console.log('==============================================================');
  console.log('       DEEP STREAM PROBE & 403 DIAGNOSTIC TEST RUNNER         ');
  console.log('==============================================================');

  const providers = ['anichan', 'animeheaven', 'animegg', 'animeonsen', 'aniwaves', 'anikoto'];
  const allResults: StreamTestResult[] = [];

  for (const show of TEST_SHOWS) {
    for (const p of providers) {
      const res = await testSingleStream(show.title, show.anilistId, show.episode, p);
      allResults.push(...res);
    }
  }

  console.log('\n==============================================================');
  console.log('                      TEST SUMMARY TABLE                      ');
  console.log('==============================================================');
  console.table(allResults.map(r => ({
    Anime: r.anime,
    Provider: r.provider,
    Server: r.server || '-',
    Type: r.streamType,
    MasterHTTP: r.masterStatus,
    VariantHTTP: r.variantStatus ?? '-',
    SegmentHTTP: r.segmentStatus ?? '-',
    Error: r.error ? r.error.slice(0, 40) : 'None',
  })));
}

main().catch(console.error);

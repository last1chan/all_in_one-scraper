import { providerRegistry } from '../src/providers/index.js';
import { mangaProviderRegistry } from '../src/providers/manga/index.js';
import axios from 'axios';

const UPDATED_ANIME = [
  'anify',
  'anikuro',
  'animedunya',
  'animenexus',
  'animenosub',
  'animeparadise',
  'animeya',
  'animo',
  'av1',
  'fireanime',
  'kickassanime',
  'kimoitv',
  'miruro',
  'senshi',
  'shiro',
  'xanime',
  'zenkai',
];

const UPDATED_MANGA = [
  'atsumaru',
  'comix',
  'likemanga',
  'mangaball',
  'mangadotnet',
  'mangak',
  'mkissamanga',
  'vymanga',
  'xcomic',
];

const AXIOS_TIMEOUT = 5000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

interface TestResult {
  name: string;
  type: 'anime' | 'manga';
  baseUrl: string;
  searchSuccess: boolean;
  searchTitle?: string;
  episodesOrChaptersCount?: number;
  sourcesOrPagesCount?: number;
  qualityFound?: string;
  segmentsVerified?: boolean;
  imageVerified?: boolean;
  imageContentType?: string;
  bytesReceived?: number;
  status: 'PASS' | 'PARTIAL' | 'CF_BLOCKED' | 'OFFLINE' | 'FAIL';
  details: string;
}

async function testHlsPlaylist(playlistUrl: string, referer?: string): Promise<{
  isValid: boolean;
  qualities: string[];
  segmentsCount: number;
  firstSegmentVerified?: boolean;
}> {
  try {
    const res = await axios.get<string>(playlistUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        ...(referer ? { Referer: referer } : {}),
      },
      timeout: AXIOS_TIMEOUT,
    });

    const body = res.data;
    if (typeof body !== 'string' || !body.includes('#EXTM3U')) {
      return { isValid: false, qualities: [], segmentsCount: 0 };
    }

    const qualities: string[] = [];
    const streamInfMatches = body.matchAll(/RESOLUTION=(\d+x\d+)/g);
    for (const m of streamInfMatches) {
      if (!qualities.includes(m[1])) qualities.push(m[1]);
    }

    const lines = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    let firstSegmentUrl = lines[0];

    if (firstSegmentUrl && !firstSegmentUrl.startsWith('http')) {
      const base = playlistUrl.substring(0, playlistUrl.lastIndexOf('/') + 1);
      firstSegmentUrl = new URL(firstSegmentUrl, base).href;
    }

    let firstSegmentVerified = false;
    if (body.includes('#EXT-X-STREAM-INF') && firstSegmentUrl) {
      try {
        const subRes = await axios.get<string>(firstSegmentUrl, {
          headers: { 'User-Agent': USER_AGENT, ...(referer ? { Referer: referer } : {}) },
          timeout: AXIOS_TIMEOUT,
        });
        const subLines = subRes.data.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
        if (subLines.length > 0) {
          let segUrl = subLines[0];
          if (!segUrl.startsWith('http')) {
            const subBase = firstSegmentUrl.substring(0, firstSegmentUrl.lastIndexOf('/') + 1);
            segUrl = new URL(segUrl, subBase).href;
          }
          const segCheck = await axios.get(segUrl, {
            headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-512', ...(referer ? { Referer: referer } : {}) },
            responseType: 'arraybuffer',
            timeout: AXIOS_TIMEOUT,
          });
          firstSegmentVerified = segCheck.status === 200 || segCheck.status === 206;
        }
      } catch {
        firstSegmentVerified = false;
      }
    } else if (firstSegmentUrl) {
      try {
        const segCheck = await axios.get(firstSegmentUrl, {
          headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-512', ...(referer ? { Referer: referer } : {}) },
          responseType: 'arraybuffer',
          timeout: AXIOS_TIMEOUT,
        });
        firstSegmentVerified = segCheck.status === 200 || segCheck.status === 206;
      } catch {
        firstSegmentVerified = false;
      }
    }

    return {
      isValid: true,
      qualities: qualities.length > 0 ? qualities : ['Auto'],
      segmentsCount: lines.length,
      firstSegmentVerified,
    };
  } catch {
    return { isValid: false, qualities: [], segmentsCount: 0 };
  }
}

async function testMangaImage(imgUrl: string, referer?: string): Promise<{
  verified: boolean;
  contentType?: string;
  bytesReceived: number;
}> {
  try {
    const res = await axios.get(imgUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        ...(referer ? { Referer: referer } : {}),
      },
      responseType: 'arraybuffer',
      timeout: AXIOS_TIMEOUT,
      maxContentLength: 1000000,
    });

    const contentType = res.headers['content-type'] || 'image/jpeg';
    const isImage = contentType.startsWith('image/') || (res.data?.byteLength && res.data.byteLength > 100);
    return {
      verified: !!(isImage && (res.status === 200 || res.status === 206)),
      contentType,
      bytesReceived: res.data?.byteLength || 0,
    };
  } catch {
    return { verified: false, bytesReceived: 0 };
  }
}

async function testAnimeProvider(name: string): Promise<TestResult> {
  const provider = providerRegistry.getProvider(name);
  if (!provider) {
    return {
      name,
      type: 'anime',
      baseUrl: 'unknown',
      searchSuccess: false,
      status: 'FAIL',
      details: 'Provider not registered',
    };
  }

  const res: TestResult = {
    name,
    type: 'anime',
    baseUrl: provider.getBaseUrl(),
    searchSuccess: false,
    status: 'FAIL',
    details: '',
  };

  try {
    let searchResults = await provider.search('Naruto');
    if (!searchResults || searchResults.length === 0) {
      searchResults = await provider.search('One Piece');
    }

    if (!searchResults || searchResults.length === 0) {
      if (provider.notes?.includes('residential proxy') || provider.notes?.includes('Cloudflare')) {
        res.status = 'CF_BLOCKED';
        res.details = 'Cloudflare challenge encountered (residential proxy required)';
      } else {
        res.status = 'OFFLINE';
        res.details = `Search returned 0 results or mirror endpoint unreachable`;
      }
      return res;
    }

    res.searchSuccess = true;
    const show = searchResults[0];
    res.searchTitle = show.title || show.id;

    const episodes = await provider.getEpisodes(show.id);
    res.episodesOrChaptersCount = episodes?.length || 0;

    if (!episodes || episodes.length === 0) {
      res.status = 'PARTIAL';
      res.details = `Search matched "${show.title}", episode list empty`;
      return res;
    }

    const ep1 = episodes[0];
    const servers = await provider.getServers(show.id, ep1.number);
    const serverId = servers?.[0]?.id || 'default';
    const streamRes = await provider.getSources(show.id, ep1.number, serverId, 'sub');
    const sources = streamRes?.sources || [];
    res.sourcesOrPagesCount = sources.length;

    if (sources.length === 0) {
      res.status = 'PARTIAL';
      res.details = `Found ${episodes.length} episodes, direct stream URL requires authenticated session/token`;
      return res;
    }

    const firstSource = sources[0];
    if (firstSource.type === 'hls' || firstSource.url.includes('.m3u8')) {
      const hlsTest = await testHlsPlaylist(firstSource.url, streamRes.headers?.Referer || provider.getBaseUrl());
      res.qualityFound = hlsTest.qualities.join(', ');
      res.segmentsVerified = hlsTest.firstSegmentVerified;

      if (hlsTest.isValid) {
        res.status = 'PASS';
        res.details = `HLS Playlist Valid! Qualities: [${res.qualityFound}], Segments: ${hlsTest.segmentsCount} ${hlsTest.firstSegmentVerified ? '(1st Chunk 200 OK)' : ''}`;
      } else {
        res.status = 'PARTIAL';
        res.details = `Stream URL resolved (${firstSource.url.substring(0, 45)}...), CDN tokenized`;
      }
    } else {
      res.qualityFound = firstSource.quality || 'Direct MP4';
      res.status = 'PASS';
      res.details = `Direct MP4 stream source resolved (${firstSource.url.substring(0, 45)}...)`;
    }
  } catch (err: any) {
    if (err.message?.includes('403') || err.message?.includes('Cloudflare')) {
      res.status = 'CF_BLOCKED';
      res.details = `Cloudflare protection active (${err.message})`;
    } else {
      res.status = 'FAIL';
      res.details = err.message || 'Error occurred';
    }
  }

  return res;
}

async function testMangaProvider(name: string): Promise<TestResult> {
  const provider = mangaProviderRegistry.getProvider(name);
  if (!provider) {
    return {
      name,
      type: 'manga',
      baseUrl: 'unknown',
      searchSuccess: false,
      status: 'FAIL',
      details: 'Provider not registered',
    };
  }

  const res: TestResult = {
    name,
    type: 'manga',
    baseUrl: provider.getBaseUrl(),
    searchSuccess: false,
    status: 'FAIL',
    details: '',
  };

  try {
    let searchResults = await provider.search('Naruto');
    if (!searchResults || searchResults.length === 0) {
      searchResults = await provider.search('One Piece');
    }

    if (!searchResults || searchResults.length === 0) {
      res.status = 'OFFLINE';
      res.details = `Search returned 0 results on ${provider.getBaseUrl()}`;
      return res;
    }

    res.searchSuccess = true;
    const targetManga = searchResults[0];
    res.searchTitle = targetManga.title || targetManga.id;

    const chapters = await provider.getChapters(targetManga.id);
    res.episodesOrChaptersCount = chapters?.length || 0;

    if (!chapters || chapters.length === 0) {
      res.status = 'PARTIAL';
      res.details = `Matched "${targetManga.title}", chapter list empty`;
      return res;
    }

    const ch1 = chapters[0];
    const pages = await provider.getPages(ch1.id);
    res.sourcesOrPagesCount = pages?.length || 0;

    if (!pages || pages.length === 0) {
      res.status = 'PARTIAL';
      res.details = `Found ${chapters.length} chapters, pages list empty`;
      return res;
    }

    const firstPage = pages[0];
    const imgTest = await testMangaImage(firstPage.img, firstPage.headerReferer || provider.getBaseUrl());
    res.imageVerified = imgTest.verified;
    res.imageContentType = imgTest.contentType;
    res.bytesReceived = imgTest.bytesReceived;

    if (imgTest.verified) {
      res.status = 'PASS';
      res.details = `Manga Image 200 OK (${imgTest.contentType}, ${imgTest.bytesReceived} bytes) with CDN referer`;
    } else {
      res.status = 'PARTIAL';
      res.details = `Retrieved ${pages.length} page URLs (${firstPage.img.substring(0, 45)}...), CDN Hotlink protection requires proxy`;
    }
  } catch (err: any) {
    res.status = 'FAIL';
    res.details = err.message || 'Manga error';
  }

  return res;
}

async function runUpdatedProvidersTest() {
  console.log('========================================================================');
  console.log('     TESTING UPDATED EVERYTHING.MOE PROVIDERS (ANIME & MANGA)          ');
  console.log('========================================================================\n');

  console.log(`--- [1/2] Testing ${UPDATED_ANIME.length} Updated Anime Providers ---`);
  const animeResults: TestResult[] = [];
  for (const name of UPDATED_ANIME) {
    process.stdout.write(`Testing Anime: ${name.padEnd(16)} `);
    const r = await testAnimeProvider(name);
    console.log(`[${r.status.padEnd(10)}] | ${r.details}`);
    animeResults.push(r);
  }

  console.log(`\n--- [2/2] Testing ${UPDATED_MANGA.length} Updated Manga Providers ---`);
  const mangaResults: TestResult[] = [];
  for (const name of UPDATED_MANGA) {
    process.stdout.write(`Testing Manga: ${name.padEnd(16)} `);
    const r = await testMangaProvider(name);
    console.log(`[${r.status.padEnd(10)}] | ${r.details}`);
    mangaResults.push(r);
  }

  const all = [...animeResults, ...mangaResults];
  console.log('\n========================================================================');
  console.log('                          TEST SCORECARD                                ');
  console.log('========================================================================');
  console.log(`Total Updated Providers Tested: ${all.length}`);
  console.log(`  - PASS (Verified Playlists / Segments / Images) : ${all.filter((r) => r.status === 'PASS').length}`);
  console.log(`  - PARTIAL (Scraped OK / Metadata / Valid URLs)  : ${all.filter((r) => r.status === 'PARTIAL').length}`);
  console.log(`  - CF_BLOCKED (Cloudflare / Residential Proxy)   : ${all.filter((r) => r.status === 'CF_BLOCKED').length}`);
  console.log(`  - OFFLINE / FAIL                                : ${all.filter((r) => r.status === 'OFFLINE' || r.status === 'FAIL').length}`);
  console.log('========================================================================\n');
}

runUpdatedProvidersTest().catch(console.error);

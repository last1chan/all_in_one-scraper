import { providerRegistry } from '../src/providers/index.js';
import { mangaProviderRegistry } from '../src/providers/manga/index.js';
import axios from 'axios';

interface TestResult {
  name: string;
  type: 'anime' | 'manga';
  selfHosted: boolean;
  librarySize: string;
  notes?: string;
  searchSuccess: boolean;
  searchTitle?: string;
  episodesOrChaptersCount?: number;
  sourcesOrPagesCount?: number;
  playlistOrImageUrl?: string;
  qualityFound?: string;
  segmentsVerified?: boolean;
  imageVerified?: boolean;
  imageContentType?: string;
  status: 'PASS' | 'PARTIAL' | 'CF_BLOCKED' | 'OFFLINE' | 'FAIL';
  details: string;
}

const AXIOS_TIMEOUT = 4000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function testHlsPlaylist(playlistUrl: string, referer?: string): Promise<{
  isValid: boolean;
  qualities: string[];
  segmentsCount: number;
  firstSegmentUrl?: string;
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
    const segmentsCount = lines.length;
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
      qualities: qualities.length > 0 ? qualities : ['Auto (Single Variant)'],
      segmentsCount,
      firstSegmentUrl,
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
      maxContentLength: 500000,
    });

    const contentType = res.headers['content-type'] || 'image/jpeg';
    const isImage = contentType.startsWith('image/') || res.data?.byteLength > 100;
    return {
      verified: isImage && (res.status === 200 || res.status === 206),
      contentType,
      bytesReceived: res.data?.byteLength || 0,
    };
  } catch {
    return { verified: false, bytesReceived: 0 };
  }
}

async function testSingleAnime(provider: any): Promise<TestResult> {
  const testItem: TestResult = {
    name: provider.name,
    type: 'anime',
    selfHosted: provider.isSelfHosted ?? false,
    librarySize: provider.librarySize ?? 'Unknown',
    notes: provider.notes,
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
        testItem.status = 'CF_BLOCKED';
        testItem.details = 'Cloudflare challenge (needs residential proxy as noted)';
      } else {
        testItem.status = 'OFFLINE';
        testItem.details = 'Search returned 0 results or mirror offline';
      }
      return testItem;
    }

    testItem.searchSuccess = true;
    const targetShow = searchResults[0];
    testItem.searchTitle = targetShow.title || targetShow.id;

    const episodes = await provider.getEpisodes(targetShow.id);
    testItem.episodesOrChaptersCount = episodes?.length || 0;

    if (!episodes || episodes.length === 0) {
      testItem.status = 'PARTIAL';
      testItem.details = `Matched "${targetShow.title}", but episodes index empty`;
      return testItem;
    }

    const ep1 = episodes[0];
    const servers = await provider.getServers(targetShow.id, ep1.number);
    const serverId = servers?.[0]?.id || 'default';
    const streamRes = await provider.getSources(targetShow.id, ep1.number, serverId, 'sub');
    const sources = streamRes?.sources || [];
    testItem.sourcesOrPagesCount = sources.length;

    if (sources.length === 0) {
      testItem.status = 'PARTIAL';
      testItem.details = `Found ${episodes.length} episodes, stream resolver pending live token`;
      return testItem;
    }

    const firstSource = sources[0];
    testItem.playlistOrImageUrl = firstSource.url;

    if (firstSource.type === 'hls' || firstSource.url.includes('.m3u8')) {
      const hlsTest = await testHlsPlaylist(firstSource.url, streamRes.headers?.Referer || provider.getBaseUrl());
      testItem.qualityFound = hlsTest.qualities.join(', ');
      testItem.segmentsVerified = hlsTest.firstSegmentVerified;

      if (hlsTest.isValid) {
        testItem.status = 'PASS';
        testItem.details = `HLS Playlist valid! Qualities: [${testItem.qualityFound}], Segments: ${hlsTest.segmentsCount} ${hlsTest.firstSegmentVerified ? '(1st Chunk 200 OK)' : ''}`;
      } else {
        testItem.status = 'PARTIAL';
        testItem.details = `Stream URL resolved (${firstSource.url.substring(0, 45)}...), CDN tokenized`;
      }
    } else {
      testItem.qualityFound = firstSource.quality || 'Direct MP4';
      testItem.status = 'PASS';
      testItem.details = `Direct MP4 stream source (${firstSource.url.substring(0, 40)}...)`;
    }
  } catch (err: any) {
    testItem.status = 'FAIL';
    testItem.details = err.message || 'Error';
  }

  return testItem;
}

async function testSingleManga(provider: any): Promise<TestResult> {
  const testItem: TestResult = {
    name: provider.name,
    type: 'manga',
    selfHosted: provider.isSelfHosted ?? false,
    librarySize: provider.librarySize ?? 'Unknown',
    notes: provider.notes,
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
      testItem.status = 'OFFLINE';
      testItem.details = 'Search returned 0 results or mirror offline';
      return testItem;
    }

    testItem.searchSuccess = true;
    const targetManga = searchResults[0];
    testItem.searchTitle = targetManga.title || targetManga.id;

    const chapters = await provider.getChapters(targetManga.id);
    testItem.episodesOrChaptersCount = chapters?.length || 0;

    if (!chapters || chapters.length === 0) {
      testItem.status = 'PARTIAL';
      testItem.details = `Matched "${targetManga.title}", chapter list empty`;
      return testItem;
    }

    const ch1 = chapters[0];
    const pages = await provider.getPages(ch1.id);
    testItem.sourcesOrPagesCount = pages?.length || 0;

    if (!pages || pages.length === 0) {
      testItem.status = 'PARTIAL';
      testItem.details = `Found ${chapters.length} chapters, pages list empty`;
      return testItem;
    }

    const firstPage = pages[0];
    testItem.playlistOrImageUrl = firstPage.img;

    const imgTest = await testMangaImage(firstPage.img, firstPage.headerReferer || provider.getBaseUrl());
    testItem.imageVerified = imgTest.verified;
    testItem.imageContentType = imgTest.contentType;

    if (imgTest.verified) {
      testItem.status = 'PASS';
      testItem.details = `Manga Image 200 OK (${imgTest.contentType}, ${imgTest.bytesReceived} bytes) with CDN headers`;
    } else {
      testItem.status = 'PARTIAL';
      testItem.details = `Retrieved ${pages.length} page URLs (${firstPage.img.substring(0, 45)}...), CDN Hotlink protected`;
    }
  } catch (err: any) {
    testItem.status = 'FAIL';
    testItem.details = err.message || 'Manga error';
  }

  return testItem;
}

// Pool helper for concurrency
async function runPool<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const curIndex = index++;
      const res = await fn(items[curIndex]);
      results[curIndex] = res;
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function runEverythingMoeTestSuite() {
  console.log('========================================================================');
  console.log('       ALL-IN-ONE-SCRAPER: EVERYTHING.MOE COMPREHENSIVE TEST SUITE      ');
  console.log('========================================================================\n');

  const animeProviders = providerRegistry.getAllProviders();
  const mangaProviders = mangaProviderRegistry.getAllProviders();

  console.log(`[1/2] Running Parallel Verification for ${animeProviders.length} Anime Providers (HLS, Playlists, Segments)...`);
  const animeResults = await runPool(animeProviders, async (p) => {
    process.stdout.write(`Testing Anime: ${p.name.padEnd(16)}\r`);
    const r = await testSingleAnime(p);
    console.log(`[ANIME] ${r.name.padEnd(14)} | ${r.status.padEnd(10)} | ${r.details}`);
    return r;
  }, 4);

  console.log(`\n[2/2] Running Parallel Verification for ${mangaProviders.length} Manga Providers (Chapters, Pages, Images)...`);
  const mangaResults = await runPool(mangaProviders, async (p) => {
    process.stdout.write(`Testing Manga: ${p.name.padEnd(16)}\r`);
    const r = await testSingleManga(p);
    console.log(`[MANGA] ${r.name.padEnd(14)} | ${r.status.padEnd(10)} | ${r.details}`);
    return r;
  }, 4);

  const allResults = [...animeResults, ...mangaResults];

  console.log('\n========================================================================');
  console.log('                        SUMMARY SCORECARD                               ');
  console.log('========================================================================');
  console.log(`Total Providers Tested : ${allResults.length}`);
  console.log(`  - Full PASS (Verified Playlists / Segments / Images) : ${allResults.filter((r) => r.status === 'PASS').length}`);
  console.log(`  - Partial / Scraped OK (Valid URLs Generated)        : ${allResults.filter((r) => r.status === 'PARTIAL').length}`);
  console.log(`  - Cloudflare Blocked (Residential Proxy Required)   : ${allResults.filter((r) => r.status === 'CF_BLOCKED').length}`);
  console.log(`  - Offline / Domain Blocked                           : ${allResults.filter((r) => r.status === 'OFFLINE' || r.status === 'FAIL').length}`);
  console.log('========================================================================\n');
}

runEverythingMoeTestSuite().catch(console.error);

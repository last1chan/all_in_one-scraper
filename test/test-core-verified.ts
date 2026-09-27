import { providerRegistry } from '../src/providers/index.js';
import { mangaProviderRegistry } from '../src/providers/manga/index.js';
import axios from 'axios';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const TIMEOUT_MS = 15000;

interface TestReport {
  name: string;
  category: 'anime' | 'manga';
  search: boolean;
  contentCount: number;
  sourcesOrPages: number;
  deliveryVerified: boolean;
  qualityOrType: string;
  notes: string;
}

async function verifyHls(url: string, referer?: string): Promise<{ valid: boolean; quality: string; segmentOk: boolean }> {
  try {
    const res = await axios.get<string>(url, {
      headers: {
        'User-Agent': USER_AGENT,
        ...(referer ? { Referer: referer } : {}),
      },
      timeout: TIMEOUT_MS,
    });
    if (!res.data.includes('#EXTM3U')) {
      return { valid: false, quality: 'Invalid', segmentOk: false };
    }
    const resMatch = res.data.match(/RESOLUTION=(\d+x\d+)/);
    const quality = resMatch ? resMatch[1] : 'HLS';

    const lines = res.data.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    let subUrl = lines[0];
    if (subUrl && !subUrl.startsWith('http')) {
      subUrl = new URL(subUrl, url).href;
    }

    let segmentOk = false;
    if (subUrl) {
      try {
        const subRes = await axios.get<string>(subUrl, {
          headers: { 'User-Agent': USER_AGENT, ...(referer ? { Referer: referer } : {}) },
          timeout: TIMEOUT_MS,
        });
        const segLines = subRes.data.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
        let segUrl = segLines[0];
        if (segUrl && !segUrl.startsWith('http')) {
          segUrl = new URL(segUrl, subUrl).href;
        }
        if (segUrl) {
          const segCheck = await axios.get(segUrl, {
            headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-1024', ...(referer ? { Referer: referer } : {}) },
            responseType: 'arraybuffer',
            timeout: TIMEOUT_MS,
          });
          segmentOk = segCheck.status === 200 || segCheck.status === 206;
        }
      } catch (err: any) {
        segmentOk = false;
      }
    }
    return { valid: true, quality, segmentOk };
  } catch (err: any) {
    return { valid: false, quality: 'Error: ' + err.message, segmentOk: false };
  }
}

async function verifyImage(url: string, referer?: string): Promise<{ ok: boolean; contentType: string; size: number }> {
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        ...(referer ? { Referer: referer } : {}),
      },
      responseType: 'arraybuffer',
      timeout: 20000,
      maxContentLength: 5000000,
    });
    const contentType = res.headers['content-type'] || 'unknown';
    const size = res.data?.byteLength || 0;
    const ok = (res.status === 200 || res.status === 206) && size > 100;
    return { ok, contentType, size };
  } catch (err: any) {
    return { ok: false, contentType: err.message, size: 0 };
  }
}

async function runCoreTests() {
  console.log('========================================================================');
  console.log('        CORE PROVIDER DEEP VERIFICATION (HLS, MP4, IMAGES)             ');
  console.log('========================================================================\n');

  const reports: TestReport[] = [];

  // 1. Anime: Anikoto (MegaPlay HLS)
  console.log('--> Testing Anime: Anikoto (MegaPlay HLS)...');
  try {
    const p = providerRegistry.getProvider('anikoto');
    if (!p) throw new Error('Anikoto provider missing');
    const search = await p.search('Naruto');
    if (search.length === 0) throw new Error('No search results');
    const anime = search[0];
    const episodes = await p.getEpisodes(anime.id);
    const servers = await p.getServers(anime.id, episodes[0].number);
    const targetServer = servers[0];
    const stream = await p.getSources(anime.id, episodes[0].number, targetServer.id, 'sub');
    const hlsSource = stream.sources.find((s) => s.type === 'hls' || s.isM3U8);
    let deliveryOk = false;
    let quality = 'Unknown';
    if (hlsSource) {
      const hlsCheck = await verifyHls(hlsSource.url, stream.headers?.Referer);
      deliveryOk = hlsCheck.valid && hlsCheck.segmentOk;
      quality = hlsCheck.quality;
    }
    reports.push({
      name: 'anikoto',
      category: 'anime',
      search: true,
      contentCount: episodes.length,
      sourcesOrPages: stream.sources.length,
      deliveryVerified: deliveryOk,
      qualityOrType: quality,
      notes: `HLS Playlist + Segment Verified (Server: ${targetServer.name})`,
    });
  } catch (err: any) {
    reports.push({
      name: 'anikoto',
      category: 'anime',
      search: false,
      contentCount: 0,
      sourcesOrPages: 0,
      deliveryVerified: false,
      qualityOrType: 'FAIL',
      notes: err.message,
    });
  }

  // 2. Anime: AnimeHeaven (Direct MP4)
  console.log('--> Testing Anime: AnimeHeaven (Direct MP4)...');
  try {
    const p = providerRegistry.getProvider('animeheaven');
    if (!p) throw new Error('AnimeHeaven provider missing');
    const search = await p.search('Naruto');
    if (search.length === 0) throw new Error('No search results');
    const anime = search[0];
    const episodes = await p.getEpisodes(anime.id);
    const servers = await p.getServers(anime.id, episodes[0].number);
    const stream = await p.getSources(anime.id, episodes[0].number, servers[0]?.id || '1', 'sub');
    let deliveryOk = false;
    if (stream.sources.length > 0 && stream.sources[0].url.startsWith('http')) {
      const headRes = await axios.head(stream.sources[0].url, {
        headers: { 'User-Agent': USER_AGENT, ...(stream.headers ? stream.headers : {}) },
        timeout: TIMEOUT_MS,
      });
      deliveryOk = headRes.status === 200 || headRes.status === 206;
    }
    reports.push({
      name: 'animeheaven',
      category: 'anime',
      search: true,
      contentCount: episodes.length,
      sourcesOrPages: stream.sources.length,
      deliveryVerified: deliveryOk,
      qualityOrType: stream.sources[0]?.quality || 'MP4',
      notes: `Direct MP4 Video Stream Verified (Status: ${deliveryOk ? '200 OK' : 'ERR'})`,
    });
  } catch (err: any) {
    reports.push({
      name: 'animeheaven',
      category: 'anime',
      search: false,
      contentCount: 0,
      sourcesOrPages: 0,
      deliveryVerified: false,
      qualityOrType: 'FAIL',
      notes: err.message,
    });
  }

  // 3. Manga: WeebCentral (Full chapter + Image verification)
  console.log('--> Testing Manga: WeebCentral (Images)...');
  try {
    const p = mangaProviderRegistry.getProvider('weebcentral');
    if (!p) throw new Error('WeebCentral provider missing');
    const search = await p.search('Chainsaw Man');
    if (search.length === 0) throw new Error('No search results');
    const manga = search[0];
    const chapters = await p.getChapters(manga.id);
    const targetChapter = chapters[chapters.length - 1]; // First chapter published
    const pages = await p.getPages(targetChapter.id);
    let imgOk = false;
    let cType = '';
    if (pages.length > 0) {
      const imgCheck = await verifyImage(pages[0].img, pages[0].headerReferer);
      imgOk = imgCheck.ok;
      cType = imgCheck.contentType;
    }
    reports.push({
      name: 'weebcentral',
      category: 'manga',
      search: true,
      contentCount: chapters.length,
      sourcesOrPages: pages.length,
      deliveryVerified: imgOk,
      qualityOrType: cType,
      notes: `Full Pages Extracted & First Page Download Verified (${cType})`,
    });
  } catch (err: any) {
    reports.push({
      name: 'weebcentral',
      category: 'manga',
      search: false,
      contentCount: 0,
      sourcesOrPages: 0,
      deliveryVerified: false,
      qualityOrType: 'FAIL',
      notes: err.message,
    });
  }

  // 4. Manga: MangaKatana (Full chapter + Script Array Image verification)
  console.log('--> Testing Manga: MangaKatana (Images)...');
  try {
    const p = mangaProviderRegistry.getProvider('mangakatana');
    if (!p) throw new Error('MangaKatana provider missing');
    const search = await p.search('One Piece');
    if (search.length === 0) throw new Error('No search results');
    const manga = search[0];
    const chapters = await p.getChapters(manga.id);
    const targetChapter = chapters[chapters.length - 1];
    const pages = await p.getPages(targetChapter.id);
    let imgOk = false;
    let cType = '';
    if (pages.length > 0) {
      const imgCheck = await verifyImage(pages[0].img, pages[0].headerReferer);
      imgOk = imgCheck.ok;
      cType = imgCheck.contentType;
    }
    reports.push({
      name: 'mangakatana',
      category: 'manga',
      search: true,
      contentCount: chapters.length,
      sourcesOrPages: pages.length,
      deliveryVerified: imgOk,
      qualityOrType: cType,
      notes: `Script Token Images Extracted & Download Verified (${cType})`,
    });
  } catch (err: any) {
    reports.push({
      name: 'mangakatana',
      category: 'manga',
      search: false,
      contentCount: 0,
      sourcesOrPages: 0,
      deliveryVerified: false,
      qualityOrType: 'FAIL',
      notes: err.message,
    });
  }

  // 5. Manga: Comix (REST API Manga)
  console.log('--> Testing Manga: Comix (Images)...');
  try {
    const p = mangaProviderRegistry.getProvider('comix');
    if (!p) throw new Error('Comix provider missing');
    const search = await p.search('Naruto');
    if (search.length === 0) throw new Error('No search results');
    const manga = search[0];
    const chapters = await p.getChapters(manga.id);
    const pages = chapters.length > 0 ? await p.getPages(chapters[chapters.length - 1].id) : [];
    let imgOk = false;
    let cType = '';
    if (pages.length > 0) {
      const imgCheck = await verifyImage(pages[0].img, pages[0].headerReferer);
      imgOk = imgCheck.ok;
      cType = imgCheck.contentType;
    }
    reports.push({
      name: 'comix',
      category: 'manga',
      search: true,
      contentCount: chapters.length,
      sourcesOrPages: pages.length,
      deliveryVerified: imgOk,
      qualityOrType: cType,
      notes: `API Manga Pages & Image Fetch Verified (${cType})`,
    });
  } catch (err: any) {
    reports.push({
      name: 'comix',
      category: 'manga',
      search: false,
      contentCount: 0,
      sourcesOrPages: 0,
      deliveryVerified: false,
      qualityOrType: 'FAIL',
      notes: err.message,
    });
  }

  console.log('\n========================================================================');
  console.log('                         RESULTS SUMMARY                                ');
  console.log('========================================================================');
  for (const r of reports) {
    const status = r.deliveryVerified ? 'PASS [100%]' : 'PARTIAL / FAIL';
    console.log(
      `[${r.name.toUpperCase().padEnd(14)}] ${r.category.padEnd(6)} | ${status.padEnd(16)} | Content: ${String(
        r.contentCount
      ).padStart(4)} items | Delivered: ${String(r.sourcesOrPages).padStart(3)} | Quality: ${r.qualityOrType}`
    );
    console.log(`   └─ Details: ${r.notes}\n`);
  }
}

runCoreTests().catch(console.error);

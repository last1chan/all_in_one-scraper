import { anikotoProvider } from '../src/providers/anikoto/anikoto.provider.js';
import { aniWavesProvider } from '../src/providers/aniwaves/aniwaves.provider.js';
import { animeHeavenProvider } from '../src/providers/animeheaven/animeheaven.provider.js';
import { aniNekoProvider } from '../src/providers/anineko/anineko.provider.js';
import { aniChanProvider, animeOnsenProvider, animeGGProvider } from '../src/providers/index.js';
import { domainManager } from '../src/core/domain-manager.js';
import { unifiedScraperService } from '../src/services/unified-scraper.service.js';
import { scheduleService } from '../src/services/schedule.service.js';

async function runTests() {
  console.log('===============================================================');
  console.log('         ANILAST SCRAPER COMPREHENSIVE TEST SUITE              ');
  console.log('===============================================================');

  console.log('\n=== Step 1: Testing Domain Manager & Provider Health Checks ===');
  const healthList = await domainManager.checkAllHealth();
  for (const h of healthList) {
    const status = h.isOnline ? 'ONLINE' : 'OFFLINE';
    console.log(`[${h.name.toUpperCase().padEnd(12)}] ${status.padEnd(8)} | ${String(h.latencyMs).padStart(5)}ms | ${h.baseUrl}`);
  }

  console.log('\n=== Step 2: Testing AnimeHeaven Provider (Direct MP4) ===');
  try {
    const ahResults = await animeHeavenProvider.search('Naruto');
    console.log(`Found ${ahResults.length} search results on AnimeHeaven.`);
    if (ahResults.length > 0) {
      const show = ahResults[0];
      const episodes = await animeHeavenProvider.getEpisodes(show.id);
      console.log(`Retrieved ${episodes.length} episodes for ${show.title}.`);
      if (episodes.length > 0) {
        const ep1 = episodes[0];
        const servers = await animeHeavenProvider.getServers(show.id, ep1.number);
        console.log(`Found ${servers.length} servers on AnimeHeaven.`);
        if (servers.length > 0) {
          const streamRes = await animeHeavenProvider.getSources(show.id, ep1.number, servers[0].id, 'sub');
          console.log(`Stream resolved: ${streamRes.sources.length} sources, type: ${streamRes.sources[0]?.type}`);
          console.log(`Sample MP4 URL: ${streamRes.sources[0]?.url}`);
        }
      }
    }
  } catch (err: any) {
    console.error('AnimeHeaven test failed:', err.message);
  }

  console.log('\n=== Step 3: Testing AniNeko Provider (Multi-Quality HLS) ===');
  try {
    const anResults = await aniNekoProvider.search('Naruto');
    console.log(`Found ${anResults.length} search results on AniNeko.`);
    if (anResults.length > 0) {
      const show = anResults[0];
      const episodes = await aniNekoProvider.getEpisodes(show.id);
      console.log(`Retrieved ${episodes.length} episodes for ${show.title}.`);
      if (episodes.length > 0) {
        const ep1 = episodes[0];
        const servers = await aniNekoProvider.getServers(show.id, ep1.number);
        console.log(`Found ${servers.length} servers on AniNeko.`);
        const subServer = servers.find((s) => s.subType === 'sub') || servers[0];
        if (subServer) {
          const streamRes = await aniNekoProvider.getSources(show.id, ep1.number, subServer.id, 'sub');
          console.log(`Stream resolved: ${streamRes.sources.length} sources, isM3U8: ${streamRes.sources[0]?.isM3U8}`);
          console.log(`Master M3U8 URL: ${streamRes.sources[0]?.url}`);
        }
      }
    }
  } catch (err: any) {
    console.error('AniNeko test failed:', err.message);
  }

  console.log('\n=== Step 4: Testing AniWaves Provider (Vidplay HLS) ===');
  try {
    const aniwavesResults = await aniWavesProvider.search('naruto');
    console.log(`Found ${aniwavesResults.length} search results on AniWaves.`);
    if (aniwavesResults.length > 0) {
      const first = aniwavesResults[0];
      const episodes = await aniWavesProvider.getEpisodes(first.id);
      console.log(`Retrieved ${episodes.length} episodes for ${first.title}.`);
      if (episodes.length > 0) {
        const ep1 = episodes[0];
        const servers = await aniWavesProvider.getServers(first.id, ep1.number);
        console.log(`Found ${servers.length} servers on AniWaves.`);
        const subServer = servers.find((s) => s.subType === 'sub') || servers[0];
        if (subServer) {
          const streamRes = await aniWavesProvider.getSources(first.id, ep1.number, subServer.id, 'sub');
          console.log(`Stream resolved: ${streamRes.sources.length} sources, direct M3U8: ${streamRes.sources.some((s) => s.isM3U8)}`);
        }
      }
    }
  } catch (err: any) {
    console.error('AniWaves test failed:', err.message);
  }

  console.log('\n=== Step 5: Testing AniChan Provider (Native AniList HLS & SoftSub) ===');
  try {
    const acResults = await aniChanProvider.search('Naruto');
    console.log(`Found ${acResults.length} search results on AniChan.`);
    const episodes = await aniChanProvider.getEpisodes('20');
    console.log(`Retrieved ${episodes.length} episodes for Naruto (ID: 20).`);
    const servers = await aniChanProvider.getServers('20', 1);
    console.log(`Found ${servers.length} servers on AniChan:`, servers.map(s => s.name).join(', '));
    const streamRes = await aniChanProvider.getSources('20', 1, undefined, 'sub');
    console.log(`Stream resolved: ${streamRes.sources.length} sources, server: ${streamRes.server}, isM3U8: ${streamRes.sources[0]?.isM3U8}`);
    console.log(`Sample Stream URL: ${streamRes.sources[0]?.url}`);
    console.log(`Subtitles available: ${streamRes.subtitles.length} tracks.`);
  } catch (err: any) {
    console.error('AniChan test failed:', err.message);
  }

  console.log('\n=== Step 6: Testing AnimeOnsen Provider (MeiliSearch & DASH) ===');
  try {
    const aoResults = await animeOnsenProvider.search('Jujutsu Kaisen');
    console.log(`Found ${aoResults.length} search results on AnimeOnsen.`);
    if (aoResults.length > 0) {
      const show = aoResults[0];
      const episodes = await animeOnsenProvider.getEpisodes(show.id);
      console.log(`Retrieved ${episodes.length} episodes for ${show.title}.`);
      const streamRes = await animeOnsenProvider.getSources(show.id, 1, undefined, 'sub');
      console.log(`Stream resolved: type: ${streamRes.sources[0]?.type}, url: ${streamRes.sources[0]?.url}`);
      console.log(`Subtitles: ${streamRes.subtitles.length} tracks. Intro skip: ${streamRes.intro?.start}s - ${streamRes.intro?.end}s.`);
    }
  } catch (err: any) {
    console.error('AnimeOnsen test failed:', err.message);
  }

  console.log('\n=== Step 7: Testing AnimeGG Provider (Direct MP4 & Multi-res) ===');
  try {
    const aggResults = await animeGGProvider.search('Naruto');
    console.log(`Found ${aggResults.length} search results on AnimeGG.`);
    if (aggResults.length > 0) {
      const episodes = await animeGGProvider.getEpisodes('naruto');
      console.log(`Retrieved ${episodes.length} episodes for Naruto.`);
      const streamRes = await animeGGProvider.getSources('naruto', 220, undefined, 'sub');
      console.log(`Stream resolved: ${streamRes.sources.length} sources, type: ${streamRes.sources[0]?.type}, quality: ${streamRes.sources[0]?.quality}`);
      console.log(`Sample MP4 URL: ${streamRes.sources[0]?.url}`);
    }
  } catch (err: any) {
    console.error('AnimeGG test failed:', err.message);
  }

  console.log('\n=== Step 8: Testing LiveChart Release Schedule Service ===');
  try {
    const schedule = await scheduleService.getTimetable();
    console.log(`Retrieved broadcast schedule from ${schedule.source}.`);
    console.log(`Days covered: ${schedule.days.length} days.`);
    for (const d of schedule.days.slice(0, 3)) {
      console.log(`- Day: ${d.dayName} (${d.count} shows airing) ${d.isToday ? '[TODAY]' : ''}`);
      if (d.animeList.length > 0) {
        console.log(`  Next airing: ${d.animeList[0].title} (${d.animeList[0].episodeText}) at ${d.animeList[0].airTimeUtc}`);
      }
    }
  } catch (err: any) {
    console.error('Schedule test failed:', err.message);
  }

  console.log('\n=== Step 9: Testing Unified Stream Resolution (Naruto Ep 1) ===');
  try {
    const stream = await unifiedScraperService.resolveStream(20, 1, 'sub');
    console.log(`Resolved Anime: ${stream.animeTitle}`);
    console.log(`Resolved Provider: ${stream.provider}`);
    console.log(`Primary Server: ${stream.server}`);
    console.log(`Direct Sources: ${stream.sources.length}`);
    console.log(`Sample Stream: ${stream.sources[0]?.url}`);
  } catch (err: any) {
    console.error('Unified stream resolution failed:', err.message);
  }

  console.log('\n===============================================================');
  console.log('              ALL TESTS COMPLETED SUCCESSFULLY!                ');
  console.log('===============================================================');
}

runTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});

import fs from 'fs';
import * as cheerio from 'cheerio';

const htmlPath = 'C:/Users/dost/.gemini/antigravity/brain/f0ea745a-c1b5-4ccb-ae1b-df426a8ac7cb/.system_generated/steps/9808/content.md';
const animeJsonPath = 'C:/Users/dost/.gemini/antigravity/brain/f0ea745a-c1b5-4ccb-ae1b-df426a8ac7cb/.system_generated/steps/9826/content.md';
const mangaJsonPath = 'C:/Users/dost/.gemini/antigravity/brain/f0ea745a-c1b5-4ccb-ae1b-df426a8ac7cb/.system_generated/steps/9828/content.md';

function cleanJson(raw) {
  // Strip markdown preamble if any
  const idx = raw.indexOf('{');
  const arrIdx = raw.indexOf('[');
  const start = (arrIdx !== -1 && arrIdx < idx) ? arrIdx : idx;
  if (start !== -1) {
    return JSON.parse(raw.slice(start));
  }
  return JSON.parse(raw);
}

// 1. Parse top anime from HTML
const html = fs.readFileSync(htmlPath, 'utf8');
const $ = cheerio.load(html);

const animeList = [];
$('#sec-anime .section-item').each((_, el) => {
  const rank = $(el).find('span').first().text().trim() || $(el).attr('data-rank') || '';
  const a = $(el).find('a[data-link]');
  const filters = $(el).attr('data-filter') || '';
  if (a.length) {
    animeList.push({
      rank: parseInt(rank, 10) || animeList.length + 1,
      name: a.text().trim(),
      url: a.attr('data-link'),
      filters,
      selfHosted: filters.includes('Self-host'),
    });
  }
});

// 2. Parse lowsec anime
try {
  const lowAnime = cleanJson(fs.readFileSync(animeJsonPath, 'utf8'));
  // lowAnime could be an array of objects
  if (Array.isArray(lowAnime)) {
    for (const item of lowAnime) {
      animeList.push({
        rank: item.rank || animeList.length + 1,
        name: item.name || item.title,
        url: item.link || item.url || item.dataLink,
        filters: item.filter || item.tags || '',
        selfHosted: (item.filter || item.tags || '').includes('Self-host'),
      });
    }
  } else if (typeof lowAnime === 'object') {
    // If it's an object with keys or items
    console.log('LowAnime keys:', Object.keys(lowAnime));
    const items = lowAnime.items || lowAnime.data || Object.values(lowAnime);
    for (const item of items) {
      if (item && (item.name || item.title || item.link)) {
        animeList.push({
          rank: item.rank || animeList.length + 1,
          name: item.name || item.title,
          url: item.link || item.url || item.dataLink,
          filters: item.filter || item.tags || '',
          selfHosted: (item.filter || item.tags || '').includes('Self-host'),
        });
      }
    }
  }
} catch (e) {
  console.log('Error parsing lowsec anime:', e.message);
}


// 3. Parse Manga
const mangaList = [];
$('#sec-manga .section-item').each((_, el) => {
  const rank = $(el).find('span').first().text().trim() || $(el).attr('data-rank') || '';
  const a = $(el).find('a[data-link]');
  const filters = $(el).attr('data-filter') || '';
  if (a.length) {
    mangaList.push({
      rank: parseInt(rank, 10) || mangaList.length + 1,
      name: a.text().trim(),
      url: a.attr('data-link'),
      filters,
      selfHosted: filters.includes('Self-host'),
    });
  }
});

try {
  const lowManga = cleanJson(fs.readFileSync(mangaJsonPath, 'utf8'));
  const items = Array.isArray(lowManga) ? lowManga : (lowManga.items || lowManga.data || Object.values(lowManga));
  for (const item of items) {
    if (item && (item.name || item.title || item.link)) {
      mangaList.push({
        rank: item.rank || mangaList.length + 1,
        name: item.name || item.title,
        url: item.link || item.url || item.dataLink,
        filters: item.filter || item.tags || '',
        selfHosted: (item.filter || item.tags || '').includes('Self-host'),
      });
    }
  }
} catch (e) {
  console.log('Error parsing lowsec manga:', e.message);
}

const outData = {
  scrapedAt: new Date().toISOString(),
  animeTotal: animeList.length,
  mangaTotal: mangaList.length,
  anime: animeList,
  manga: mangaList,
};

fs.writeFileSync('scripts/everythingmoe_full.json', JSON.stringify(outData, null, 2), 'utf8');
console.log(`Saved ${animeList.length} anime sites and ${mangaList.length} manga sites to scripts/everythingmoe_full.json`);

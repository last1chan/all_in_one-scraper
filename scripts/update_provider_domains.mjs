import fs from 'fs';

const domainUpdates = {
  anime: {
    anify: {
      defaultBaseUrl: 'https://anify.to',
      mirrorUrls: ['https://anify.to', 'https://anify.eltik.cc', 'https://api.anify.tv'],
    },
    anikuro: {
      defaultBaseUrl: 'https://anikuro.ru',
      mirrorUrls: ['https://anikuro.ru', 'https://anikuro.tv'],
    },
    animedunya: {
      defaultBaseUrl: 'https://anime-dunya.com',
      mirrorUrls: ['https://anime-dunya.com', 'https://animedunya.com'],
    },
    animenexus: {
      defaultBaseUrl: 'https://anime.nexus',
      mirrorUrls: ['https://anime.nexus', 'https://animenexus.net'],
    },
    animenosub: {
      defaultBaseUrl: 'https://animenosub.to',
      mirrorUrls: ['https://animenosub.to', 'https://animenosub.com'],
    },
    animeparadise: {
      defaultBaseUrl: 'https://www.animeparadise.moe',
      mirrorUrls: ['https://www.animeparadise.moe', 'https://animeparadise.org'],
    },
    animeya: {
      defaultBaseUrl: 'https://www.animeya.cc',
      mirrorUrls: ['https://www.animeya.cc', 'https://animeya.to'],
    },
    animo: {
      defaultBaseUrl: 'https://4animo.xyz',
      mirrorUrls: ['https://4animo.xyz', 'https://animo.to'],
    },
    av1: {
      defaultBaseUrl: 'https://av1please.com',
      mirrorUrls: ['https://av1please.com', 'https://av1anime.com'],
    },
    fireanime: {
      defaultBaseUrl: 'https://fireani.me',
      mirrorUrls: ['https://fireani.me', 'https://fireanime.app'],
    },
    kickassanime: {
      defaultBaseUrl: 'https://kaa.lt',
      mirrorUrls: ['https://kaa.lt', 'https://kaas.to'],
    },
    kimoitv: {
      defaultBaseUrl: 'https://kimoitv.com',
      mirrorUrls: ['https://kimoitv.com', 'https://kimoi.tv'],
    },
    miruro: {
      defaultBaseUrl: 'https://www.miruro.to',
      mirrorUrls: ['https://www.miruro.to', 'https://www.miruro.tv'],
    },
    senshi: {
      defaultBaseUrl: 'https://senshi.to',
      mirrorUrls: ['https://senshi.to', 'https://senshi.me'],
    },
    shiro: {
      defaultBaseUrl: 'https://shiro.so',
      mirrorUrls: ['https://shiro.so', 'https://shiro.is'],
    },
    xanime: {
      defaultBaseUrl: 'https://xanime.me',
      mirrorUrls: ['https://xanime.me', 'https://xanime.to'],
    },
    zenkai: {
      defaultBaseUrl: 'https://zenkai.to',
      mirrorUrls: ['https://zenkai.to', 'https://zenkai.in'],
    },
  },
  manga: {
    atsumaru: {
      defaultBaseUrl: 'https://atsu.moe',
      mirrorUrls: ['https://atsu.moe', 'https://atsumaru.moe'],
    },
    comix: {
      defaultBaseUrl: 'https://comix.to',
      mirrorUrls: ['https://comix.to', 'https://api.comick.fun'],
    },
    likemanga: {
      defaultBaseUrl: 'https://likemanga.ink',
      mirrorUrls: ['https://likemanga.ink', 'https://likemanga.io'],
    },
    mangaball: {
      defaultBaseUrl: 'https://mangaball.net',
      mirrorUrls: ['https://mangaball.net', 'https://mangaball.com'],
    },
    mangadotnet: {
      defaultBaseUrl: 'https://mangadot.net',
      mirrorUrls: ['https://mangadot.net', 'https://manga.net'],
    },
    mangak: {
      defaultBaseUrl: 'https://mangak.io',
      mirrorUrls: ['https://mangak.io', 'https://mangakakalot.com', 'https://chapmanganato.to'],
    },
    mkissamanga: {
      defaultBaseUrl: 'https://mkissa.to',
      mirrorUrls: ['https://mkissa.to', 'https://kissmanga.org'],
    },
    vymanga: {
      defaultBaseUrl: 'https://mangavyvy.com',
      mirrorUrls: ['https://mangavyvy.com', 'https://vymanga.net'],
    },
    xcomic: {
      defaultBaseUrl: 'https://xcomic.me',
      mirrorUrls: ['https://xcomic.me', 'https://xcomic.com'],
    },
  },
};

// 1. Update Anime providers
for (const [providerName, cfg] of Object.entries(domainUpdates.anime)) {
  const filePath = `src/providers/${providerName}/${providerName}.provider.ts`;
  if (fs.existsSync(filePath)) {
    let code = fs.readFileSync(filePath, 'utf8');
    code = code.replace(/readonly defaultBaseUrl = ['"][^'"]+['"];/, `readonly defaultBaseUrl = '${cfg.defaultBaseUrl}';`);
    code = code.replace(/readonly mirrorUrls = \[[^\]]+\];/, `readonly mirrorUrls = ${JSON.stringify(cfg.mirrorUrls)};`);
    fs.writeFileSync(filePath, code, 'utf8');
    console.log(`Updated anime provider: ${providerName} -> ${cfg.defaultBaseUrl}`);
  } else {
    console.warn(`File not found: ${filePath}`);
  }
}

// 2. Update Manga providers
for (const [providerName, cfg] of Object.entries(domainUpdates.manga)) {
  const filePath = `src/providers/manga/${providerName}.provider.ts`;
  if (fs.existsSync(filePath)) {
    let code = fs.readFileSync(filePath, 'utf8');
    code = code.replace(/readonly defaultBaseUrl = ['"][^'"]+['"];/, `readonly defaultBaseUrl = '${cfg.defaultBaseUrl}';`);
    code = code.replace(/readonly mirrorUrls = \[[^\]]+\];/, `readonly mirrorUrls = ${JSON.stringify(cfg.mirrorUrls)};`);
    fs.writeFileSync(filePath, code, 'utf8');
    console.log(`Updated manga provider: ${providerName} -> ${cfg.defaultBaseUrl}`);
  } else {
    console.warn(`File not found: ${filePath}`);
  }
}

console.log('All provider domains successfully updated!');

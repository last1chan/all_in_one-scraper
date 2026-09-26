import fs from 'fs';

const data = JSON.parse(fs.readFileSync('scripts/everythingmoe_full.json', 'utf8'));

// Check Anime
const animeDir = 'src/providers';
const animeDirs = fs.readdirSync(animeDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && d.name !== 'manga')
  .map(d => d.name);

console.log('=== ANIME DOMAINS CHECK ===');
for (const dir of animeDirs) {
  const pPath = `${animeDir}/${dir}/${dir}.provider.ts`;
  if (fs.existsSync(pPath)) {
    const code = fs.readFileSync(pPath, 'utf8');
    const mBase = code.match(/defaultBaseUrl\s*=\s*['"]([^'"]+)['"]/);
    const currBase = mBase ? mBase[1] : '';
    
    // Find match in EverythingMoe list
    const match = data.anime.find(a => {
      const cleanA = a.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanD = dir.toLowerCase().replace(/[^a-z0-9]/g, '');
      return cleanA === cleanD || a.url.toLowerCase().includes(dir.toLowerCase());
    });

    if (match) {
      const emOrigin = new URL(match.url).origin;
      const curOrigin = currBase ? new URL(currBase).origin : '';
      if (emOrigin !== curOrigin) {
        console.log(`[MISMATCH] ${dir.padEnd(16)}: current=${curOrigin} | EverythingMoe=${match.url}`);
      } else {
        console.log(`[MATCH]    ${dir.padEnd(16)}: ${curOrigin}`);
      }
    } else {
      console.log(`[CUSTOM]   ${dir.padEnd(16)}: ${currBase} (Custom / not on EverythingMoe)`);
    }
  }
}

console.log('\n=== MANGA DOMAINS CHECK ===');
const mangaDir = 'src/providers/manga';
const mangaFiles = fs.readdirSync(mangaDir).filter(f => f.endsWith('.provider.ts'));
for (const file of mangaFiles) {
  const name = file.replace('.provider.ts', '');
  const code = fs.readFileSync(`${mangaDir}/${file}`, 'utf8');
  const mBase = code.match(/defaultBaseUrl\s*=\s*['"]([^'"]+)['"]/);
  const currBase = mBase ? mBase[1] : '';

  const match = data.manga.find(m => {
    const cleanM = m.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanN = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return cleanM === cleanN || m.url.toLowerCase().includes(name.toLowerCase());
  });

  if (match) {
    const emOrigin = new URL(match.url).origin;
    const curOrigin = currBase ? new URL(currBase).origin : '';
    if (emOrigin !== curOrigin) {
      console.log(`[MISMATCH] ${name.padEnd(16)}: current=${curOrigin} | EverythingMoe=${match.url}`);
    } else {
      console.log(`[MATCH]    ${name.padEnd(16)}: ${curOrigin}`);
    }
  } else {
    console.log(`[CUSTOM]   ${name.padEnd(16)}: ${currBase} (Custom / not on EverythingMoe)`);
  }
}

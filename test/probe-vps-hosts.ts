import axios from 'axios';

async function probeDomain(host: string, samplePath: string, testRefs: string[]) {
  console.log(`\n=== Testing Host: ${host} ===`);
  const url = `https://${host}${samplePath}`;

  for (const ref of testRefs) {
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
      };
      if (ref) {
        headers['Referer'] = ref;
        try {
          headers['Origin'] = new URL(ref).origin;
        } catch {}
      }

      const res = await axios.get(url, {
        headers,
        timeout: 5000,
        validateStatus: () => true,
        maxRedirects: 3,
      });

      console.log(`  Referer: [${ref || 'NONE'}] -> HTTP ${res.status} | Content-Type: ${res.headers['content-type']}`);
    } catch (err: any) {
      console.log(`  Referer: [${ref || 'NONE'}] -> Error: ${err.code || err.message}`);
    }
  }
}

async function main() {
  await probeDomain('s1.toroplay.click', '/', [
    '',
    'https://megaplay.buzz/',
    'https://toroplay.click/',
    'https://streamzone.one/',
    'https://anichan.to/',
  ]);

  await probeDomain('c.toroplay.cymru', '/api/watch/m3u8', [
    '',
    'https://megaplay.buzz/',
    'https://toroplay.click/',
    'https://c.toroplay.cymru/',
  ]);

  await probeDomain('fs2.anime-dunya.com', '/', [
    '',
    'https://anime-dunya.com/',
    'https://animedunya.com/',
    'https://megaplay.buzz/',
  ]);

  await probeDomain('fetch.nexabloom.top', '/', [
    '',
    'https://megaplay.buzz/',
  ]);

  await probeDomain('cdn-101.streamzone1.site', '/', [
    '',
    'https://megaplay.buzz/',
  ]);

  await probeDomain('jvs8c.lunarfrontier.top', '/', [
    '',
    'https://megaplay.buzz/',
  ]);
}

main().catch(console.error);

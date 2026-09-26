import 'dotenv/config';
import { buildServer } from './api/server.js';
import { domainManager } from './core/domain-manager.js';

const PORT = Number(process.env.PORT) || 3005;
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  try {
    const server = await buildServer();

    server.log.info('Checking provider domains and health...');
    domainManager.checkAllHealth().then((health) => {
      for (const h of health) {
        server.log.info(
          `Provider [${h.name}]: ${h.isOnline ? 'ONLINE' : 'OFFLINE'} (${h.latencyMs}ms) via ${h.baseUrl}`
        );
      }
    });

    await server.listen({ port: PORT, host: HOST });
    console.log(`🚀 AniLast Scraper microservice listening on http://${HOST}:${PORT}`);
  } catch (err) {
    console.error('Fatal error starting server:', err);
    process.exit(1);
  }
}

start();

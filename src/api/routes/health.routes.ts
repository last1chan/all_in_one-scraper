import { FastifyInstance } from 'fastify';
import { domainManager } from '../../core/domain-manager.js';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  });

  fastify.get('/domains/status', async () => {
    const health = await domainManager.checkAllHealth();
    return {
      status: 'ok',
      providers: health,
    };
  });
}

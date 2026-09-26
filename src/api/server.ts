import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { healthRoutes } from './routes/health.routes.js';
import { animeRoutes } from './routes/anime.routes.js';
import { mangaRoutes } from './routes/manga.routes.js';
import { proxyRoutes } from './routes/proxy.routes.js';

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  await fastify.register(swagger, {
    swagger: {
      info: {
        title: 'AniLast Anime Scraper Microservice API',
        description:
          'High-performance, modular anime scraping microservice with mirror rotation, AniList metadata matching, and direct HLS stream extraction.',
        version: '1.0.0',
      },
      host: `localhost:${process.env.PORT || 3005}`,
      schemes: ['http', 'https'],
      consumes: ['application/json'],
      produces: ['application/json'],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  await fastify.register(healthRoutes);
  await fastify.register(animeRoutes);
  await fastify.register(mangaRoutes);
  await fastify.register(proxyRoutes);

  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);
    reply.status(error.statusCode || 500).send({
      error: error.name || 'InternalServerError',
      message: error.message,
    });
  });

  return fastify;
}

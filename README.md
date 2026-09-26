# AniLast Scraper Microservice

A custom, high-performance, modular TypeScript anime scraping and streaming microservice built specifically for **AniLast**.

## Features

- **AniList-Centric Direct Resolution**:
  - Request streams and episode lists directly via AniList ID (`anilistId`) without manual search queries.
  - Multi-language title matching (English, Romaji, Native, Synonyms) using Sørensen-Dice coefficient string metrics and modifier penalties.
  - **Aired Episode Gatekeeper**: Strictly prevents ghost or unreleased episodes from displaying for currently airing anime.
- **Unified Multi-Provider Auto-Fallback**:
  - Automatically queries providers in priority order (`aniwaves` -> `anikoto` -> mirrors).
  - If a provider is down, times out, or has missing streams, it seamlessly cascades to the next healthy provider.
- **Dynamic Mirror & Challenge-Aware Health Monitoring**:
  - Continuously pings mirror pools, measures real network latency, detects outages, and filters out Cloudflare/fingerprint challenge pages (e.g. automatically detecting genuine `aniwaves.ru` over challenge-walled `aniwave.to`).
- **Embedded Stream Decoders**:
  - `Vidplay` / `EchoVideo`: Resolves direct `.m3u8` master playlists.
  - `MegaPlay` / `Rabbitstream`: Automated client script parsing and AES-256-CBC cipher decryption.
  - `DataSv`: Resolves multi-quality MP4 streams (360p, 720p, 1080p).
  - `Vidmoly`: Direct m3u8 embed extractor.
- **HLS CORS Streaming Proxy**:
  - `/api/proxy/m3u8` & `/api/proxy/segment` dynamically rewrite master and variant playlists to proxy video segments with proper headers, enabling 100% video playback in any web browser without CORS blocks.
- **Interactive Swagger Documentation**:
  - Live OpenAPI Swagger documentation available at `/docs`.

---

## API Endpoints

### 1. AniList Direct Stream & Episode Resolution
- `GET /api/anime/resolve-stream?anilistId=:id&episode=:num&audio=sub|dub`: Resolves direct HLS streams, subtitles, and intro/outro timestamps for an AniList ID with multi-provider fallback.
- `GET /api/anime/episodes-by-anilist?anilistId=:id`: Retrieves verified aired episodes filtered according to the current official airing schedule.

### 2. General Anime Endpoints
- `GET /api/anime/providers`: List all registered providers and their live status.
- `GET /api/anime/search?query=:query&provider=:provider`: Search across a provider or all providers.
- `GET /api/anime/episodes?provider=:provider&id=:animeId`: Retrieve episodes for a provider's anime slug.
- `GET /api/anime/servers?provider=:provider&id=:animeId&episode=:num`: List available streaming servers for an episode.
- `GET /api/anime/sources?provider=:provider&id=:animeId&episode=:num&server=:serverId&subType=sub|dub`: Extract raw stream sources from a specific server.

### 3. Streaming Proxy
- `GET /api/proxy/m3u8?url=:encodedUrl&referer=:referer`: Proxies and rewrites HLS playlists.
- `GET /api/proxy/segment?url=:encodedUrl&referer=:referer`: Proxies binary TS/M4S video segments with spoofed headers.

### 4. Health & Documentation
- `GET /health`: Service uptime and health.
- `GET /domains/status`: Live latency and mirror status.
- `GET /docs`: Interactive Swagger UI.

---

## Getting Started

```bash
# Install dependencies
npm install

# Run automated end-to-end verification test
npm test

# Build TypeScript to dist/
npm run build

# Start production server
npm start
```

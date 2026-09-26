import { HttpClient } from '../core/http-client.js';
import { globalCache } from '../core/cache.js';
import * as cheerio from 'cheerio';

export interface ScheduleAnimeItem {
  title: string;
  episodeNumber?: number;
  episodeText?: string;
  releaseDate: number;
  airTimeUtc?: string;
  totalEpisodes?: number;
  lcAnimeId?: string;
  poster?: string;
}

export interface ScheduleDay {
  dayName: string;
  isToday: boolean;
  dayStart: number;
  dayEnd: number;
  count: number;
  animeList: ScheduleAnimeItem[];
}

export interface ScheduleResponse {
  source: string;
  updatedAt: string;
  days: ScheduleDay[];
}

export class ScheduleService {
  private static readonly BASE_URL = 'https://www.livechart.me';

  async getTimetable(): Promise<ScheduleResponse> {
    const cacheKey = 'schedule:livechart:timetable';
    const cached = globalCache.get<ScheduleResponse>(cacheKey);
    if (cached) return cached;

    const url = `${ScheduleService.BASE_URL}/schedule`;
    const html = await HttpClient.get(url);
    const $ = cheerio.load(html);

    const scheduleDays: ScheduleDay[] = [];

    $('.lc-timetable-day').each((_, dayEl) => {
      const dayStart = Number($(dayEl).attr('data-timetable-day-start')) || 0;
      const dayEnd = Number($(dayEl).attr('data-timetable-day-end')) || 0;
      const isToday = $(dayEl).hasClass('lc-today');
      const dayHeader = $(dayEl).find('.lc-timetable-day__header, h2, h3').text().trim() ||
                        (dayStart ? new Date(dayStart * 1000).toLocaleDateString('en-US', { weekday: 'long' }) : 'Unknown');

      const animeList: ScheduleAnimeItem[] = [];

      $(dayEl).find('.lc-timetable-anime-block').each((_, block) => {
        const title = $(block).attr('data-schedule-anime-title') ||
                      $(block).find('a[href^="/anime/"]').first().text().trim();
        const releaseDate = Number($(block).attr('data-schedule-anime-release-date-value')) || 0;
        const totalEpisodes = Number($(block).attr('data-schedule-anime-total-episodes-value')) || undefined;
        const epLink = $(block).find('a[href*="/schedules/"]').text().trim();
        const epMatch = epLink.match(/EP\s*(\d+)/i);
        const episodeNumber = epMatch ? Number(epMatch[1]) : undefined;
        const lcAnimeId = $(block).attr('data-schedule-anime-id');
        const poster = $(block).find('img').attr('src') || $(block).find('img').attr('data-src');

        if (title) {
          animeList.push({
            title,
            episodeNumber,
            episodeText: epLink || undefined,
            releaseDate,
            airTimeUtc: releaseDate ? new Date(releaseDate * 1000).toISOString() : undefined,
            totalEpisodes,
            lcAnimeId: lcAnimeId ? String(lcAnimeId) : undefined,
            poster,
          });
        }
      });

      scheduleDays.push({
        dayName: dayHeader,
        isToday,
        dayStart,
        dayEnd,
        count: animeList.length,
        animeList,
      });
    });

    const response: ScheduleResponse = {
      source: 'LiveChart.me',
      updatedAt: new Date().toISOString(),
      days: scheduleDays,
    };

    // Cache for 1 hour (3600s)
    globalCache.set(cacheKey, response, 3600);
    return response;
  }

  async getSeasonalSchedule(season = 'fall-2026'): Promise<any> {
    const cacheKey = `schedule:livechart:season:${season}`;
    const cached = globalCache.get<any>(cacheKey);
    if (cached) return cached;

    const url = `${ScheduleService.BASE_URL}/${season}/tv`;
    const html = await HttpClient.get(url);
    const $ = cheerio.load(html);

    const animeList: any[] = [];
    $('.anime-card, article[data-anime-item]').each((_, el) => {
      const title = $(el).find('.main-title, h3 a, .anime-card__title').first().text().trim();
      const href = $(el).find('a[href^="/anime/"]').first().attr('href');
      const poster = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');
      const studio = $(el).find('.anime-card__studios, .studios').text().trim();
      const premiere = $(el).find('.anime-card__premiere, .premiere').text().trim();

      if (title) {
        animeList.push({
          title,
          href,
          poster,
          studio: studio || undefined,
          premiere: premiere || undefined,
        });
      }
    });

    const result = {
      season,
      count: animeList.length,
      animeList,
    };

    globalCache.set(cacheKey, result, 7200);
    return result;
  }
}

export const scheduleService = new ScheduleService();

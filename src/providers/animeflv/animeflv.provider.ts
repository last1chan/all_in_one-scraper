import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult } from '../../types/anime.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class AnimeFlvProvider extends BaseProvider {
  readonly name = 'AnimeFLV';
  readonly defaultBaseUrl = 'https://www3.animeflv.net';
  readonly mirrorUrls = ['https://www3.animeflv.net', 'https://animeflv.net'];
  readonly languages = ['es'];
  readonly isSelfHosted = true;
  readonly librarySize = '4,000+';
  readonly serverType = 'hybrid' as const;

  constructor() {
    super();
    this.init();
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    try {
      const response = await axios.get(`${this.getBaseUrl()}/browse`, {
        params: { q: query }
      });
      
      const $ = cheerio.load(response.data);
      const results: AnimeSearchResult[] = [];
      
      $('.ListAnimes li').each((_, el) => {
        const titleEl = $(el).find('h3.Title');
        const urlEl = $(el).find('a');
        const imgEl = $(el).find('img');
        
        const title = titleEl.text().trim();
        const url = urlEl.attr('href') || '';
        const id = url.split('/').pop() || '';
        
        let poster = imgEl.attr('src') || imgEl.attr('data-cfsrc');
        if (poster && poster.startsWith('/')) {
            poster = this.getBaseUrl() + poster;
        }
        
        if (title && id) {
          results.push({
            id,
            title,
            poster,
            provider: this.name,
            url: this.getBaseUrl() + url
          });
        }
      });
      
      return results;
    } catch (e) {
      console.error('AnimeFLV search failed:', e);
      return [];
    }
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    return [];
  }

  async getServers(animeId: string, episodeNumber: number): Promise<Server[]> {
    return [];
  }

  async getSources(animeId: string, episodeNumber: number, serverId: string, subType: 'sub' | 'dub'): Promise<StreamResolutionResult> {
    throw new Error('Method not implemented.');
  }
}

export const animeFlvProvider = new AnimeFlvProvider();

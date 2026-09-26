import { ProviderHealth } from '../types/provider.js';

export class DomainManager {
  private primaryDomains: Map<string, string> = new Map();
  private mirrorPools: Map<string, string[]> = new Map();
  private healthCache: Map<string, ProviderHealth> = new Map();

  registerProvider(name: string, defaultDomain: string, mirrors: string[] = []): void {
    const all = Array.from(new Set([defaultDomain, ...mirrors]));
    this.primaryDomains.set(name, defaultDomain);
    this.mirrorPools.set(name, all);
  }

  getActiveDomain(name: string): string {
    const cachedHealth = this.healthCache.get(name);
    if (cachedHealth && cachedHealth.isOnline) {
      return cachedHealth.baseUrl;
    }
    return this.primaryDomains.get(name) || '';
  }

  setDomain(name: string, domain: string): void {
    this.primaryDomains.set(name, domain);
  }

  getMirrors(name: string): string[] {
    return this.mirrorPools.get(name) || [];
  }

  async checkProviderHealth(name: string): Promise<ProviderHealth> {
    const mirrors = this.getMirrors(name);
    if (!mirrors.length) {
      return {
        name,
        baseUrl: '',
        isOnline: false,
        latencyMs: 0,
        lastChecked: new Date(),
        activeMirrors: [],
      };
    }

    const checkPromises = mirrors.map(async (url) => {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          return { url, ok: false, latency: 99999 };
        }

        const text = await res.text();
        const lower = text.toLowerCase();
        // Disqualify challenge / fingerprint / turnstile pages
        const isChallenge =
          lower.includes('/js/fingerprint') ||
          lower.includes('challenge-platform') ||
          lower.includes('just a moment...') ||
          lower.includes('cf-browser-verification') ||
          text.length < 1500;

        return {
          url,
          ok: !isChallenge,
          latency: Date.now() - start,
        };
      } catch {
        return { url, ok: false, latency: 99999 };
      }
    });

    const results = await Promise.all(checkPromises);
    const active = results.filter((r) => r.ok).sort((a, b) => a.latency - b.latency);

    let chosenUrl = this.primaryDomains.get(name) || mirrors[0];
    let isOnline = false;
    let latencyMs = 0;

    if (active.length > 0) {
      isOnline = true;
      chosenUrl = active[0].url;
      latencyMs = active[0].latency;
      this.primaryDomains.set(name, chosenUrl);
    }

    const health: ProviderHealth = {
      name,
      baseUrl: chosenUrl,
      isOnline,
      latencyMs,
      lastChecked: new Date(),
      activeMirrors: active.map((a) => a.url),
    };

    this.healthCache.set(name, health);
    return health;
  }

  async checkAllHealth(): Promise<ProviderHealth[]> {
    const names = Array.from(this.mirrorPools.keys());
    return Promise.all(names.map((name) => this.checkProviderHealth(name)));
  }
}

export const domainManager = new DomainManager();

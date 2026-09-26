export interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  referer?: string;
  isAjax?: boolean;
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export class HttpClient {
  static getDefaultHeaders(referer?: string, isAjax = false): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': DEFAULT_UA,
      Accept: isAjax
        ? 'application/json, text/javascript, */*; q=0.01'
        : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': isAjax ? 'empty' : 'document',
      'Sec-Fetch-Mode': isAjax ? 'cors' : 'navigate',
      'Sec-Fetch-Site': 'same-origin',
    };

    if (isAjax) {
      headers['X-Requested-With'] = 'XMLHttpRequest';
    }
    if (referer) {
      headers['Referer'] = referer;
    }
    return headers;
  }

  static async get(url: string, options: RequestOptions = {}): Promise<string> {
    const retries = options.retries ?? 2;
    const timeoutMs = options.timeoutMs ?? 10000;
    const headers = {
      ...this.getDefaultHeaders(options.referer, options.isAjax),
      ...(options.headers || {}),
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`HTTP ${response.status} fetching ${url} - ${body.slice(0, 200)}`);
        }

        return await response.text();
      } catch (err: any) {
        lastError = err;
        if (attempt < retries) {
          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, 300 * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError;
  }

  static async getJson<T = any>(url: string, options: RequestOptions = {}): Promise<T> {
    const text = await this.get(url, { ...options, isAjax: true });
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Invalid JSON returned from ${url}: ${text.slice(0, 200)}`);
    }
  }
}

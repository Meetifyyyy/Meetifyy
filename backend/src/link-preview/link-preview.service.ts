import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as cheerio from 'cheerio';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import * as http from 'http';
import * as https from 'https';

@Injectable()
export class LinkPreviewService {
  async getPreview(url: string) {
    if (!url) {
      throw new BadRequestException('Missing url parameter');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new BadRequestException(
        'Protocol not supported. Only http and https allowed.',
      );
    }

    await this.assertPublicTarget(parsedUrl);

    try {
      const html = await this.fetchHtmlSafely(parsedUrl);
      const $ = cheerio.load(html);

      const getMeta = (prop: string) =>
        $(`meta[property="og:${prop}"]`).attr('content') ||
        $(`meta[name="og:${prop}"]`).attr('content') ||
        $(`meta[name="twitter:${prop}"]`).attr('content') ||
        null;

      const title = getMeta('title') || $('title').text() || null;
      const description =
        getMeta('description') ||
        $('meta[name="description"]').attr('content') ||
        null;
      const image = getMeta('image') || null;
      const siteName = getMeta('site_name') || parsedUrl.hostname;

      return {
        title: title ? title.trim() : null,
        description: description ? description.trim() : null,
        image,
        siteName,
        url: getMeta('url') || url,
        favicon: `https://www.google.com/s2/favicons?domain=${parsedUrl.hostname}&sz=32`,
      };
    } catch (err: any) {
      if (
        err instanceof BadRequestException ||
        err instanceof ForbiddenException ||
        err instanceof UnprocessableEntityException
      ) {
        throw err;
      }
      if (err.name === 'AbortError' || err.message?.includes('timed out')) {
        throw new UnprocessableEntityException('Request timed out');
      }
      throw new UnprocessableEntityException(
        `Could not fetch preview: ${err.message}`,
      );
    }
  }

  /**
   * Fetches the target HTML document with socket-level DNS verification (DNS pinning).
   * Verifies the target IP at connection time before the TCP handshake to eliminate
   * DNS rebinding / TOCTOU SSRF attacks.
   */
  private async fetchHtmlSafely(parsedUrl: URL): Promise<string> {
    return new Promise((resolve, reject) => {
      const transport = parsedUrl.protocol === 'https:' ? https : http;
      let settled = false;

      const safeLookup = (
        hostname: string,
        options: any,
        callback: (
          err: Error | null,
          address: string | any[],
          family: number,
        ) => void,
      ) => {
        lookup(hostname, { all: true })
          .then((entries) => {
            const addrs = Array.isArray(entries) ? entries : [entries];
            if (
              addrs.length === 0 ||
              addrs.some((e) => this.isPrivateAddress(e.address))
            ) {
              return callback(
                new ForbiddenException('Forbidden target host'),
                '',
                4,
              );
            }
            const first = addrs[0];
            callback(null, first.address, first.family);
          })
          .catch((err) => callback(err, '', 4));
      };

      const req = transport.request(
        parsedUrl,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'Meetifyy Link Preview Bot/1.0',
            Accept: 'text/html,application/xhtml+xml',
          },
          lookup: safeLookup,
          timeout: 5000,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
            settled = true;
            req.destroy();
            return reject(
              new ForbiddenException(
                'Redirects are not allowed for link previews',
              ),
            );
          }

          if (
            !res.statusCode ||
            res.statusCode < 200 ||
            res.statusCode >= 300
          ) {
            settled = true;
            req.destroy();
            return reject(
              new UnprocessableEntityException(
                `Target responded with status ${res.statusCode || 'unknown'}`,
              ),
            );
          }

          const contentType = res.headers['content-type'] || '';
          if (!contentType.includes('text/html')) {
            settled = true;
            req.destroy();
            return reject(
              new BadRequestException('URL did not return an HTML document'),
            );
          }

          const maxBytes = 1024 * 1024;
          const contentLength = Number(res.headers['content-length'] || 0);
          if (contentLength > maxBytes) {
            settled = true;
            req.destroy();
            return reject(new BadRequestException('HTML payload too large'));
          }

          const chunks: Buffer[] = [];
          let totalBytes = 0;

          res.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
              settled = true;
              req.destroy();
              return reject(new BadRequestException('HTML payload too large'));
            }
            chunks.push(chunk);
          });

          res.on('end', () => {
            if (settled) return;
            settled = true;
            if (chunks.length === 0) {
              return reject(new BadRequestException('Empty HTML response'));
            }
            resolve(Buffer.concat(chunks).toString('utf8'));
          });

          res.on('error', (err) => {
            if (settled) return;
            settled = true;
            reject(err);
          });
        },
      );

      req.on('timeout', () => {
        if (settled) return;
        settled = true;
        req.destroy();
        reject(new UnprocessableEntityException('Request timed out'));
      });

      req.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });

      req.end();
    });
  }

  private async assertPublicTarget(parsedUrl: URL): Promise<void> {
    const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      !hostname ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local')
    ) {
      throw new ForbiddenException('Forbidden target host');
    }

    const addresses = isIP(hostname)
      ? [hostname]
      : (await lookup(hostname, { all: true })).map(({ address }) => address);
    if (
      addresses.length === 0 ||
      addresses.some((address) => this.isPrivateAddress(address))
    ) {
      throw new ForbiddenException('Forbidden target host');
    }
  }

  private isPrivateAddress(address: string): boolean {
    const normalized = address.toLowerCase();
    if (isIP(normalized) === 4) {
      const octets = normalized.split('.').map(Number);
      const [a, b] = octets;
      return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a >= 224
      );
    }
    return (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.')
    );
  }
}

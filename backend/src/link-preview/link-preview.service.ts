import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as cheerio from 'cheerio';
import { stringField } from '../common/utils/type-guards.util';
import { lookup } from 'dns/promises';
import { BlockList, isIP, type LookupFunction } from 'net';
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
    } catch (err: unknown) {
      if (
        err instanceof BadRequestException ||
        err instanceof ForbiddenException ||
        err instanceof UnprocessableEntityException
      ) {
        throw err;
      }
      const message = stringField(err, 'message');
      if (
        stringField(err, 'name') === 'AbortError' ||
        message?.includes('timed out')
      ) {
        throw new UnprocessableEntityException('Request timed out');
      }
      throw new UnprocessableEntityException(
        `Could not fetch preview: ${message}`,
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

      const safeLookup: LookupFunction = (hostname, _options, callback) => {
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
          // dns.lookup rejects with an Error; anything else is wrapped so the
          // socket still receives one.
          .catch((err: unknown) =>
            callback(
              err instanceof Error ? err : new Error(String(err)),
              '',
              4,
            ),
          );
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

  /**
   * Whether an address is anything but a public unicast one.
   *
   * Decided by a `net.BlockList`, which compares an IPv4-mapped IPv6 address
   * (`::ffff:169.254.169.254`, or `::ffff:a9fe:a9fe` as the URL parser writes
   * it) against the IPv4 rules in every notation. The previous string checks
   * recognised only the dotted mapped form, and an IP-literal host skips DNS,
   * so `http://[::ffff:169.254.169.254]/` reached the metadata endpoint.
   */
  private isPrivateAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 0) return true;
    return PRIVATE_RANGES.check(address, family === 4 ? 'ipv4' : 'ipv6');
  }
}

const PRIVATE_RANGES = (() => {
  const ranges = new BlockList();
  for (const [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16], // link-local, including cloud metadata
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    // Carrier-grade NAT. Several clouds put their metadata service in here
    // (Alibaba's sits at 100.100.100.200).
    ['100.64.0.0', 10],
    ['224.0.0.0', 3], // multicast and reserved
  ] as const)
    ranges.addSubnet(network, prefix, 'ipv4');
  for (const [network, prefix] of [
    ['::', 96], // unspecified, loopback and IPv4-compatible (::a.b.c.d)
    ['fc00::', 7], // unique local
    ['fe80::', 10], // link-local
    ['ff00::', 8], // multicast
  ] as const)
    ranges.addSubnet(network, prefix, 'ipv6');
  return ranges;
})();

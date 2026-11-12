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

/** The `{ all: true }` form of the dns.lookup callback. */
type AllAddressesCallback = (
  err: NodeJS.ErrnoException | null,
  addresses: Array<{ address: string; family: number }>,
) => void;

/**
 * Wall-clock limit for one preview, DNS to last byte.
 *
 * `timeout` on a request is a socket IDLE timer: it restarts on every byte, so
 * a server that sends one byte every few seconds holds the request, and the
 * socket behind it, open until the 1 MB cap is reached. A preview is a page's
 * <head>, so a host that has not delivered it in this long is not worth a
 * socket.
 */
const PREVIEW_DEADLINE_MS = 8_000;

/**
 * Sockets the previewer may hold at once, per protocol.
 *
 * The global agent has no cap, so a burst of previews of slow hosts would open
 * as many sockets as there are requests. Past this number requests wait in the
 * agent's queue, which still counts against their own deadline. Keep-alive is
 * off because every request goes to a different, caller-chosen host and a
 * pooled socket would only sit idle.
 */
export const PREVIEW_MAX_SOCKETS = 16;

export const PREVIEW_AGENTS = {
  'http:': new http.Agent({
    maxSockets: PREVIEW_MAX_SOCKETS,
    keepAlive: false,
  }),
  'https:': new https.Agent({
    maxSockets: PREVIEW_MAX_SOCKETS,
    keepAlive: false,
  }),
};

@Injectable()
export class LinkPreviewService {
  /** An instance field only so a test can shorten it. */
  private deadlineMs = PREVIEW_DEADLINE_MS;

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

    // One deadline for everything below. AbortSignal.timeout's timer is
    // unreferenced, so it never keeps the process alive.
    const signal = AbortSignal.timeout(this.deadlineMs);

    // Inside the try so that a host that does not resolve ends the same way as
    // one that refuses the connection, rather than escaping as a raw 500.
    try {
      await this.rejectOnAbort(this.assertPublicTarget(parsedUrl), signal);
      const html = await this.fetchHtmlSafely(parsedUrl, signal);
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
   * A `lookup` for http(s).request that refuses private addresses at connect
   * time (DNS pinning).
   *
   * Node 20+ calls `lookup` with `{ all: true }` when autoSelectFamily is on
   * (the default) and then expects an ARRAY of `{ address, family }`. Handing
   * back a bare string there fails with ERR_INVALID_IP_ADDRESS, which broke
   * every link preview of a hostname URL. Both shapes are honoured.
   */
  private createSafeLookup(): LookupFunction {
    return (hostname, options, callback) => {
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
          if (options.all) {
            return (callback as AllAddressesCallback)(
              null,
              addrs.map((e) => ({ address: e.address, family: e.family })),
            );
          }
          const first = addrs[0];
          callback(null, first.address, first.family);
        })
        // dns.lookup rejects with an Error; anything else is wrapped so the
        // socket still receives one.
        .catch((err: unknown) =>
          callback(err instanceof Error ? err : new Error(String(err)), '', 4),
        );
    };
  }

  /**
   * Fetches the target HTML document with socket-level DNS verification (DNS pinning).
   * Verifies the target IP at connection time before the TCP handshake to eliminate
   * DNS rebinding / TOCTOU SSRF attacks.
   */
  private async fetchHtmlSafely(
    parsedUrl: URL,
    signal: AbortSignal,
  ): Promise<string> {
    let detach = () => {};
    const result = new Promise<string>((resolve, reject) => {
      const secure = parsedUrl.protocol === 'https:';
      const transport = secure ? https : http;
      let settled = false;

      const safeLookup = this.createSafeLookup();

      const req = transport.request(
        parsedUrl,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'Meetifyy Link Preview Bot/1.0',
            Accept: 'text/html,application/xhtml+xml',
          },
          lookup: safeLookup,
          agent: secure ? PREVIEW_AGENTS['https:'] : PREVIEW_AGENTS['http:'],
          // Idle only; the total bound is the deadline listener below.
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

      // The hard bound. Destroying the request closes the socket, which also
      // ends a response still being streamed and frees an agent slot. It is
      // armed after the error handler so the destroy cannot go unhandled.
      const onDeadline = () => {
        if (settled) return;
        settled = true;
        req.destroy();
        reject(new UnprocessableEntityException('Request timed out'));
      };
      detach = () => signal.removeEventListener('abort', onDeadline);
      if (signal.aborted) {
        onDeadline();
        return;
      }
      signal.addEventListener('abort', onDeadline, { once: true });

      req.end();
    });
    return result.finally(() => detach());
  }

  /**
   * Settles with `work`, or rejects as a timeout when the deadline fires first.
   * Used for the DNS lookup, which cannot itself be cancelled: it is abandoned
   * rather than waited for.
   */
  private rejectOnAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onAbort = () =>
        reject(new UnprocessableEntityException('Request timed out'));
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      work
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', onAbort));
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

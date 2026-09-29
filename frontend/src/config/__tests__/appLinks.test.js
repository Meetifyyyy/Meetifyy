import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { assetLinksFor } from '../../../scripts/app-links-plugin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.resolve(here, '../../../app-links.json'), 'utf8'));
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

describe('App Links (assetlinks.json)', () => {
  it('lists only well-formed SHA-256 fingerprints', () => {
    for (const list of Object.values(config.hosts)) {
      list.forEach((fp) => expect(fp).toMatch(FINGERPRINT));
    }
  });

  it('emits exactly the entry for the site being built', () => {
    const dev = assetLinksFor(config, 'https://dev.meetifyy.app');
    expect(dev).toHaveLength(1);
    expect(dev[0].target.package_name).toBe('app.meetifyy');
    expect(dev[0].target.sha256_cert_fingerprints).toEqual(config.hosts['dev.meetifyy.app']);
    expect(dev[0].relation).toEqual(['delegate_permission/common.handle_all_urls']);
  });

  it('never lets one environment claim the other', () => {
    const dev = config.hosts['dev.meetifyy.app'];
    const prod = config.hosts['meetifyy.app'];
    expect(dev.filter((fp) => prod.includes(fp))).toEqual([]);
  });

  it('emits nothing for an unknown or unconfigured host', () => {
    expect(assetLinksFor(config, 'http://localhost:3000')).toBeNull();
    expect(assetLinksFor(config, 'not a url')).toBeNull();
    if (config.hosts['meetifyy.app'].length === 0) {
      expect(assetLinksFor(config, 'https://meetifyy.app')).toBeNull();
    }
  });
});

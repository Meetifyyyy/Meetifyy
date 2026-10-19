import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { assetLinksFor } from '../../../scripts/app-links-plugin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.resolve(here, '../../../app-links.json'), 'utf8'));
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const fingerprintsOf = (entry) => (Array.isArray(entry) ? entry : entry.fingerprints);

describe('App Links (assetlinks.json)', () => {
  it('lists only well-formed SHA-256 fingerprints', () => {
    for (const entry of Object.values(config.hosts)) {
      fingerprintsOf(entry).forEach((fp) => expect(fp).toMatch(FINGERPRINT));
    }
  });

  it('emits exactly the entry for the site being built', () => {
    const dev = assetLinksFor(config, 'https://dev.meetifyy.app');
    expect(dev).toHaveLength(1);
    // Development links open the development app (debug builds are app.meetifyy.dev).
    expect(dev[0].target.package_name).toBe('app.meetifyy.dev');
    expect(dev[0].target.sha256_cert_fingerprints).toEqual(fingerprintsOf(config.hosts['dev.meetifyy.app']));
    expect(dev[0].relation).toEqual(['delegate_permission/common.handle_all_urls']);
  });

  it('never lets one environment claim the other', () => {
    const dev = fingerprintsOf(config.hosts['dev.meetifyy.app']);
    const prod = fingerprintsOf(config.hosts['meetifyy.app']);
    expect(dev.filter((fp) => prod.includes(fp))).toEqual([]);
  });

  it('falls back to the top-level packageName for a plain fingerprint list', () => {
    const links = assetLinksFor(
      { packageName: 'app.example', hosts: { 'x.test': [fingerprintsOf(config.hosts['dev.meetifyy.app'])[0]] } },
      'https://x.test',
    );
    expect(links[0].target.package_name).toBe('app.example');
  });

  it('emits nothing for an unknown or unconfigured host', () => {
    expect(assetLinksFor(config, 'http://localhost:3000')).toBeNull();
    expect(assetLinksFor(config, 'not a url')).toBeNull();
    if (fingerprintsOf(config.hosts['meetifyy.app']).length === 0) {
      expect(assetLinksFor(config, 'https://meetifyy.app')).toBeNull();
    }
  });
});

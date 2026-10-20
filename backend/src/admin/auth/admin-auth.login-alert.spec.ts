// EmailService pulls in sanitize-html, whose ESM dependency Jest cannot parse.
jest.mock('../../email/email.service', () => ({ EmailService: jest.fn() }));

import type { ConfigService } from '@nestjs/config';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { config } from '../../config';
import { AdminAuthService } from './admin-auth.service';
import { NewLoginEmail } from '../../email/templates/new-login';
import type { PrismaService } from '../../prisma/prisma.service';
import type { EmailService } from '../../email/email.service';
import { stub } from '../../common/testing/stub';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

describe('admin sign-in alert email', () => {
  beforeEach(() => {
    jest.replaceProperty(config.auth.admin, 'accessSecret', 'a-secret');
    jest.replaceProperty(config.auth.admin, 'refreshSecret', 'r-secret');
  });
  afterEach(() => jest.restoreAllMocks());

  it('is sent with the real device, browser, OS and IP', async () => {
    const sendNewLoginEmail = jest.fn().mockResolvedValue(undefined);
    const service = new AdminAuthService(
      stub<PrismaService>({
        superAdminSession: {
          create: jest.fn().mockResolvedValue({ id: 's1' }),
        },
        loginAudit: { create: jest.fn().mockResolvedValue({}) },
      }),
      stub<ConfigService>(),
      stub<EmailService>({ sendNewLoginEmail }),
    );

    await service['createAdminSession'](
      { id: 'a1', email: 'a@x.test', name: 'Ada', totpEnabled: false },
      '203.0.113.9',
      UA,
    );

    expect(sendNewLoginEmail).toHaveBeenCalledTimes(1);
    const [email, name, device, location, , browser, os, ip] = sendNewLoginEmail
      .mock.calls[0] as string[];
    expect([email, name]).toEqual(['a@x.test', 'Ada']);
    // The IP was previously passed as `location`, with browser/os/ip omitted.
    expect(location).not.toBe('203.0.113.9');
    expect(ip).toBe('203.0.113.9');
    expect(browser).toMatch(/^Chrome 131/);
    expect(os).toMatch(/^Linux/);
    expect(device.length).toBeGreaterThan(0);
  });

  it('template shows no invented session details', () => {
    const html = renderToStaticMarkup(
      createElement(NewLoginEmail, { name: 'Ada', time: 'now' }),
    );
    expect(html).not.toContain('192.168.1.1');
    expect(html).not.toContain('Chrome 126');
    expect(html).not.toContain('MacBook Pro');
    expect(html).not.toContain('Sonoma');
  });

  it('template shows the supplied details', () => {
    const html = renderToStaticMarkup(
      createElement(NewLoginEmail, {
        name: 'Ada',
        device: 'Linux Desktop',
        browser: 'Chrome 131',
        os: 'Linux',
        ip: '203.0.113.9',
      }),
    );
    expect(html).toContain('203.0.113.9');
    expect(html).toContain('Chrome 131');
  });
});

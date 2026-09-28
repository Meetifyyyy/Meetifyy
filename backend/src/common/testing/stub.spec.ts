import { stub } from './stub';

class Mailer {
  send(to: string): Promise<boolean> {
    return Promise.resolve(Boolean(to));
  }
  nested = { flush: (): number => 0 };
  connect(): { host: string; port: number } {
    return { host: 'mail', port: 25 };
  }
  async open(): Promise<{ id: string; lines: string[] }> {
    return Promise.resolve({ id: 'x', lines: [] });
  }
}

describe('stub', () => {
  it('returns the members it was given, typed as the real dependency', async () => {
    const send = jest.fn().mockResolvedValue(true);
    const mailer: Mailer = stub<Mailer>({ send });
    await mailer.send('a@example.test');
    expect(send).toHaveBeenCalledWith('a@example.test');
  });

  it('accepts nested partial members', () => {
    const mailer = stub<Mailer>({ nested: { flush: () => 3 } });
    expect(mailer.nested.flush()).toBe(3);
  });

  it('accepts a method whose result is itself partial, sync or async', async () => {
    const mailer = stub<Mailer>({
      connect: () => ({ host: 'test' }),
      open: () => Promise.resolve({ id: 'o1' }),
    });
    expect(mailer.connect().host).toBe('test');
    await expect(mailer.open()).resolves.toEqual({ id: 'o1' });
  });

  it('defaults to an empty stand-in', () => {
    expect(stub<Mailer>()).toEqual({});
  });
});

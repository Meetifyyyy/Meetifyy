import { stub } from './stub';

class Mailer {
  send(to: string): Promise<boolean> {
    return Promise.resolve(Boolean(to));
  }
  nested = { flush: (): number => 0 };
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

  it('defaults to an empty stand-in', () => {
    expect(stub<Mailer>()).toEqual({});
  });
});

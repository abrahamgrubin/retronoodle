import { describe, expect, it, vi } from 'vitest';
import { ResendNotifier } from './notifier.js';

describe('ResendNotifier', () => {
  it('posts a plain-text message with the API key and sender', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"id":"x"}', { status: 200 }));
    const notifier = new ResendNotifier('re_key', 'RetroNoodle <invite@retronoodle.com>', fetchImpl as unknown as typeof fetch);
    await notifier.sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Body' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_key');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'RetroNoodle <invite@retronoodle.com>',
      to: ['a@b.com'],
      subject: 'Hi',
      text: 'Body',
    });
  });

  it('throws on a non-2xx so the job retries, without leaking the address or key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"nope"}', { status: 429 }));
    const notifier = new ResendNotifier('re_key', 'x@y.com', fetchImpl as unknown as typeof fetch);
    const err = await notifier.sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Body' }).catch((e: Error) => e);
    expect((err as Error).message).toBe('Resend send failed: 429');
  });
});

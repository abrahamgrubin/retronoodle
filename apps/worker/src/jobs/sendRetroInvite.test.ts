import { describe, expect, it, vi } from 'vitest';
import { encryptJoinCode } from '../inviteCrypto.js';
import { runSendRetroInviteJob } from './sendRetroInvite.js';

const key = Buffer.alloc(32, 3);
const logger = { info: vi.fn(), error: vi.fn() };

function job(overrides: Partial<Parameters<typeof runSendRetroInviteJob>[0]> = {}) {
  return {
    to: 'guest@other.com',
    inviterName: 'Ada',
    retroName: 'Sprint 1 retro',
    encryptedJoinCode: encryptJoinCode(key, 'abc123'),
    ...overrides,
  };
}

describe('runSendRetroInviteJob', () => {
  it('emails the decrypted join link', async () => {
    const notifier = { sendEmail: vi.fn(async () => {}) };
    await runSendRetroInviteJob(job(), { notifier, inviteKey: key, webOrigin: 'https://retronoodle.com/', logger });
    expect(notifier.sendEmail).toHaveBeenCalledWith({
      to: 'guest@other.com',
      subject: 'Ada invited you to a retro: Sprint 1 retro',
      text: expect.stringContaining('https://retronoodle.com/join/abc123'),
    });
  });

  it('keeps newlines in user-supplied names out of the subject', async () => {
    const notifier = { sendEmail: vi.fn(async () => {}) };
    await runSendRetroInviteJob(job({ inviterName: 'Ada\r\nBcc: x@y.com', retroName: 'A\nB' }), {
      notifier,
      inviteKey: key,
      webOrigin: 'http://localhost:5173',
      logger,
    });
    const { subject } = (notifier.sendEmail.mock.calls[0] as unknown as [{ subject: string }])[0];
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('falls back to "A teammate" and never logs the address or link', async () => {
    const notifier = { sendEmail: vi.fn(async () => {}) };
    const log = { info: vi.fn(), error: vi.fn() };
    await runSendRetroInviteJob(job({ inviterName: '' }), { notifier, inviteKey: key, webOrigin: 'http://x', logger: log });
    expect((notifier.sendEmail.mock.calls[0] as unknown as [{ subject: string }])[0].subject).toMatch(/^A teammate invited you/);
    expect(JSON.stringify(log.info.mock.calls)).not.toMatch(/guest@other\.com|abc123/);
  });

  it('lets a send failure propagate so pg-boss retries', async () => {
    const notifier = { sendEmail: vi.fn(async () => { throw new Error('Resend send failed: 500'); }) };
    await expect(
      runSendRetroInviteJob(job(), { notifier, inviteKey: key, webOrigin: 'http://x', logger }),
    ).rejects.toThrow('500');
  });
});

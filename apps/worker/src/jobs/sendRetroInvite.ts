import type { WorkerLogger } from '../logger.js';
import { decryptJoinCode, type EncryptedPayload } from '../inviteCrypto.js';
import type { Notifier } from '../notifier.js';

/** One job per recipient, so a bounce or retry for one address never re-sends to the others. */
export interface RetroInviteJob {
  to: string;
  inviterName: string;
  retroName: string;
  encryptedJoinCode: EncryptedPayload;
}

export interface SendRetroInviteDeps {
  notifier: Notifier;
  inviteKey: Buffer;
  /** WEB_ORIGIN — where `/join/:code` lives. */
  webOrigin: string;
  logger: WorkerLogger;
}

/** Strips control characters (incl. newlines) so user-supplied names can't break a header line. */
function oneLine(value: string): string {
  return [...value].map((ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? ' ' : ch)).join('').replace(/ {2,}/g, ' ').trim();
}

export async function runSendRetroInviteJob(job: RetroInviteJob, deps: SendRetroInviteDeps): Promise<void> {
  const joinCode = decryptJoinCode(deps.inviteKey, job.encryptedJoinCode);
  const link = `${deps.webOrigin.replace(/\/$/, '')}/join/${joinCode}`;
  const inviter = oneLine(job.inviterName) || 'A teammate';
  const retro = oneLine(job.retroName);

  await deps.notifier.sendEmail({
    to: job.to,
    subject: `${inviter} invited you to a retro: ${retro}`,
    text: `${inviter} invited you to join the retro "${retro}" on RetroNoodle.\n\nJoin here: ${link}\n\nYou'll be asked to sign in with Google.`,
  });
  // No address, name or link in the log line — just that one went out.
  deps.logger.info('sent retro invite email');
}

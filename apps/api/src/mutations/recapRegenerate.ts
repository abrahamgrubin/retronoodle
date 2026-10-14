import { RecapRegeneratePayload, RecapRegenerateResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * recap.regenerate (RN-045): re-runs the recap agent team (ai.generateRecap) for a closed retro
 * whose recap came back `unavailable` — the recap page's own "Retry". Facilitator-only, same gate
 * as every other AI-regenerate mutation (`retro.editAiSummary`); gated to `closed` specifically
 * rather than through `allowedActions`, since the recap isn't part of that phase matrix at all —
 * there's nothing to recap before the retro is actually closed.
 */
export const recapRegenerateMutation: MutationTypeDef<RecapRegeneratePayload> = {
  schema: RecapRegeneratePayload,
  async apply({ client, retro, user, jobs }) {
    if (!can(user, 'retro.editAiSummary', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may regenerate the recap');
    }
    const phase = retro.phase as RetroPhase;
    if (phase !== 'closed') {
      throw new MutationRejected(409, 'phase_not_allowed', `recap.regenerate is not allowed during ${phase}`);
    }

    await client.query(
      `insert into retro_recaps (retro_id, status) values ($1, 'pending')
       on conflict (retro_id) do update set status = 'pending'`,
      [retro.id],
    );
    if (jobs) {
      try {
        await jobs.send('ai.generateRecap', { retroId: retro.id });
      } catch {
        // Swallowed deliberately, same as every other best-effort AI enqueue in this app.
      }
    }

    return RecapRegenerateResult.parse({ status: 'pending' });
  },
};

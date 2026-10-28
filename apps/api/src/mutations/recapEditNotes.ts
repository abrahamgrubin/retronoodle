import { RecapEditNotesPayload, RecapEditNotesResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * recap.editNotes (RN-045 follow-up): the "Additional notes" section, written from the Wrap up
 * screen and editable again on the recap page once the retro is closed. Facilitator-authored free
 * text, no AI involvement. Upserts, since nothing else creates the retro_recaps row.
 */
export const recapEditNotesMutation: MutationTypeDef<RecapEditNotesPayload> = {
  schema: RecapEditNotesPayload,
  async apply({ client, retro, user, payload }) {
    if (!can(user, 'retro.editAiSummary', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may edit the recap');
    }
    const phase = retro.phase as RetroPhase;
    if (phase !== 'closed' && phase !== 'wrap_up') {
      throw new MutationRejected(409, 'phase_not_allowed', `recap.editNotes is not allowed during ${phase}`);
    }

    const upserted = await client.query<{ additional_notes: string }>(
      `insert into retro_recaps (retro_id, additional_notes) values ($1, $2)
       on conflict (retro_id) do update set additional_notes = excluded.additional_notes
       returning additional_notes`,
      [retro.id, payload.notes],
    );
    return RecapEditNotesResult.parse({ notes: upserted.rows[0]!.additional_notes });
  },
};

import { RecapEditNotesPayload, RecapEditNotesResult, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * recap.editNotes (RN-045 follow-up): the recap page's own "Additional Notes" section —
 * facilitator-authored free text with no AI involvement at all, unlike every other recap
 * mutation. Same facilitator-only gate as the rest of this group.
 *
 * Also allowed in Wrap up, where the Wrap up screen's "Additional notes" section writes the same
 * field before the retro closes. No recap row exists yet at that point (retro.close seeds it), so
 * Wrap up upserts one as `pending`; retro.close's own `on conflict do nothing` insert then keeps
 * it, notes included, and ai.generateRecap only ever updates the other columns.
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

    if (phase === 'wrap_up') {
      const upserted = await client.query<{ additional_notes: string }>(
        `insert into retro_recaps (retro_id, status, additional_notes) values ($1, 'pending', $2)
         on conflict (retro_id) do update set additional_notes = excluded.additional_notes
         returning additional_notes`,
        [retro.id, payload.notes],
      );
      return RecapEditNotesResult.parse({ notes: upserted.rows[0]!.additional_notes });
    }

    const updated = await client.query<{ additional_notes: string }>(
      'update retro_recaps set additional_notes = $1 where retro_id = $2 returning additional_notes',
      [payload.notes, retro.id],
    );
    const row = updated.rows[0];
    // GET /retros/:id/recap always seeds a retro_recaps row before this page shows any editable
    // section at all (recap.ts's own "self-healing" insert) — this should only ever trip if
    // someone fires the mutation directly without ever having loaded the page.
    if (!row) throw new MutationRejected(404, 'not_found', 'No recap to edit yet');

    return RecapEditNotesResult.parse({ notes: row.additional_notes });
  },
};

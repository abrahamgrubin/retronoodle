import { TopicAssignSpeakerPayload, TopicAssignSpeakerResult, TRANSCRIPTION_CAPTURE_PHASES, type RetroPhase } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import type { MutationTypeDef } from './registry.js';
import { MutationRejected } from './errors.js';

/**
 * topic.assignSpeaker (RN-036): facilitator-only, "Who is this?" one-click fix. Assigns every
 * transcript segment in the topic tagged with this diarized voice (`speakerTag`) to `userId` —
 * the same grouping the UI lists an unmatched voice by, so one click resolves every line it said,
 * not just one. Allowed in Discuss or Wrap up, same phases audio is ever captured in; a topic from
 * an earlier retro (no recording, or already closed) has nothing to fix.
 */
export const topicAssignSpeakerMutation: MutationTypeDef<TopicAssignSpeakerPayload> = {
  schema: TopicAssignSpeakerPayload,
  async apply({ client, retro, user, payload }) {
    if (!can(user, 'retro.manageRecording', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
      throw new MutationRejected(403, 'forbidden', 'Only the facilitator may assign a speaker');
    }
    const phase = retro.phase as RetroPhase;
    if (!(TRANSCRIPTION_CAPTURE_PHASES as readonly string[]).includes(phase)) {
      throw new MutationRejected(409, 'phase_not_allowed', `topic.assignSpeaker is not allowed during ${phase}`);
    }

    const result = await client.query<{ id: string }>(
      `update transcript_segments set speaker_user_id = $1
       where topic_id = $2 and speaker_tag = $3 and retro_id = $4
       returning id`,
      [payload.userId, payload.topicId, payload.speakerTag, retro.id],
    );
    if (result.rows.length === 0) {
      throw new MutationRejected(404, 'not_found', 'No transcript lines match that speaker in this topic');
    }

    return TopicAssignSpeakerResult.parse({
      topicId: payload.topicId,
      speakerTag: payload.speakerTag,
      userId: payload.userId,
      segmentIds: result.rows.map((r) => r.id),
    });
  },
};

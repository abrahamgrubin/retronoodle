import { describe, expect, it, vi } from 'vitest';
import { audioGatewayUrl, fetchBoard, uploadSpeechActivity } from './board';
import { API_URL } from './api';

describe('fetchBoard', () => {
  it('sends the access token and parses the response', async () => {
    let seenHeaders: Record<string, string> | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string>;
      return new Response(
        JSON.stringify({
          retro: {
            id: '00000000-0000-4000-8000-000000000001',
            teamId: '00000000-0000-4000-8000-000000000002',
            name: 'Sprint 1 retro',
            phase: 'write',
            facilitatorId: '00000000-0000-4000-8000-000000000003',
            templateId: '00000000-0000-4000-8000-000000000004',
            templateSource: 'builtin',
            cardsRevealed: false,
            phaseDeadline: '2026-01-01T00:05:00.000Z',
            voteBudget: 3,
            retroCadenceDays: 14,
            nextRetroAt: null,
          },
          columns: [],
          cards: [],
          topics: [],
          suggestions: null,
          myVotes: [],
          votingProgress: null,
          topicSummaries: [],
          actionItems: [],
          actionItemReviewOutcomes: [],
          teamMembers: [],
          attendees: [],
          recordingSession: null,
          transcriptSegments: [],
          unmatchedSpeakers: null,
          seq: 0,
          serverTime: '2026-01-01T00:00:00.000Z',
        }),
      );
    });

    const board = await fetchBoard('token-123', 'retro-1', fetchImpl as unknown as typeof fetch);
    expect(board.retro.name).toBe('Sprint 1 retro');
    expect(board.serverTime).toBe('2026-01-01T00:00:00.000Z');
    expect(seenHeaders?.Authorization).toBe('Bearer token-123');
  });

  it('rejects a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 403 }));
    await expect(fetchBoard('token-123', 'retro-1', fetchImpl as typeof fetch)).rejects.toThrow(/403/);
  });
});

describe('uploadSpeechActivity', () => {
  it('sends the access token and the interval batch', async () => {
    let seenBody: unknown;
    let seenHeaders: Record<string, string> | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seenBody = JSON.parse(init?.body as string);
      seenHeaders = init?.headers as Record<string, string>;
      return new Response(null, { status: 204 });
    });
    await uploadSpeechActivity('token-123', 'retro-1', [{ startMs: 0, endMs: 500 }], fetchImpl as unknown as typeof fetch);
    expect(seenHeaders?.Authorization).toBe('Bearer token-123');
    expect(seenBody).toEqual({ intervals: [{ startMs: 0, endMs: 500 }] });
  });

  it('does not call fetch for an empty interval batch', async () => {
    const fetchImpl = vi.fn();
    await uploadSpeechActivity('token-123', 'retro-1', [], fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('audioGatewayUrl', () => {
  it('derives ws(s) from API_URL and carries the token as a query param', () => {
    const url = audioGatewayUrl('token-123', 'retro-1');
    expect(url).toBe(`${API_URL.replace(/^http/, 'ws')}/retros/retro-1/audio-gateway?token=token-123`);
    expect(url.startsWith('ws')).toBe(true);
  });
});

import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { topicSummaryParagraph, type ActionItem, type Topic, type TopicSummary, type TopicSummaryPoint, type UnmatchedSpeaker } from '@retronoodle/shared';
import { Box, Button, MenuItem, Select, Skeleton, Stack, Typography } from '@mui/material';
import {
  BORDER,
  CHIP_BG,
  CaptureAction,
  Icon,
  OutlinedButton,
  PRIMARY,
  PRIMARY_TINT,
  PersonAvatar,
  PhaseControlsBar,
  PrimaryButton,
  SURFACE,
  SecondaryButton,
  TEXT,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  topicLabel,
} from './DiscussScreen';

// Figma "START · Recap — Edit mode" (node 96:817, inside 93:1706) tokens not already shared.
const INPUT_BORDER = '#ccd1dc';
const MAX_NOTES_LENGTH = 4000;

const STATUS_STYLE: Record<ActionItem['status'], { label: string; dot: string }> = {
  open: { label: 'Open', dot: TEXT_SECONDARY },
  in_progress: { label: 'In progress', dot: '#c58e26' },
  done: { label: 'Done', dot: '#32824d' },
  dropped: { label: 'Dropped', dot: TEXT_TERTIARY },
};

function formatDueDate(dueDate: string): string {
  // `YYYY-MM-DD` is a calendar date, not an instant — parsed as local midnight so it never shows
  // as the day before in timezones west of UTC.
  const [y, m, d] = dueDate.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function Card({ children, gap = '20px', p = '24px' }: { children: ReactNode; gap?: string; p?: string }) {
  return (
    <Stack sx={{ bgcolor: 'white', border: `1px solid ${BORDER}`, borderRadius: '12px', p, gap, width: '100%', boxSizing: 'border-box', minWidth: 0 }}>
      {children}
    </Stack>
  );
}

function SectionHeading({ title, count, aside }: { title: string; count?: number; aside?: ReactNode }) {
  return (
    <Stack direction="row" spacing="10px" sx={{ alignItems: 'center' }}>
      <Typography component="h2" sx={{ fontSize: 18, fontWeight: 600, color: TEXT }}>
        {title}
      </Typography>
      {count !== undefined && (
        <Box sx={{ bgcolor: CHIP_BG, borderRadius: 999, px: 1, py: '3px' }}>
          <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY, lineHeight: 'normal' }}>{count}</Typography>
        </Box>
      )}
      {aside}
    </Stack>
  );
}

/** The pencil toggle beside a section heading (Figma "Edit control", 96:889) — tinted blue while
 * its section is in edit mode. Shared by Topic summaries and Additional notes. */
function EditToggle({ editing, label, onClick }: { editing: boolean; label: string; onClick: () => void }) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={editing ? `Stop editing ${label}` : `Edit ${label}`}
      aria-pressed={editing}
      onClick={onClick}
      sx={{
        width: 32,
        height: 32,
        borderRadius: '6px',
        border: `1px solid ${editing ? PRIMARY : BORDER}`,
        bgcolor: editing ? PRIMARY_TINT : 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        p: 0,
      }}
    >
      <Icon name="pencil" size={16} />
    </Box>
  );
}

const textareaSx = {
  width: '100%',
  boxSizing: 'border-box',
  p: '12px',
  bgcolor: 'white',
  border: `1px solid ${INPUT_BORDER}`,
  borderRadius: '6px',
  font: 'inherit',
  fontSize: 14,
  lineHeight: '21px',
  color: TEXT,
  resize: 'vertical',
  '&::placeholder': { color: TEXT_TERTIARY },
  '&:focus': { outline: `2px solid ${PRIMARY}`, outlineOffset: -1 },
} as const;

function pointsToLines(points: TopicSummaryPoint[]): string {
  return points.map((p) => p.text).join('\n');
}

/** Lines back to points, keeping each unchanged line's original sources (the card/transcript
 * citations RN-021/RN-037 attach) — only new or reworded lines lose them. */
function linesToPoints(text: string, previous: TopicSummaryPoint[]): TopicSummaryPoint[] {
  const sourcesByText = new Map(previous.map((p) => [p.text.trim(), p.sources]));
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ text: line, sources: sourcesByText.get(line) ?? [] }));
}

type SummaryDraft = { keyPoints: string; decisions: string; disagreements: string };

function draftFor(summary: TopicSummary): SummaryDraft {
  return {
    keyPoints: pointsToLines(summary.keyPoints),
    decisions: pointsToLines(summary.decisions),
    disagreements: pointsToLines(summary.disagreements),
  };
}

function TopicSummaries({
  topics,
  summaryFor,
  unavailableIds,
  canManage,
  onSave,
  onRegenerate,
}: {
  topics: Topic[];
  summaryFor: (topicId: string) => TopicSummary | null;
  unavailableIds: string[];
  canManage: boolean;
  onSave: (topicId: string, keyPoints: TopicSummaryPoint[], decisions: TopicSummaryPoint[], disagreements: TopicSummaryPoint[], proposedActionItems: TopicSummaryPoint[]) => void;
  onRegenerate: (topicId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, SummaryDraft>>({});
  const [requestedIds, setRequestedIds] = useState<string[]>([]);

  function startEditing() {
    const next: Record<string, SummaryDraft> = {};
    for (const t of topics) {
      const summary = summaryFor(t.id);
      if (summary) next[t.id] = draftFor(summary);
    }
    setDrafts(next);
    setEditing(true);
  }

  function save() {
    for (const t of topics) {
      const summary = summaryFor(t.id);
      const draft = drafts[t.id];
      if (!summary || !draft) continue;
      const original = draftFor(summary);
      if (draft.keyPoints === original.keyPoints && draft.decisions === original.decisions && draft.disagreements === original.disagreements) continue;
      onSave(
        t.id,
        linesToPoints(draft.keyPoints, summary.keyPoints),
        linesToPoints(draft.decisions, summary.decisions),
        linesToPoints(draft.disagreements, summary.disagreements),
        summary.proposedActionItems,
      );
    }
    setEditing(false);
  }

  // RN-021: "Regenerating an edited summary first asks 'Replace your edits?'."
  function regenerate(topicId: string) {
    if (summaryFor(topicId)?.edited && !window.confirm('Replace your edits?')) return;
    onRegenerate(topicId);
  }

  return (
    <Card>
      <SectionHeading
        title="Topic summaries"
        aside={
          canManage && topics.some((t) => summaryFor(t.id)) ? (
            <EditToggle editing={editing} label="summaries" onClick={editing ? () => setEditing(false) : startEditing} />
          ) : undefined
        }
      />
      {topics.length === 0 && <Typography sx={{ fontSize: 14, color: TEXT_SECONDARY }}>No topics were discussed.</Typography>}
      {topics.map((t, i) => {
        const summary = summaryFor(t.id);
        const unavailable = unavailableIds.includes(t.id);
        const draft = drafts[t.id];
        return (
          <Stack key={t.id} spacing="10px">
            {i > 0 && <Box sx={{ height: '1px', bgcolor: BORDER }} />}
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Typography component="h3" sx={{ fontSize: 16, fontWeight: 600, color: TEXT, overflowWrap: 'anywhere' }}>
                {topicLabel(t)}
              </Typography>
              {editing && canManage && summary && (
                <Button type="button" size="small" onClick={() => regenerate(t.id)} sx={{ textTransform: 'none', fontSize: 12, color: PRIMARY, flexShrink: 0 }}>
                  Regenerate
                </Button>
              )}
            </Stack>
            {/* A topic still open when Discuss ended (phase.next doesn't end it) never had a
                summary requested — offer one instead of an endless "Summarizing…". Requested
                topics move to Summarizing via `requestedIds`. */}
            {!summary && !unavailable && !t.endedAt && !requestedIds.includes(t.id) && (
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <Typography sx={{ fontSize: 14, color: TEXT_SECONDARY }}>Not summarized yet.</Typography>
                {canManage && (
                  <SecondaryButton
                    onClick={() => {
                      setRequestedIds((ids) => [...ids, t.id]);
                      onRegenerate(t.id);
                    }}
                  >
                    Summarize
                  </SecondaryButton>
                )}
              </Stack>
            )}
            {!summary && !unavailable && (t.endedAt || requestedIds.includes(t.id)) && (
              <Stack spacing={0.5} aria-busy="true">
                <Typography sx={{ fontSize: 14, color: TEXT_SECONDARY }}>Summarizing…</Typography>
                <Skeleton variant="text" />
              </Stack>
            )}
            {!summary && unavailable && (
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <Typography sx={{ fontSize: 14, color: TEXT_SECONDARY }}>Summary unavailable.</Typography>
                {canManage && <SecondaryButton onClick={() => onRegenerate(t.id)}>Retry</SecondaryButton>}
              </Stack>
            )}
            {summary && (!editing || !draft) && (
              <Typography sx={{ fontSize: 14, lineHeight: '22px', color: TEXT_SECONDARY, overflowWrap: 'anywhere' }}>{topicSummaryParagraph(summary)}</Typography>
            )}
            {summary && editing && draft && (
              <Stack spacing={1.5}>
                {(
                  [
                    ['keyPoints', 'Key points'],
                    ['decisions', 'Decisions'],
                    ['disagreements', 'Disagreements'],
                  ] as const
                ).map(([field, label]) => (
                  <Stack key={field} spacing={0.75}>
                    <Typography component="label" htmlFor={`rn-summary-${t.id}-${field}`} sx={{ fontSize: 12, fontWeight: 500, color: TEXT_SECONDARY }}>
                      {label} (one per line)
                    </Typography>
                    <Box
                      component="textarea"
                      id={`rn-summary-${t.id}-${field}`}
                      rows={3}
                      value={draft[field]}
                      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDrafts((d) => ({ ...d, [t.id]: { ...draft, [field]: e.target.value } }))}
                      sx={textareaSx}
                    />
                  </Stack>
                ))}
              </Stack>
            )}
          </Stack>
        );
      })}
      {editing && (
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <SecondaryButton onClick={() => setEditing(false)}>Cancel</SecondaryButton>
          <PrimaryButton height={38} onClick={save}>
            Save summaries
          </PrimaryButton>
        </Stack>
      )}
    </Card>
  );
}

function StatusChip({ status }: { status: ActionItem['status'] }) {
  const { label, dot } = STATUS_STYLE[status];
  return (
    <Stack direction="row" spacing="5px" sx={{ alignItems: 'center', bgcolor: CHIP_BG, borderRadius: 999, px: 1, py: '5px', flexShrink: 0 }}>
      <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: dot }} />
      <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY, lineHeight: 'normal', whiteSpace: 'nowrap' }}>{label}</Typography>
    </Stack>
  );
}

function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <Typography component={htmlFor ? 'label' : 'p'} htmlFor={htmlFor} sx={{ fontSize: 12, fontWeight: 500, color: TEXT_SECONDARY }}>
      {children}
    </Typography>
  );
}

function ChevronIcon(props: { className?: string }) {
  // MUI passes its own className (rotation while open, positioning) to the select's icon slot.
  return (
    <Box component="span" className={props.className} sx={{ display: 'flex', right: '10px !important', top: 'calc(50% - 7px) !important', pointerEvents: 'none' }}>
      <Icon name="chevron-down-blue" size={14} />
    </Box>
  );
}

/** Due date control: the design's "Set due date" box, backed by a native date input so every
 * browser's own picker (and keyboard entry) still works. */
function DueDateField({ id, value, title, onChange }: { id: string; value: string | null; title: string; onChange: (dueDate: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <Box sx={{ position: 'relative', width: '100%' }}>
      <Box
        component="button"
        type="button"
        onClick={() => {
          const input = inputRef.current;
          if (!input) return;
          if (typeof input.showPicker === 'function') input.showPicker();
          else input.focus();
        }}
        aria-label={value ? `Due date for ${title}: ${formatDueDate(value)}. Change` : `Set due date for ${title}`}
        sx={{
          width: '100%',
          height: 40,
          boxSizing: 'border-box',
          px: '10px',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          bgcolor: 'white',
          border: `1px solid ${INPUT_BORDER}`,
          borderRadius: '6px',
          cursor: 'pointer',
          font: 'inherit',
          fontSize: 13,
          color: value ? TEXT : TEXT_SECONDARY,
          textAlign: 'left',
          '&:focus-visible': { outline: `2px solid ${PRIMARY}`, outlineOffset: -1 },
        }}
      >
        <Icon name="calendar-days" size={16} />
        {value ? formatDueDate(value) : 'Set due date'}
      </Box>
      <Box
        component="input"
        ref={inputRef}
        id={id}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value ?? ''}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value || null)}
        sx={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: 0, opacity: 0, border: 0, p: 0, pointerEvents: 'none' }}
      />
    </Box>
  );
}

function ActionItemsSection({
  items,
  teamMembers,
  canEdit,
  onUpdate,
}: {
  items: ActionItem[];
  teamMembers: { id: string; displayName: string }[];
  canEdit: boolean;
  onUpdate: (id: string, patch: { ownerId?: string | null; dueDate?: string | null }) => void;
}) {
  const memberName = (id: string | null) => (id ? (teamMembers.find((m) => m.id === id)?.displayName ?? 'Former member') : 'Unassigned');
  return (
    <Card gap="16px" p="24px 24px 8px">
      <Stack spacing={1}>
        <SectionHeading title="Action Items" count={items.length} />
        <Typography sx={{ fontSize: 13, lineHeight: '20px', color: TEXT_SECONDARY }}>
          Keep next steps moving. Select an assignee or set a due date for each action.
        </Typography>
      </Stack>
      <Box>
        {items.length === 0 && (
          <Typography sx={{ fontSize: 13, color: TEXT_TERTIARY, borderTop: `1px solid ${BORDER}`, py: '18px' }}>No action items yet.</Typography>
        )}
        {items.map((item) => (
          <Stack
            key={item.id}
            direction="row"
            sx={{
              alignItems: 'center',
              gap: '18px',
              py: '18px',
              borderTop: `1px solid ${BORDER}`,
              flexWrap: 'wrap',
              '@container (max-width: 760px)': { alignItems: 'flex-start' },
            }}
          >
            <Typography sx={{ flex: '1 1 220px', minWidth: 0, fontSize: 14, lineHeight: '21px', color: TEXT, overflowWrap: 'anywhere' }}>{item.title}</Typography>
            <StatusChip status={item.status} />
            {canEdit ? (
              <>
                <Stack spacing="6px" sx={{ width: 205 }}>
                  <FieldLabel>Assignee</FieldLabel>
                  <Select
                    value={item.ownerId ?? ''}
                    displayEmpty
                    onChange={(e) => onUpdate(item.id, { ownerId: e.target.value || null })}
                    inputProps={{ 'aria-label': `Assignee for ${item.title}` }}
                    IconComponent={ChevronIcon}
                    renderValue={(value) => (
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                        <PersonAvatar id={value || null} name={memberName(value || null)} />
                        <Typography sx={{ fontSize: 13, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{memberName(value || null)}</Typography>
                      </Stack>
                    )}
                    sx={{
                      height: 40,
                      bgcolor: 'white',
                      borderRadius: '6px',
                      '& .MuiOutlinedInput-notchedOutline': { borderColor: INPUT_BORDER },
                      '& .MuiSelect-select': { py: 0, pl: '10px', pr: '32px !important', display: 'flex', alignItems: 'center' },
                    }}
                  >
                    <MenuItem value="" sx={{ fontSize: 13 }}>
                      Unassigned
                    </MenuItem>
                    {teamMembers.map((m) => (
                      <MenuItem key={m.id} value={m.id} sx={{ fontSize: 13 }}>
                        {m.displayName}
                      </MenuItem>
                    ))}
                  </Select>
                </Stack>
                <Stack spacing="6px" sx={{ width: 152 }}>
                  <FieldLabel htmlFor={`rn-due-${item.id}`}>Due date</FieldLabel>
                  <DueDateField id={`rn-due-${item.id}`} value={item.dueDate} title={item.title} onChange={(dueDate) => onUpdate(item.id, { dueDate })} />
                </Stack>
              </>
            ) : (
              <Typography sx={{ fontSize: 13, color: TEXT_SECONDARY, flexShrink: 0 }}>
                {memberName(item.ownerId)}
                {item.dueDate && ` · due ${formatDueDate(item.dueDate)}`}
              </Typography>
            )}
          </Stack>
        ))}
      </Box>
    </Card>
  );
}

/** "Additional notes" — the recap's facilitator-authored notes (recap.editNotes), written here
 * before close and shown on the recap page afterwards. Explicit "Save notes", per the design,
 * rather than the topic notes' autosave. Saved notes show read-only; the facilitator's pencil
 * (same control as Topic summaries) reopens them for editing. With nothing saved yet the field
 * starts editable, since there's nothing to show read-only. */
function AdditionalNotes({ notes, canEdit, onSave }: { notes: string; canEdit: boolean; onSave: (notes: string) => void }) {
  const [editing, setEditing] = useState(canEdit && !notes);
  const [draft, setDraft] = useState(notes);
  const [seenNotes, setSeenNotes] = useState(notes);
  // Another browser's save (or this one's own, echoed back) updates what's shown — but never
  // overwrites a draft this facilitator is in the middle of writing. Adjusted during render
  // (React's "storing information from previous renders" pattern), not in an effect.
  if (notes !== seenNotes) {
    setSeenNotes(notes);
    if (!editing) setDraft(notes);
  }

  function startEditing() {
    setDraft(notes);
    setEditing(true);
  }

  // Pencil while editing = cancel: drops the draft. Only offered when there's saved text to go
  // back to — an empty first draft has no read-only state to return to.
  function cancelEditing() {
    setDraft(notes);
    setEditing(false);
  }

  function save() {
    onSave(draft);
    setEditing(false);
  }

  const showEditor = canEdit && editing;
  const dirty = draft !== notes;

  return (
    <Card gap="16px">
      <SectionHeading
        title="Additional notes"
        aside={
          canEdit && notes ? <EditToggle editing={editing} label="additional notes" onClick={editing ? cancelEditing : startEditing} /> : undefined
        }
      />
      <Stack spacing={1}>
        <Typography sx={{ fontSize: 13, color: TEXT_SECONDARY }}>Add context or follow-up notes for the team.</Typography>
        {showEditor ? (
          <Box
            component="textarea"
            aria-label="Additional notes"
            placeholder="Write additional notes here…"
            maxLength={MAX_NOTES_LENGTH}
            value={draft}
            autoFocus={Boolean(notes)}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
            sx={{ ...textareaSx, height: 112 }}
          />
        ) : (
          <Box
            data-testid="additional-notes-readonly"
            sx={{ bgcolor: SURFACE, border: `1px solid ${BORDER}`, borderRadius: '6px', p: '12px', minHeight: 112, boxSizing: 'border-box' }}
          >
            <Typography sx={{ fontSize: 14, lineHeight: '21px', color: notes ? TEXT : TEXT_TERTIARY, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {notes || 'Only the facilitator can add notes.'}
            </Typography>
          </Box>
        )}
      </Stack>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, minHeight: 38 }}>
        <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY }}>
          {showEditor && dirty ? 'Unsaved changes' : notes ? 'Saved' : 'No additional notes yet.'}
        </Typography>
        {showEditor && (
          <PrimaryButton height={38} disabled={!dirty} onClick={save}>
            Save notes
          </PrimaryButton>
        )}
      </Stack>
    </Card>
  );
}

function Attendance({ attendees, facilitatorId }: { attendees: { id: string; displayName: string }[]; facilitatorId: string }) {
  // Facilitator first, then everyone else alphabetically.
  const sorted = [...attendees].sort((a, b) =>
    a.id === facilitatorId ? -1 : b.id === facilitatorId ? 1 : a.displayName.localeCompare(b.displayName),
  );
  return (
    <Card>
      <SectionHeading title="Attendance" count={attendees.length} />
      {sorted.length === 0 && <Typography sx={{ fontSize: 13, color: TEXT_TERTIARY }}>No one has joined yet.</Typography>}
      {sorted.map((a) => (
        <Stack key={a.id} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ transform: 'scale(1.333)', transformOrigin: 'center', mx: '4px' }}>
            <PersonAvatar id={a.id} name={a.displayName} />
          </Box>
          <Stack spacing="5px" sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 500, color: TEXT, overflowWrap: 'anywhere' }}>{a.displayName}</Typography>
            <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY }}>{a.id === facilitatorId ? 'Facilitator' : 'Participant'}</Typography>
          </Stack>
        </Stack>
      ))}
    </Card>
  );
}

function TopicsNotDiscussed({ topics }: { topics: Topic[] }) {
  return (
    <Card gap="18px">
      <SectionHeading title="Topics not discussed" count={topics.length} />
      <Typography sx={{ fontSize: 13, lineHeight: '20px', color: TEXT_SECONDARY }}>
        {topics.length > 0 ? 'These topics remain available to revisit in a future discussion.' : 'Every topic was discussed.'}
      </Typography>
      {topics.length > 0 && (
        <Stack spacing="14px">
          {topics.map((t, i) => (
            <Stack key={t.id} spacing="14px">
              {i > 0 && <Box sx={{ height: '1px', bgcolor: BORDER }} />}
              <Stack direction="row" spacing="10px" sx={{ alignItems: 'center' }}>
                <Icon name="message-square" size={16} />
                <Typography sx={{ fontSize: 14, lineHeight: '20px', color: TEXT, overflowWrap: 'anywhere' }}>{topicLabel(t)}</Typography>
              </Stack>
            </Stack>
          ))}
        </Stack>
      )}
    </Card>
  );
}

/** RN-036's "Who is this?" — not in the Figma frame; kept as a design-styled card so the
 * facilitator can still match unknown voices before closing. */
function WhoIsThis({
  speakers,
  teamMembers,
  onAssign,
}: {
  speakers: UnmatchedSpeaker[];
  teamMembers: { id: string; displayName: string }[];
  onAssign: (topicId: string, speakerTag: number, userId: string) => void;
}) {
  return (
    <Card gap="16px">
      <SectionHeading title="Who is this?" count={speakers.length} />
      <Typography sx={{ fontSize: 13, lineHeight: '20px', color: TEXT_SECONDARY }}>Match unrecognized voices so summaries credit the right person.</Typography>
      {speakers.map((speaker) => (
        <Stack key={`${speaker.topicId}-${speaker.speakerTag}`} spacing={1} sx={{ bgcolor: SURFACE, borderRadius: '8px', p: '12px' }}>
          <Typography sx={{ fontSize: 13, fontStyle: 'italic', color: TEXT, overflowWrap: 'anywhere' }}>“{speaker.sampleText}”</Typography>
          <Select
            size="small"
            displayEmpty
            value=""
            onChange={(e) => onAssign(speaker.topicId, speaker.speakerTag, e.target.value)}
            inputProps={{ 'aria-label': 'Assign speaker' }}
            sx={{ height: 36, fontSize: 13, bgcolor: 'white', borderRadius: '6px' }}
          >
            <MenuItem value="" disabled sx={{ fontSize: 13 }}>
              Assign to…
            </MenuItem>
            {teamMembers.map((m) => (
              <MenuItem key={m.id} value={m.id} sx={{ fontSize: 13 }}>
                {m.displayName}
              </MenuItem>
            ))}
          </Select>
        </Stack>
      ))}
    </Card>
  );
}

export type WrapUpScreenProps = {
  retroName: string;
  facilitatorId: string;
  topics: Topic[];
  topicSummaries: TopicSummary[];
  summaryUnavailableTopicIds: string[];
  actionItems: ActionItem[];
  teamMembers: { id: string; displayName: string }[];
  attendees: { id: string; displayName: string }[];
  additionalNotes: string;
  unmatchedSpeakers: UnmatchedSpeaker[] | null;
  isFacilitator: boolean;
  canEditActionItems: boolean;
  phaseChangePending: boolean;
  phaseDeadline: string | null;
  clockOffsetMs: number;
  onExtend: (minutes: 1 | 2 | 5) => void;
  onBack: (() => void) | null;
  onComplete: () => void;
  onSaveSummary: (topicId: string, keyPoints: TopicSummaryPoint[], decisions: TopicSummaryPoint[], disagreements: TopicSummaryPoint[], proposedActionItems: TopicSummaryPoint[]) => void;
  onRegenerateSummary: (topicId: string) => void;
  onUpdateActionItem: (id: string, patch: { ownerId?: string | null; dueDate?: string | null }) => void;
  onCreateActionItem: (title: string) => void;
  onSaveNotes: (notes: string) => void;
  onAssignSpeaker: (topicId: string, speakerTag: number, userId: string) => void;
  /** Facilitator recording controls (Stop recording / Retry transcription). */
  extraControls?: ReactNode;
};

/** The Wrap up phase's dedicated screen (Figma 93:1706, "Edit mode" variant 96:817), replacing
 * the column board and Queue/Summaries panel for this phase. Topic summaries, action items and
 * additional notes on the left; attendance, undiscussed topics and action capture on the right. */
export function WrapUpScreen(props: WrapUpScreenProps) {
  const { topics, isFacilitator } = props;
  const byOrder = (a: Topic, b: Topic) => (a.discussionOrder ?? '').localeCompare(b.discussionOrder ?? '');
  const discussed = topics.filter((t) => t.startedAt).sort(byOrder);
  const notDiscussed = topics.filter((t) => !t.startedAt).sort(byOrder);
  const summaryFor = (topicId: string) => props.topicSummaries.find((s) => s.topicId === topicId) ?? null;
  const actionItems = [...props.actionItems].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <Box sx={{ fontFamily: 'Roboto, system-ui, sans-serif', color: TEXT, mx: -4, mb: -4 }}>
      <PhaseControlsBar
        title="Wrap up"
        isFacilitator={isFacilitator}
        phaseDeadline={props.phaseDeadline}
        clockOffsetMs={props.clockOffsetMs}
        phaseChangePending={props.phaseChangePending}
        onExtend={props.onExtend}
        onBack={props.onBack}
        onNext={null}
        nextLabel=""
        extraControls={props.extraControls}
        endControls={
          <PrimaryButton height={38} onClick={props.onComplete} disabled={props.phaseChangePending}>
            Complete retro
          </PrimaryButton>
        }
      />
      <Box sx={{ bgcolor: SURFACE, px: '40px', pt: '32px', pb: '40px' }}>
      {/* Figma "Recap content" */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 343px',
          gap: '24px',
          alignItems: 'start',
          containerType: 'inline-size',
          '@media (max-width: 1100px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
        }}
      >
        <Stack spacing="24px" sx={{ minWidth: 0, containerType: 'inline-size' }}>
          <TopicSummaries
            topics={discussed}
            summaryFor={summaryFor}
            unavailableIds={props.summaryUnavailableTopicIds}
            canManage={isFacilitator}
            onSave={props.onSaveSummary}
            onRegenerate={props.onRegenerateSummary}
          />
          <ActionItemsSection items={actionItems} teamMembers={props.teamMembers} canEdit={props.canEditActionItems} onUpdate={props.onUpdateActionItem} />
          <AdditionalNotes notes={props.additionalNotes} canEdit={isFacilitator} onSave={props.onSaveNotes} />
        </Stack>
        <Stack spacing="24px" sx={{ minWidth: 0 }}>
          <Attendance attendees={props.attendees} facilitatorId={props.facilitatorId} />
          <TopicsNotDiscussed topics={notDiscussed} />
          {props.canEditActionItems && <CaptureAction topicName={null} onSave={props.onCreateActionItem} />}
          {isFacilitator && props.unmatchedSpeakers && props.unmatchedSpeakers.length > 0 && (
            <WhoIsThis speakers={props.unmatchedSpeakers} teamMembers={props.teamMembers} onAssign={props.onAssignSpeaker} />
          )}
        </Stack>
      </Box>
      </Box>
    </Box>
  );
}


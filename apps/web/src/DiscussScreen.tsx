import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { generateKeyBetween } from 'fractional-indexing';
import type { ActionItem, BoardCard, BoardColumn, Topic, TopicSummary, TopicSummaryPoint, TranscriptSegment, VisibleBoardCard } from '@retronoodle/shared';
import { Box, Button, Menu, MenuItem, Skeleton, Stack, Typography } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { formatCountdown, remainingMs } from './clock';
import { colorForId, columnPalette, initialsFor } from './palette';

/** Display name the Figma design gives the app's AI assistant ("Ziti's Questions", "Proposed by
 * Ziti"). Only a label — the agents themselves are unchanged (.claude/agents/*). */
const AI_ASSISTANT_NAME = 'Ziti';

export const MAX_ACTION_ITEM_LENGTH = 500;

// Figma "Discuss · Transcript collapsed/expanded" (nodes 77:821 / 69:2772) tokens.
export const TEXT = '#171c2a';
export const TEXT_SECONDARY = '#626b7d';
export const TEXT_TERTIARY = '#9299a8';
export const BORDER = '#e3e5eb';
export const SURFACE = '#f8f9fb';
export const CHIP_BG = '#f1f3f6';
export const PRIMARY = '#365cf5';
export const PRIMARY_BORDER = '#bfcbff';
export const PRIMARY_TINT = '#edf1ff';
export const PRIMARY_CHIP_BG = '#f2f4ff';
export const SUCCESS_TEXT = '#32824d';

/** The design's category chips (Start/Stop/Continue) use softer tints than the board's column
 * accents; keyed by the same `column.color` names as columnPalette. Unknown colors fall back to
 * the column accent on a light wash of itself. */
const CATEGORY_CHIP: Record<string, { text: string; bg: string }> = {
  green: { text: '#46a451', bg: '#edf8ef' },
  pink: { text: '#dc3654', bg: '#fceef1' },
  yellow: { text: '#c58e26', bg: '#fcf6e8' },
};

function categoryChipColors(colorName: string): { text: string; bg: string } {
  const known = CATEGORY_CHIP[colorName];
  if (known) return known;
  const accent = columnPalette(colorName).accent;
  return { text: accent, bg: `color-mix(in srgb, ${accent} 10%, white)` };
}

export function topicLabel(topic: Topic): string {
  return topic.groupSummaryTitle || topic.name || 'Untitled group';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function Icon({ name, size }: { name: string; size: number }) {
  return <Box component="img" src={`/icons/${name}.svg`} alt="" sx={{ width: size, height: size, flexShrink: 0, display: 'block' }} />;
}

export function CategoryChip({ column }: { column: BoardColumn | undefined }) {
  if (!column) return null;
  const { text, bg } = categoryChipColors(column.color);
  return (
    <Stack direction="row" spacing="6px" sx={{ alignItems: 'center', bgcolor: bg, borderRadius: '6px', px: 1, py: 0.5, flexShrink: 0 }}>
      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: text }} />
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: text, lineHeight: 'normal' }}>{column.title}</Typography>
    </Stack>
  );
}

export function PersonAvatar({ id, name }: { id: string | null; name: string }) {
  return (
    <Box
      sx={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        flexShrink: 0,
        bgcolor: id ? colorForId(id) : TEXT_TERTIARY,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Typography sx={{ fontSize: 10, fontWeight: 600, color: 'white', lineHeight: 1 }}>{id ? initialsFor(name) : '?'}</Typography>
    </Box>
  );
}

export function OutlinedButton({ icon, children, onClick, disabled }: { icon?: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      startIcon={icon ? <Icon name={icon} size={16} /> : undefined}
      sx={{
        height: 40,
        px: '14px',
        bgcolor: 'white',
        border: `1px solid ${BORDER}`,
        borderRadius: '6px',
        color: TEXT,
        fontSize: 13,
        fontWeight: 500,
        textTransform: 'none',
        '& .MuiButton-startIcon': { mr: 1, ml: 0 },
      }}
    >
      {children}
    </Button>
  );
}

export function PrimaryButton({
  icon,
  children,
  onClick,
  disabled,
  height = 40,
  fullWidth,
  fontSize = 13,
}: {
  icon?: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  height?: number;
  fullWidth?: boolean;
  fontSize?: number;
}) {
  return (
    <Button
      type="button"
      variant="contained"
      onClick={onClick}
      disabled={disabled}
      fullWidth={fullWidth}
      startIcon={icon ? <Icon name={icon} size={icon === 'plus-white' ? 17 : 16} /> : undefined}
      sx={{
        height,
        px: '14px',
        bgcolor: PRIMARY,
        borderRadius: '6px',
        fontSize,
        fontWeight: 500,
        textTransform: 'none',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        '&:hover': { bgcolor: '#2a4bd9' },
        '& .MuiButton-startIcon': { mr: 1, ml: 0 },
      }}
    >
      {children}
    </Button>
  );
}

export function SecondaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      sx={{ height: 40, px: '14px', bgcolor: SURFACE, borderRadius: '6px', color: TEXT, fontSize: 13, fontWeight: 500, textTransform: 'none' }}
    >
      {children}
    </Button>
  );
}

export function Panel({ children, p = '20px', gap = '20px' }: { children: ReactNode; p?: string; gap?: string }) {
  return (
    <Stack sx={{ bgcolor: 'white', border: `1px solid ${BORDER}`, borderRadius: '14px', p, gap, width: '100%', boxSizing: 'border-box' }}>
      {children}
    </Stack>
  );
}

export function PanelHeading({ title, icon, aside }: { title: string; icon?: string; aside?: ReactNode }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
      <Typography sx={{ fontSize: 18, fontWeight: 600, color: TEXT }}>{title}</Typography>
      {icon && <Icon name={icon} size={19} />}
      {aside}
    </Stack>
  );
}

export function CountChip({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ bgcolor: PRIMARY_CHIP_BG, borderRadius: 999, px: 1, py: 0.5 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: PRIMARY, lineHeight: 'normal' }}>{children}</Typography>
    </Box>
  );
}

/** Same countdown as the board header's PhaseTimer (RN-012), restyled as the design's "Topic
 * timer" box. There's no pause mutation, so the design's pause icon is left out; the facilitator
 * keeps the header's +1/+2/+5 extend menu here instead, revealed the same way (hover or focus). */
export function DiscussTimer({
  phaseDeadline,
  clockOffsetMs,
  onExtend,
}: {
  phaseDeadline: string | null;
  clockOffsetMs: number;
  onExtend?: (minutes: 1 | 2 | 5) => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = remainingMs(phaseDeadline, clockOffsetMs, nowMs);
  if (remaining === null) return null;
  const isExpired = remaining <= 0;
  return (
    <Box
      sx={{
        position: 'relative',
        display: 'inline-flex',
        '&:hover .rn-extend, &:focus-within .rn-extend': { opacity: 1, pointerEvents: 'auto' },
      }}
    >
      <Stack
        direction="row"
        spacing="10px"
        tabIndex={onExtend ? 0 : undefined}
        aria-label={onExtend ? 'Phase timer, focus to extend' : undefined}
        sx={{
          alignItems: 'center',
          height: 38,
          px: 1.5,
          borderRadius: '6px',
          bgcolor: isExpired ? undefined : CHIP_BG,
          animation: isExpired ? 'rn-timer-flash 1s linear infinite' : undefined,
        }}
      >
        <Icon name="timer" size={17} />
        <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'inherit', fontVariantNumeric: 'tabular-nums' }}>{formatCountdown(remaining)}</Typography>
      </Stack>
      {onExtend && (
        <Stack
          className="rn-extend"
          spacing={0.5}
          sx={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            mt: 0.5,
            p: 0.5,
            bgcolor: 'background.paper',
            borderRadius: 1,
            boxShadow: 3,
            zIndex: 10,
            opacity: 0,
            pointerEvents: 'none',
          }}
        >
          {([1, 2, 5] as const).map((minutes) => (
            <Button
              key={minutes}
              size="small"
              type="button"
              aria-label={`Extend this phase by ${plural(minutes, 'minute')}`}
              onClick={(e) => {
                onExtend(minutes);
                if (e.detail > 0) e.currentTarget.blur();
              }}
              sx={{ whiteSpace: 'nowrap' }}
            >
              +{minutes} min
            </Button>
          ))}
        </Stack>
      )}
    </Box>
  );
}

/** Figma "Discussion controls": the title / timer / facilitator-controls bar at the top of every
 * phase screen. Everyone sees the title and timer; only the facilitator gets the extend menu,
 * Back and the forward button (named per phase by `nextLabel`). */
export function PhaseControlsBar({
  title,
  isFacilitator,
  phaseDeadline,
  clockOffsetMs,
  phaseChangePending,
  onExtend,
  onBack,
  onNext,
  nextLabel,
  extraControls,
  endControls,
}: {
  title: string;
  isFacilitator: boolean;
  phaseDeadline: string | null;
  clockOffsetMs: number;
  phaseChangePending: boolean;
  onExtend: (minutes: 1 | 2 | 5) => void;
  onBack: (() => void) | null;
  onNext: (() => void) | null;
  nextLabel: string;
  extraControls?: ReactNode;
  /** Facilitator-only controls after Back / the forward button (Wrap up's "Complete retro"). */
  endControls?: ReactNode;
}) {
  return (
    <Stack
      direction="row"
      sx={{
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 1.5,
        minHeight: 90,
        px: '28px',
        py: 1.5,
        boxSizing: 'border-box',
        bgcolor: 'white',
        borderTop: `1px solid ${BORDER}`,
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      <Typography sx={{ fontSize: 24, fontWeight: 600, color: TEXT }}>{title}</Typography>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        {isFacilitator && <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY }}>Facilitator controls</Typography>}
        <DiscussTimer phaseDeadline={phaseDeadline} clockOffsetMs={clockOffsetMs} onExtend={isFacilitator ? onExtend : undefined} />
        {isFacilitator && extraControls}
        {isFacilitator && onBack && (
          <OutlinedButton icon="arrow-left" onClick={onBack} disabled={phaseChangePending}>
            Back
          </OutlinedButton>
        )}
        {isFacilitator && onNext && (
          <OutlinedButton icon="arrow-right" onClick={onNext} disabled={phaseChangePending}>
            {nextLabel}
          </OutlinedButton>
        )}
        {isFacilitator && endControls}
      </Stack>
    </Stack>
  );
}

/** One topic card in the left "Topic queue" column. */
function QueueTopicCard({
  topic,
  column,
  status,
  cardCount,
  previewBodies,
  footer,
  menu,
  dragHandle,
  onClick,
}: {
  topic: Topic;
  column: BoardColumn | undefined;
  status: 'current' | 'up_next' | 'queued' | 'done';
  cardCount: number;
  previewBodies: string[];
  footer?: ReactNode;
  menu?: ReactNode;
  dragHandle?: ReactNode;
  onClick?: () => void;
}) {
  const current = status === 'current';
  return (
    <Stack
      spacing="12px"
      onClick={onClick}
      sx={{
        width: '100%',
        boxSizing: 'border-box',
        p: '14px',
        borderRadius: '10px',
        border: `1px solid ${current ? PRIMARY_BORDER : BORDER}`,
        bgcolor: current ? PRIMARY_TINT : 'white',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
          {dragHandle}
          <CategoryChip column={column} />
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          {status === 'current' && <Typography sx={{ fontSize: 11, fontWeight: 500, color: PRIMARY }}>DISCUSSING</Typography>}
          {status === 'up_next' && <Typography sx={{ fontSize: 11, fontWeight: 500, color: TEXT_SECONDARY }}>UP NEXT</Typography>}
          {status === 'done' && <Icon name="circle-check" size={16} />}
          {menu}
        </Stack>
      </Stack>
      <Typography sx={{ fontSize: 15, fontWeight: 600, lineHeight: '21px', color: TEXT, overflowWrap: 'anywhere' }}>{topicLabel(topic)}</Typography>
      <Stack direction="row" spacing="6px" sx={{ alignItems: 'center' }}>
        <Icon name="thumbs-up-small" size={13} />
        <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY }}>
          {plural(topic.voteCount, 'vote')} · {plural(cardCount, 'card')}
        </Typography>
      </Stack>
      {!current && previewBodies.length > 0 && (
        <Box>
          {previewBodies.map((body, i) => (
            <Typography
              key={i}
              sx={{ fontSize: 12, lineHeight: '18px', color: TEXT_SECONDARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {body}
            </Typography>
          ))}
        </Box>
      )}
      {footer}
    </Stack>
  );
}

/** Facilitator-only "⋯" menu on a queue card — RN-019's Skip/Remove (and jump) for topics that
 * haven't started, which the design's cards have no visible buttons for. */
function QueueCardMenu({ label, items }: { label: string; items: { label: string; onSelect: () => void; danger?: boolean }[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Box
        component="button"
        type="button"
        aria-label={`Options for ${label}`}
        onClick={(e: MouseEvent<HTMLElement>) => {
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
        sx={{ border: 0, bgcolor: 'transparent', p: 0, cursor: 'pointer', display: 'flex' }}
      >
        <Icon name="ellipsis" size={18} />
      </Box>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)} onClick={(e) => e.stopPropagation()}>
        {items.map((item) => (
          <MenuItem
            key={item.label}
            onClick={() => {
              setAnchor(null);
              item.onSelect();
            }}
            sx={{ fontSize: 13, color: item.danger ? 'error.main' : undefined }}
          >
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function SortableUpNextCard(props: Omit<Parameters<typeof QueueTopicCard>[0], 'dragHandle'> & { canManage: boolean }) {
  const { canManage, ...cardProps } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.topic.id, disabled: !canManage });
  return (
    <Box ref={setNodeRef} sx={{ width: '100%', transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}>
      <QueueTopicCard
        {...cardProps}
        dragHandle={
          canManage ? (
            <Box
              component="span"
              {...attributes}
              {...listeners}
              onClick={(e: MouseEvent) => e.stopPropagation()}
              aria-label={`Reorder ${topicLabel(props.topic)}`}
              sx={{ cursor: 'grab', color: TEXT_TERTIARY, display: 'flex', ml: '-4px' }}
            >
              <DragIndicatorIcon sx={{ fontSize: 16 }} />
            </Box>
          ) : undefined
        }
      />
    </Box>
  );
}

/** Notes for the current topic (RN-020). Same 800ms debounce as the board's NotesEditor; mounted
 * with `key={topicId}` so a topic change starts from that topic's own notes. */
function TopicNotes({ topicId, initialBody, canEdit, onSave }: { topicId: string; initialBody: string; canEdit: boolean; onSave: (topicId: string, body: string) => void }) {
  const [draft, setDraft] = useState(initialBody);
  const lastSavedRef = useRef(initialBody);
  useEffect(() => {
    if (draft === lastSavedRef.current) return;
    const timeout = setTimeout(() => {
      lastSavedRef.current = draft;
      onSave(topicId, draft);
    }, 800);
    return () => clearTimeout(timeout);
  }, [draft, topicId, onSave]);

  if (!canEdit) {
    return draft ? <Typography sx={{ fontSize: 14, lineHeight: '21px', color: TEXT, whiteSpace: 'pre-wrap' }}>{draft}</Typography> : null;
  }
  return (
    <Box
      component="textarea"
      value={draft}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
      placeholder="Type Notes..."
      aria-label="Topic notes"
      maxLength={4000}
      sx={{
        width: '100%',
        boxSizing: 'border-box',
        minHeight: 126,
        p: '12px',
        border: `1px solid ${PRIMARY_BORDER}`,
        borderRadius: '6px',
        font: 'inherit',
        fontSize: 14,
        lineHeight: 1.4,
        color: TEXT,
        resize: 'vertical',
        '&::placeholder': { color: 'black', fontSize: 12 },
        '&:focus': { outline: `2px solid ${PRIMARY}`, outlineOffset: -1 },
      }}
    />
  );
}

function formatRelative(iso: string, nowMs: number): string {
  const minutes = Math.floor((nowMs - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function CreatedActionItems({
  items,
  topicName,
  ownerName,
  showSavedChip,
}: {
  items: ActionItem[];
  topicName: string;
  ownerName: (ownerId: string | null) => string;
  showSavedChip: boolean;
}) {
  // Ticks so "Just now" / "N min ago" stay current without a re-render from elsewhere.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <Panel gap="16px">
      <PanelHeading title="Created action items" aside={<CountChip>{items.length} created</CountChip>} />
      <Typography sx={{ fontSize: 13, lineHeight: '19px', color: TEXT_SECONDARY }}>Saved actions from this discussion.</Typography>
      {items.length > 0 && (
        <Stack spacing="12px">
          {items.map((item) => (
            <Stack key={item.id} spacing="10px" sx={{ border: `1px solid ${BORDER}`, borderRadius: '8px', p: '12px' }}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <PersonAvatar id={item.ownerId} name={ownerName(item.ownerId)} />
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: TEXT }}>{ownerName(item.ownerId)}</Typography>
                </Stack>
                {showSavedChip && <CountChip>Saved</CountChip>}
              </Stack>
              <Typography sx={{ fontSize: 14, fontWeight: 500, lineHeight: '21px', color: TEXT, overflowWrap: 'anywhere' }}>{item.title}</Typography>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', fontSize: 12, color: TEXT_SECONDARY }}>
                <Typography sx={{ fontSize: 12, lineHeight: '17px', color: TEXT_SECONDARY, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Linked to {topicName}
                </Typography>
                <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY, flexShrink: 0 }}>{formatRelative(item.createdAt, nowMs)}</Typography>
              </Stack>
            </Stack>
          ))}
        </Stack>
      )}
    </Panel>
  );
}

/** "Capture an action" (Figma 77:1001 / 87:1698 / 98:1877). `topicName` is null on the Wrap up
 * screen, where new items aren't tied to a topic — the "Linked to" line is left out there. */
export function CaptureAction({ topicName, onSave }: { topicName: string | null; onSave: (title: string) => void }) {
  const [draft, setDraft] = useState('');
  const trimmed = draft.trim();
  return (
    <Panel>
      <Stack spacing={1}>
        <PanelHeading title="Capture an action" icon="list-checks-blue" />
        <Typography sx={{ fontSize: 13, lineHeight: '19px', color: TEXT_SECONDARY }}>Turn this discussion into a clear next step.</Typography>
      </Stack>
      <Stack spacing={1}>
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Typography component="label" htmlFor="rn-capture-action" sx={{ fontSize: 13, fontWeight: 500, color: TEXT }}>
            Action item
          </Typography>
          <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY }}>Draft</Typography>
        </Stack>
        <Box
          component="textarea"
          id="rn-capture-action"
          value={draft}
          maxLength={MAX_ACTION_ITEM_LENGTH}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
          sx={{
            width: '100%',
            boxSizing: 'border-box',
            minHeight: 126,
            p: '12px',
            border: `1px solid ${PRIMARY_BORDER}`,
            borderRadius: '6px',
            font: 'inherit',
            fontSize: 14,
            lineHeight: '21px',
            color: TEXT,
            resize: 'vertical',
            '&:focus': { outline: `2px solid ${PRIMARY}`, outlineOffset: -1 },
          }}
        />
      </Stack>
      {topicName && (
        <Stack direction="row" spacing="6px" sx={{ alignItems: 'flex-start' }}>
          <Icon name="link" size={14} />
          <Typography sx={{ fontSize: 12, lineHeight: '17px', color: TEXT_SECONDARY }}>Linked to {topicName}</Typography>
        </Stack>
      )}
      <PrimaryButton
        icon="plus-white"
        height={42}
        fontSize={14}
        fullWidth
        disabled={!trimmed}
        onClick={() => {
          onSave(trimmed);
          setDraft('');
        }}
      >
        Save action
      </PrimaryButton>
    </Panel>
  );
}

function ProposedActions({
  proposals,
  pending,
  isSaved,
  canSave,
  onSave,
}: {
  proposals: TopicSummaryPoint[];
  pending: boolean;
  isSaved: (text: string) => boolean;
  canSave: boolean;
  onSave: (text: string) => void;
}) {
  return (
    <Panel>
      <Stack spacing={1}>
        <PanelHeading title={`${AI_ASSISTANT_NAME}'s Proposed Actions`} icon="list-checks-blue" />
        <Typography sx={{ fontSize: 13, lineHeight: '19px', color: TEXT_SECONDARY }}>
          These proposals are derived from the discussion and source cards. They are not yet saved as official action items.
        </Typography>
      </Stack>
      {pending ? (
        <Stack spacing={1} aria-busy="true">
          <Skeleton variant="rounded" height={56} />
          <Skeleton variant="rounded" height={56} />
        </Stack>
      ) : proposals.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: TEXT_TERTIARY }}>No proposed actions for this topic.</Typography>
      ) : (
        <Stack spacing="12px">
          {proposals.map((p, i) => (
            <Stack key={i} direction="row" spacing="10px" sx={{ alignItems: 'center', bgcolor: SURFACE, borderRadius: '8px', p: '12px' }}>
              <Stack spacing="2px" sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: TEXT, overflowWrap: 'anywhere' }}>{p.text}</Typography>
                <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY }}>Proposed by {AI_ASSISTANT_NAME}</Typography>
              </Stack>
              {isSaved(p.text) ? (
                <CountChip>Saved</CountChip>
              ) : (
                canSave && (
                  <PrimaryButton height={32} fontSize={12} onClick={() => onSave(p.text)}>
                    Save as Action
                  </PrimaryButton>
                )
              )}
            </Stack>
          ))}
        </Stack>
      )}
    </Panel>
  );
}

function TopicHeader({ index, total, topic, column }: { index: number; total: number; topic: Topic; column: BoardColumn | undefined }) {
  return (
    <>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing="10px" sx={{ alignItems: 'center' }}>
          <Typography sx={{ fontSize: 12, fontWeight: 500, color: TEXT_SECONDARY, letterSpacing: '0.48px' }}>
            TOPIC {index} OF {total}
          </Typography>
          <CategoryChip column={column} />
        </Stack>
        <Stack direction="row" spacing="6px" sx={{ alignItems: 'center' }}>
          <Icon name="thumbs-up" size={15} />
          <Typography sx={{ fontSize: 13, color: TEXT_SECONDARY }}>{plural(topic.voteCount, 'vote')}</Typography>
        </Stack>
      </Stack>
      <Typography component="h2" sx={{ fontSize: 30, fontWeight: 600, lineHeight: '36px', letterSpacing: '-0.45px', color: TEXT, overflowWrap: 'anywhere' }}>
        {topicLabel(topic)}
      </Typography>
    </>
  );
}

export type DiscussScreenProps = {
  topics: Topic[];
  columns: BoardColumn[];
  cards: BoardCard[];
  cardCountByTopic: Map<string, number>;
  topicSummaries: TopicSummary[];
  summaryUnavailableTopicIds: string[];
  actionItems: ActionItem[];
  teamMembers: { id: string; displayName: string }[];
  isFacilitator: boolean;
  canEditNotes: boolean;
  canEditActionItems: boolean;
  phaseDeadline: string | null;
  clockOffsetMs: number;
  phaseChangePending: boolean;
  onExtend: (minutes: 1 | 2 | 5) => void;
  onBack: (() => void) | null;
  onGoToWrapUp: () => void;
  onNextTopic: () => void;
  onFinish: () => void;
  onJump: (topicId: string) => void;
  onReorder: (topicId: string, discussionOrder: string) => void;
  onSkipTopic: (topicId: string) => void;
  onRemoveTopic: (topicId: string) => void;
  onNotesChange: (topicId: string, body: string) => void;
  onSummarize: (topicId: string) => void;
  onCreateActionItem: (title: string, topicId: string, origin: 'ai' | 'manual') => void;
  renderCard: (card: VisibleBoardCard) => ReactNode;
  renderSummaryPoints: (points: TopicSummaryPoint[]) => ReactNode;
  /** Facilitator recording controls (Stop recording / Retry transcription), shown in the
   * Discussion controls bar. */
  extraControls?: ReactNode;
};

/** The Discuss phase's dedicated screen (Figma 77:821 "Transcript collapsed" / 69:2772
 * "Transcript expanded"), replacing the column board for this phase only. Topic queue on the
 * left, the current topic in the center, action capture on the right.
 *
 * The center has two views of the current topic: "discussing" (questions, cards, notes) and
 * "summary" (the AI summary plus proposed actions). The facilitator's "Summarize Topic" asks for
 * a summary of the still-open topic through the existing topic.regenerateSummary mutation; every
 * browser then switches to the summary view once a summary newer than the topic's start arrives.
 * "Back to discussion" is a per-browser choice and doesn't touch anyone else's view. */
export function DiscussScreen(props: DiscussScreenProps) {
  const {
    topics,
    columns,
    cards,
    cardCountByTopic,
    topicSummaries,
    summaryUnavailableTopicIds,
    actionItems,
    teamMembers,
    isFacilitator,
  } = props;

  const columnById = new Map(columns.map((c) => [c.id, c]));
  const visibleCards = cards.filter((c): c is VisibleBoardCard => !c.hidden);
  const cardsByTopic = new Map<string, VisibleBoardCard[]>();
  for (const card of visibleCards) {
    if (!card.topicId) continue;
    const list = cardsByTopic.get(card.topicId) ?? [];
    list.push(card);
    cardsByTopic.set(card.topicId, list);
  }
  for (const list of cardsByTopic.values()) list.sort((a, b) => a.position.localeCompare(b.position));

  const byOrder = (a: Topic, b: Topic) => (a.discussionOrder ?? '').localeCompare(b.discussionOrder ?? '');
  const sortedTopics = [...topics].sort(byOrder);
  const current = topics.find((t) => t.startedAt && !t.endedAt) ?? null;
  const upNext = topics.filter((t) => !t.startedAt).sort(byOrder);
  const completed = topics.filter((t) => t.endedAt).sort((a, b) => (a.endedAt ?? '').localeCompare(b.endedAt ?? ''));
  const isLastTopic = upNext.length === 0;
  const progressPct = topics.length === 0 ? 0 : Math.round((completed.length / topics.length) * 100);

  const [completedOpen, setCompletedOpen] = useState(true);
  // Summary view bookkeeping, per browser. `requested` holds the summary version that existed when
  // this facilitator clicked Summarize, so "summarizing…" lasts until a newer version arrives —
  // compared by version rather than timestamp so browser clock skew can't confuse it.
  const [requested, setRequested] = useState<{ topicId: string; version: number } | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<Record<string, number>>({});

  // A single-card topic is named after its card, so repeating the card text under the title
  // adds nothing; groups show their first two cards like the design.
  const previewFor = (t: Topic) =>
    (cardsByTopic.get(t.id) ?? [])
      .map((c) => c.body)
      .filter((body) => body !== topicLabel(t))
      .slice(0, 2);
  const summaryFor = (topicId: string) => topicSummaries.find((s) => s.topicId === topicId) ?? null;
  const memberName = (id: string | null) => (id ? (teamMembers.find((m) => m.id === id)?.displayName ?? 'Former member') : 'Unassigned');
  const actionsFor = (topicId: string) =>
    actionItems.filter((a) => a.sourceTopicId === topicId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Same fractional-index reorder as DiscussQueuePanel (RN-019): only not-yet-started topics move.
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || over.id === active.id) return;
    const activeIndex = upNext.findIndex((t) => t.id === active.id);
    const overIndex = upNext.findIndex((t) => t.id === over.id);
    if (activeIndex === -1 || overIndex === -1) return;
    const reordered = arrayMove(upNext, activeIndex, overIndex);
    const newIndex = reordered.findIndex((t) => t.id === active.id);
    const prev = reordered[newIndex - 1];
    const next = reordered[newIndex + 1];
    props.onReorder(active.id as string, generateKeyBetween(prev?.discussionOrder ?? null, next?.discussionOrder ?? null));
  }

  const currentSummary = current ? summaryFor(current.id) : null;
  // A summary made while this topic is open — not one left over from an earlier pass, if the
  // topic was reopened (topic.setCurrent clears ended_at but keeps the old summary row).
  const liveSummary = current && currentSummary && current.startedAt && currentSummary.createdAt >= current.startedAt ? currentSummary : null;
  const pendingRequest = current && requested?.topicId === current.id && (currentSummary?.version ?? 0) <= requested.version;
  const summaryUnavailable = current ? summaryUnavailableTopicIds.includes(current.id) : false;
  const showSummaryView =
    current !== null && (pendingRequest || (liveSummary !== null && dismissedVersion[current.id] !== liveSummary.version));

  function summarize(topicId: string) {
    setRequested({ topicId, version: summaryFor(topicId)?.version ?? 0 });
    props.onSummarize(topicId);
  }

  function backToDiscussion() {
    if (!current) return;
    setRequested(null);
    if (liveSummary) setDismissedVersion((d) => ({ ...d, [current.id]: liveSummary.version }));
  }

  const currentIndex = current ? sortedTopics.findIndex((t) => t.id === current.id) + 1 : 0;
  const currentColumn = current ? columnById.get(current.columnId) : undefined;
  const currentCards = current ? (cardsByTopic.get(current.id) ?? []) : [];
  const currentActions = current ? actionsFor(current.id) : [];
  const proposals = liveSummary?.proposedActionItems ?? [];
  const isProposalSaved = (text: string) =>
    currentActions.some((a) => a.origin === 'ai' && a.title.trim().toLowerCase() === text.trim().toLowerCase());
  const allProposalsSaved = proposals.length > 0 && proposals.every((p) => isProposalSaved(p.text));
  const moveOn = isLastTopic ? props.onFinish : props.onNextTopic;

  return (
    <Box sx={{ fontFamily: 'Roboto, system-ui, sans-serif', color: TEXT, mx: -4, mb: -4 }}>
      <PhaseControlsBar
        title="Discussion"
        isFacilitator={isFacilitator}
        phaseDeadline={props.phaseDeadline}
        clockOffsetMs={props.clockOffsetMs}
        phaseChangePending={props.phaseChangePending}
        onExtend={props.onExtend}
        onBack={props.onBack}
        onNext={props.onGoToWrapUp}
        nextLabel="Go to wrap up"
        extraControls={props.extraControls}
      />

      {/* Figma "Guided workshop" */}
      <Box
        sx={{
          bgcolor: SURFACE,
          px: '28px',
          pt: '24px',
          pb: '28px',
          minHeight: 708,
          display: 'grid',
          gridTemplateColumns: '244px minmax(0, 1fr) 330px',
          gap: '20px',
          alignItems: 'start',
          containerType: 'inline-size',
          '@container (max-width: 1000px)': { gridTemplateColumns: '1fr' },
          '@media (max-width: 1100px)': { gridTemplateColumns: '1fr' },
        }}
      >
        {/* Topic queue */}
        <Stack spacing="18px" sx={{ minWidth: 0 }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 600, color: TEXT }}>Topic queue</Typography>
            <Box sx={{ bgcolor: CHIP_BG, borderRadius: 999, px: 1, py: '3px' }}>
              <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY, lineHeight: 'normal' }}>{topics.length}</Typography>
            </Box>
          </Stack>
          <Stack spacing="9px">
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY }}>
                {completed.length} of {plural(topics.length, 'topic')} discussed
              </Typography>
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: TEXT }}>{progressPct}%</Typography>
            </Stack>
            <Box
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Topics discussed"
              sx={{ height: 4, borderRadius: 999, bgcolor: BORDER, overflow: 'hidden' }}
            >
              <Box sx={{ height: 4, borderRadius: 999, bgcolor: PRIMARY, width: `${progressPct}%` }} />
            </Box>
          </Stack>

          <Stack spacing="10px">
            {current && (
              <QueueTopicCard
                topic={current}
                column={columnById.get(current.columnId)}
                status="current"
                cardCount={cardCountByTopic.get(current.id) ?? 0}
                previewBodies={[]}
              />
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={upNext.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                {upNext.map((t, i) => (
                  <SortableUpNextCard
                    key={t.id}
                    topic={t}
                    column={columnById.get(t.columnId)}
                    status={i === 0 ? 'up_next' : 'queued'}
                    cardCount={cardCountByTopic.get(t.id) ?? 0}
                    previewBodies={previewFor(t)}
                    canManage={isFacilitator}
                    menu={
                      isFacilitator ? (
                        <QueueCardMenu
                          label={topicLabel(t)}
                          items={[
                            { label: 'Discuss now', onSelect: () => props.onJump(t.id) },
                            { label: 'Skip', onSelect: () => props.onSkipTopic(t.id) },
                            { label: 'Remove', onSelect: () => props.onRemoveTopic(t.id), danger: true },
                          ]}
                        />
                      ) : undefined
                    }
                  />
                ))}
              </SortableContext>
            </DndContext>
          </Stack>

          {completed.length > 0 && (
            <>
              <Box
                component="button"
                type="button"
                aria-expanded={completedOpen}
                onClick={() => setCompletedOpen((v) => !v)}
                sx={{ display: 'flex', alignItems: 'center', gap: '7px', border: 0, bgcolor: 'transparent', p: 0, cursor: 'pointer', font: 'inherit' }}
              >
                <Box sx={{ display: 'flex', transform: completedOpen ? undefined : 'rotate(-90deg)', transition: 'transform 120ms' }}>
                  <Icon name="chevron-down" size={14} />
                </Box>
                <Typography sx={{ fontSize: 12, fontWeight: 500, color: TEXT_SECONDARY }}>COMPLETED</Typography>
              </Box>
              {completedOpen && (
                <Stack spacing="10px">
                  {completed.map((t) => {
                    const skipped = !t.startedAt;
                    const saved = actionsFor(t.id).length;
                    const summaryStatus = skipped
                      ? null
                      : summaryFor(t.id)
                        ? null
                        : summaryUnavailableTopicIds.includes(t.id)
                          ? 'Summary unavailable'
                          : 'Summarizing…';
                    return (
                      <QueueTopicCard
                        key={t.id}
                        topic={t}
                        column={columnById.get(t.columnId)}
                        status="done"
                        cardCount={cardCountByTopic.get(t.id) ?? 0}
                        previewBodies={previewFor(t)}
                        footer={
                          <Typography sx={{ fontSize: 12, color: skipped ? TEXT_TERTIARY : SUCCESS_TEXT }}>
                            {skipped ? 'Not discussed' : `Discussed · ${plural(saved, 'action')} saved`}
                            {summaryStatus && <Box component="span" sx={{ color: TEXT_SECONDARY }}> · {summaryStatus}</Box>}
                          </Typography>
                        }
                      />
                    );
                  })}
                </Stack>
              )}
            </>
          )}
          <Typography sx={{ fontSize: 12, lineHeight: '18px', color: TEXT_TERTIARY }}>Everyone follows the topic selected by the facilitator.</Typography>
        </Stack>

        {/* Active discussion */}
        <Stack
          sx={{
            minWidth: 0,
            minHeight: 708,
            boxSizing: 'border-box',
            bgcolor: 'white',
            border: `1px solid ${BORDER}`,
            borderRadius: '14px',
            p: '24px',
            justifyContent: 'space-between',
            gap: '20px',
          }}
        >
          {!current ? (
            <Stack spacing={2} sx={{ alignItems: 'center', justifyContent: 'center', flex: 1, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 18, fontWeight: 600, color: TEXT }}>
                {completed.length > 0 && upNext.length === 0 ? 'Every topic has been discussed.' : 'No topic is being discussed.'}
              </Typography>
              <Typography sx={{ fontSize: 13, color: TEXT_SECONDARY }}>
                {isFacilitator
                  ? upNext.length > 0
                    ? 'Start the next topic in the queue, or go to wrap up.'
                    : 'Go to wrap up when the team is ready.'
                  : 'Waiting for the facilitator.'}
              </Typography>
              {isFacilitator && upNext.length > 0 && <PrimaryButton icon="arrow-right-white" onClick={props.onNextTopic}>Start next topic</PrimaryButton>}
            </Stack>
          ) : showSummaryView ? (
            <>
              <Stack spacing="20px">
                <Stack spacing="16px">
                  <TopicHeader index={currentIndex} total={topics.length} topic={current} column={currentColumn} />
                  {summaryUnavailable ? (
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                      <Typography sx={{ fontSize: 14, color: TEXT_SECONDARY }}>Summary unavailable.</Typography>
                      {isFacilitator && <SecondaryButton onClick={() => summarize(current.id)}>Retry</SecondaryButton>}
                    </Stack>
                  ) : pendingRequest || !liveSummary ? (
                    <Stack spacing={1} aria-busy="true">
                      <Typography sx={{ fontSize: 14, color: TEXT_SECONDARY }}>{AI_ASSISTANT_NAME} is summarizing…</Typography>
                      <Skeleton variant="text" />
                      <Skeleton variant="text" />
                      <Skeleton variant="text" width="60%" />
                    </Stack>
                  ) : (
                    <Box sx={{ fontSize: 14, lineHeight: '21px', color: TEXT }}>
                      {props.renderSummaryPoints(liveSummary.keyPoints)}
                      {liveSummary.decisions.length > 0 && (
                        <>
                          <Typography sx={{ fontSize: 13, fontWeight: 500, color: TEXT, mt: 1.5, mb: 0.5 }}>Decisions</Typography>
                          {props.renderSummaryPoints(liveSummary.decisions)}
                        </>
                      )}
                      {liveSummary.disagreements.length > 0 && (
                        <>
                          <Typography sx={{ fontSize: 13, fontWeight: 500, color: TEXT, mt: 1.5, mb: 0.5 }}>Disagreements</Typography>
                          {props.renderSummaryPoints(liveSummary.disagreements)}
                        </>
                      )}
                    </Box>
                  )}
                </Stack>
                <Stack spacing="12px">
                  <Typography sx={{ fontSize: 15, fontWeight: 600, color: TEXT }}>Action Items</Typography>
                  {currentActions.length === 0 ? (
                    <Typography sx={{ fontSize: 13, color: TEXT_TERTIARY }}>No action items saved for this topic yet.</Typography>
                  ) : (
                    <Stack spacing="10px">
                      {currentActions.map((item) => (
                        <Stack key={item.id} direction="row" spacing="10px" sx={{ alignItems: 'center', bgcolor: SURFACE, borderRadius: '8px', p: '12px' }}>
                          <PersonAvatar id={item.ownerId} name={memberName(item.ownerId)} />
                          <Stack spacing="2px" sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontSize: 13, fontWeight: 500, color: TEXT, overflowWrap: 'anywhere' }}>{item.title}</Typography>
                            <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY }}>
                              {item.ownerId ? `Assigned to ${memberName(item.ownerId)}` : 'Unassigned'}
                            </Typography>
                          </Stack>
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Stack>
              <Stack spacing={2} sx={{ pt: 3, borderTop: `1px solid ${BORDER}` }}>
                <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <SecondaryButton onClick={backToDiscussion}>Back to discussion</SecondaryButton>
                  {isFacilitator && (
                    <PrimaryButton icon="arrow-right-white" onClick={moveOn}>
                      {isLastTopic ? 'Finish discussion' : 'Next Topic'}
                    </PrimaryButton>
                  )}
                </Stack>
                <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY, textAlign: 'right' }}>
                  {allProposalsSaved ? 'All actions for this topic have been saved.' : 'Save any actions before moving on.'}
                </Typography>
              </Stack>
            </>
          ) : (
            <>
              <Stack spacing="20px">
                <Stack spacing="14px">
                  <TopicHeader index={currentIndex} total={topics.length} topic={current} column={currentColumn} />
                  {current.groupSummary && (
                    <Typography sx={{ fontSize: 14, lineHeight: '21px', color: 'black', maxWidth: 560, whiteSpace: 'pre-wrap' }}>{current.groupSummary}</Typography>
                  )}
                </Stack>
                {current.discussionQuestions && current.discussionQuestions.length > 0 && (
                  <Stack spacing="14px">
                    <Typography sx={{ fontSize: 15, fontWeight: 600, color: TEXT }}>{AI_ASSISTANT_NAME}’s Questions</Typography>
                    <Box sx={{ bgcolor: SURFACE, borderRadius: '10px', p: 2 }}>
                      <Box component="ul" sx={{ m: 0, pl: '21px' }}>
                        {current.discussionQuestions.map((q, i) => (
                          <Typography component="li" key={i} sx={{ fontSize: 14, lineHeight: '21px', color: TEXT }}>
                            {q}
                          </Typography>
                        ))}
                      </Box>
                    </Box>
                  </Stack>
                )}
                <Stack spacing="12px">
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: TEXT }}>What the team shared</Typography>
                    <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY }}>{plural(currentCards.length, 'card')}</Typography>
                  </Stack>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 2, '& > *': { mb: '0 !important', height: '100%', boxSizing: 'border-box' } }}>
                    {currentCards.map((card) => (
                      <Box key={card.id} sx={{ minHeight: 164, display: 'flex', flexDirection: 'column', '& > *': { flex: 1 } }}>
                        {props.renderCard(card)}
                      </Box>
                    ))}
                  </Box>
                </Stack>
                <TopicNotes key={current.id} topicId={current.id} initialBody={current.notes} canEdit={props.canEditNotes} onSave={props.onNotesChange} />
              </Stack>
              {isFacilitator && (
                <Stack spacing={2} sx={{ pt: 3, borderTop: `1px solid ${BORDER}` }}>
                  <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                    <SecondaryButton onClick={moveOn}>{isLastTopic ? 'Finish discussion' : 'Skip topic'}</SecondaryButton>
                    <PrimaryButton icon="arrow-right-white" onClick={() => summarize(current.id)}>
                      Summarize Topic
                    </PrimaryButton>
                  </Stack>
                  <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY, textAlign: 'right' }}>Save any actions before moving on.</Typography>
                </Stack>
              )}
            </>
          )}
        </Stack>

        {/* Action capture */}
        <Stack spacing="20px" sx={{ minWidth: 0 }}>
          {current && showSummaryView && (
            <ProposedActions
              proposals={proposals}
              pending={!summaryUnavailable && (Boolean(pendingRequest) || !liveSummary)}
              isSaved={isProposalSaved}
              canSave={props.canEditActionItems}
              onSave={(text) => props.onCreateActionItem(text, current.id, 'ai')}
            />
          )}
          {/* Both views offer Capture an action (Figma 77:1001 / 87:1698). In the summary view
              (73:1519) it replaces Created action items — the center's Action Items list already
              shows those there. */}
          {current && props.canEditActionItems && (
            <CaptureAction key={current.id} topicName={topicLabel(current)} onSave={(title) => props.onCreateActionItem(title, current.id, 'manual')} />
          )}
          {current && !showSummaryView && (
            <CreatedActionItems items={currentActions} topicName={topicLabel(current)} ownerName={memberName} showSavedChip />
          )}
        </Stack>
      </Box>
    </Box>
  );
}

function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Figma "Sidebar Transcript" (76:818) and "Transcript · Collapsed rail" (77:1041): the live
 * transcript (RN-033) in AppShell's right-panel slot during Discuss. Speakers resolve through
 * the team member list once matched (RN-036); before that they show as "Speaker N". */
export function TranscriptPanel({
  segments,
  teamMembers,
  open,
  onToggleOpen,
}: {
  segments: TranscriptSegment[];
  teamMembers: { id: string; displayName: string }[];
  open: boolean;
  onToggleOpen: () => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments.length, open]);

  if (!open) {
    return (
      <Stack
        sx={{
          width: 56,
          flexShrink: 0,
          height: '100%',
          boxSizing: 'border-box',
          bgcolor: 'white',
          borderLeft: `1px solid ${BORDER}`,
          alignItems: 'center',
          gap: '20px',
          px: 1,
          py: 3,
          fontFamily: 'Roboto, system-ui, sans-serif',
        }}
      >
        <Box
          component="button"
          type="button"
          onClick={onToggleOpen}
          aria-label="Expand transcript"
          sx={{
            width: 36,
            height: 36,
            borderRadius: '6px',
            border: 0,
            bgcolor: CHIP_BG,
            color: '#616b7d',
            fontSize: 22,
            fontWeight: 500,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ‹
        </Box>
        <Icon name="file-text" size={16} />
        <Typography sx={{ fontSize: 10, fontWeight: 500, color: '#616b7d' }}>Open</Typography>
      </Stack>
    );
  }

  const speakerName = (s: TranscriptSegment) =>
    s.speakerUserId
      ? (teamMembers.find((m) => m.id === s.speakerUserId)?.displayName ?? 'Former member')
      : s.speakerTag !== null
        ? `Speaker ${s.speakerTag + 1}`
        : 'Unknown speaker';

  return (
    <Stack
      sx={{
        width: 360,
        flexShrink: 0,
        height: '100%',
        boxSizing: 'border-box',
        bgcolor: 'white',
        borderLeft: `1px solid ${BORDER}`,
        p: 3,
        gap: 2,
        fontFamily: 'Roboto, system-ui, sans-serif',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: CHIP_BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="file-text" size={16} />
          </Box>
          <Stack spacing="2px">
            <Typography sx={{ fontSize: 16, fontWeight: 600, color: TEXT }}>Transcript</Typography>
            <Typography sx={{ fontSize: 12, color: TEXT_SECONDARY }}>Live discussion log</Typography>
          </Stack>
        </Stack>
        <Box
          component="button"
          type="button"
          onClick={onToggleOpen}
          aria-label="Collapse transcript"
          sx={{
            width: 36,
            height: 36,
            borderRadius: '6px',
            border: 0,
            bgcolor: CHIP_BG,
            color: '#616b7d',
            fontSize: 22,
            fontWeight: 500,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ›
        </Box>
      </Stack>
      <Stack ref={listRef} spacing="12px" sx={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {segments.length === 0 && <Typography sx={{ fontSize: 13, color: TEXT_TERTIARY }}>Nothing transcribed yet.</Typography>}
        {segments.map((s) =>
          s.isGapMarker ? (
            <Typography key={s.id} sx={{ fontSize: 12, fontStyle: 'italic', color: TEXT_TERTIARY }}>
              — gap in recording —
            </Typography>
          ) : (
            <Stack key={s.id} direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <PersonAvatar id={s.speakerUserId} name={speakerName(s)} />
              <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: TEXT }}>{speakerName(s)}</Typography>
                  <Typography sx={{ fontSize: 11, color: TEXT_TERTIARY, flexShrink: 0 }}>{formatClockTime(s.createdAt)}</Typography>
                </Stack>
                <Typography sx={{ fontSize: 13, lineHeight: '18px', color: '#374151', overflowWrap: 'anywhere' }}>{s.text}</Typography>
              </Stack>
            </Stack>
          ),
        )}
      </Stack>
    </Stack>
  );
}

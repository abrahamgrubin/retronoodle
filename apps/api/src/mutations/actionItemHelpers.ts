import type { ActionItem, ActionItemOrigin, ActionItemStatus } from '@retronoodle/shared';

export interface ActionItemRow {
  id: string;
  source_retro_id: string;
  source_topic_id: string | null;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  status: ActionItemStatus;
  origin: ActionItemOrigin;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function toActionItem(row: ActionItemRow): ActionItem {
  return {
    id: row.id,
    sourceRetroId: row.source_retro_id,
    sourceTopicId: row.source_topic_id,
    title: row.title,
    ownerId: row.owner_id,
    // due_date is a `date` column — node-postgres returns it as a Date already at local midnight,
    // but every other date-ish field on this type is a plain string, so keep this one a string too
    // (`YYYY-MM-DD`, sliced from the row by Postgres itself via `to_char` in the SELECT, not here).
    dueDate: row.due_date,
    status: row.status,
    origin: row.origin,
    completedAt: row.completed_at === null ? null : row.completed_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export const ACTION_ITEM_COLUMNS =
  "id, source_retro_id, source_topic_id, title, owner_id, to_char(due_date, 'YYYY-MM-DD') as due_date, status, origin, completed_at, created_at, updated_at";

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@retronoodle/shared';
import { estimateCostUsd } from '@retronoodle/shared';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // 'YYYY-MM', UTC
}

/**
 * RN-027: "Claude spend cap $5/month in config; on cap, AI features fall back silently." Checked
 * by every AI job alongside its existing "no API key" check — never blocks on a read failure
 * (`data` ends up `null`, read as $0 spent so far), since every call site already treats AI as
 * best-effort, never a reason to fail the job itself.
 */
export async function isOverMonthlyCap(supabaseAdmin: SupabaseClient<Database>, capUsd: number): Promise<boolean> {
  const { data } = await supabaseAdmin.from('ai_usage').select('total_cost_usd').eq('month', currentMonth()).maybeSingle();
  return (data ? Number(data.total_cost_usd) : 0) >= capUsd;
}

/**
 * Best-effort, not atomic (read, add, upsert) — a v0.1 app's AI job volume never collides within
 * the same instant, and a lost update here just means the cap is checked slightly conservatively
 * on the next call, never a reason to fail a job that already succeeded.
 */
export async function recordAiUsage(
  supabaseAdmin: SupabaseClient<Database>,
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const cost = estimateCostUsd(model, inputTokens, outputTokens);
  if (cost <= 0) return;
  const month = currentMonth();
  const { data: existing } = await supabaseAdmin.from('ai_usage').select('total_cost_usd').eq('month', month).maybeSingle();
  const total = (existing ? Number(existing.total_cost_usd) : 0) + cost;
  await supabaseAdmin.from('ai_usage').upsert({ month, total_cost_usd: total, updated_at: new Date().toISOString() });
}

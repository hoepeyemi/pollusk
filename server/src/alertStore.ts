/**
 * In-memory alert store for multi-step agent workflows.
 * Alerts are keyed by payer address; supports list and soft-cancel.
 * Persists alerts created via POST /alerts so the agent can list/cancel them.
 */

export interface StoredAlertRecord {
  id: string;
  asset: string;
  condition: string;
  targetPriceUsd: number;
  payer: string;
  createdAt: number;
}

const byPayer = new Map<string, StoredAlertRecord[]>();
const cancelledIds = new Set<string>();

function normalizeAddress(addr: string): string {
  return addr.toLowerCase();
}

export function addAlert(alert: StoredAlertRecord): void {
  const payer = normalizeAddress(alert.payer);
  let list = byPayer.get(payer);
  if (!list) {
    list = [];
    byPayer.set(payer, list);
  }
  list.push(alert);
}

export function getAlertsByPayer(payer: string): StoredAlertRecord[] {
  const list = byPayer.get(normalizeAddress(payer)) ?? [];
  return list.filter((a) => !cancelledIds.has(a.id));
}

/** All non-cancelled alerts (all payers). For scheduled agent / run-check. */
export function getAllAlerts(): StoredAlertRecord[] {
  const out: StoredAlertRecord[] = [];
  for (const list of byPayer.values()) {
    for (const a of list) {
      if (!cancelledIds.has(a.id)) out.push(a);
    }
  }
  return out;
}

export function getAlertById(id: string): StoredAlertRecord | undefined {
  for (const list of byPayer.values()) {
    const found = list.find((a) => a.id === id);
    if (found && !cancelledIds.has(found.id)) return found;
  }
  return undefined;
}

/** Get alert by payer and 1-based index (e.g. "the second one" -> index 2). */
export function getAlertByPayerAndIndex(payer: string, oneBasedIndex: number): StoredAlertRecord | undefined {
  const list = getAlertsByPayer(payer);
  const i = oneBasedIndex - 1;
  if (i < 0 || i >= list.length) return undefined;
  return list[i];
}

export function cancelAlert(alertId: string, payer: string): { ok: boolean; error?: string } {
  const a = getAlertById(alertId);
  if (!a) return { ok: false, error: "Alert not found" };
  if (normalizeAddress(a.payer) !== normalizeAddress(payer)) return { ok: false, error: "Alert does not belong to this payer" };
  cancelledIds.add(alertId);
  return { ok: true };
}

export function cancelAlertByIndex(payer: string, oneBasedIndex: number): { ok: boolean; error?: string } {
  const a = getAlertByPayerAndIndex(payer, oneBasedIndex);
  if (!a) return { ok: false, error: "No alert at that position" };
  cancelledIds.add(a.id);
  return { ok: true };
}

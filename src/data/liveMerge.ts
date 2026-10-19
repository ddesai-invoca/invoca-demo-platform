/* =============================================================================
   liveMerge — keep Ask AI edits on a page whose data keeps arriving (10/16/2026)
   -----------------------------------------------------------------------------
   An Ask AI edit is stored as the WHOLE edited page. That is fine for a page built
   once from the profile, and wrong for one fed by live captures (a lead created by
   the call just made, a conversation just captured): the stored copy would freeze
   the page and hide everything that arrived after the edit.

   So a LIVE page's override also carries the base it was made from (`LIVE_BASE`),
   and the page is a three-way merge of (that snapshot, the edit, the current base):
     • a value nobody edited follows the current base;
     • a value somebody edited keeps the edit;
     • in a list of identified items, a NEW item (in the current base, not in the
       snapshot) appears; an item the edit REMOVED (in the snapshot, not in the edit)
       stays removed; an item present in both is merged the same way, recursively.
   Pure and dependency-free so the audit can call it.
   ============================================================================= */

export const LIVE_BASE = "__liveBase";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The identity of a list item, or null when the list's items carry none. */
function idOf(v: unknown): string | null {
  if (!isObj(v)) return null;
  for (const k of ["id", "slug", "name", "callId", "key"]) {
    const x = v[k];
    if (typeof x === "string" && x) return `${k}:${x}`;
  }
  return null;
}

function keyed(list: unknown[]): Map<string, unknown> | null {
  const m = new Map<string, unknown>();
  for (const v of list) {
    const id = idOf(v);
    if (!id || m.has(id)) return null;
    m.set(id, v);
  }
  return m;
}

/** Three-way merge: `snap` is what the edit was made from, `edit` the edited value,
    `cur` what the page would show today with no edit at all. */
export function merge3(snap: unknown, edit: unknown, cur: unknown): unknown {
  if (same(edit, snap)) return cur;          // untouched: follow the live base
  if (Array.isArray(snap) && Array.isArray(edit) && Array.isArray(cur)) {
    const ms = keyed(snap), me = keyed(edit), mc = keyed(cur);
    if (!ms || !me || !mc) return edit;      // anonymous items: the edit wins whole
    const merged = edit.map((e) => {
      const id = idOf(e)!;
      return ms.has(id) && mc.has(id) ? merge3(ms.get(id), e, mc.get(id)) : e;
    });
    const fresh = cur.filter((c) => !ms.has(idOf(c)!) && !me.has(idOf(c)!));
    if (!fresh.length) return merged;
    // Live items arrive at the front of these lists (newest first); keep them there.
    const atFront = !ms.has(idOf(cur[0])!);
    return atFront ? [...fresh, ...merged] : [...merged, ...fresh];
  }
  if (isObj(snap) && isObj(edit) && isObj(cur)) {
    const out: Obj = {};
    for (const k of new Set([...Object.keys(edit), ...Object.keys(cur)])) {
      if (!(k in edit)) { if (!(k in snap)) out[k] = cur[k]; continue; } // removed by the edit
      out[k] = k in snap && k in cur ? merge3(snap[k], edit[k], cur[k]) : edit[k];
    }
    return out;
  }
  return edit;
}

/** The value a live page shows: the stored override merged over today's base. */
export function liveValue(override: unknown, base: unknown): unknown {
  /* ⚠️ A STORED OVERRIDE NEVER HIDES A FIELD IT DOES NOT HAVE. One written before a field existed
     (the Google Search key held only the Book online link `{ bookingUrl, thankYouUrl }` until the
     whole results page was registered under the same key) would otherwise replace the page with
     two strings. Edits cannot delete a key, so filling the missing ones from the base is safe. */
  if (!isObj(override) || !(LIVE_BASE in override)) return isObj(override) && isObj(base) ? { ...base, ...override } : override;
  const { [LIVE_BASE]: snap, ...edit } = override;
  return base == null ? edit : merge3(snap, edit, base);
}

/* =============================================================================
   audit-admin-notice.ts — the one-time "you're now an admin" popup
   -----------------------------------------------------------------------------
   ⚠️⚠️ **STANDALONE ON PURPOSE, AND IT WAS NOT AT FIRST.** A first version lived
   as a section inside audit-app.ts, isolated in a throwaway DATA_DIR the same way
   audit-events.ts does it — but audit-app.ts's own earlier "feedback" section
   already imports `engine/demoApi.ts`, which imports `demoStore.ts`, which
   resolves and CACHES its exported `DATA_DIR` constant at that import, before my
   section ever ran. Setting `process.env.DATA_DIR` afterward changed nothing:
   `adminNotices.ts` still read the FIRST resolved value. The test appeared to
   pass in isolation and, run after the rest of the file, silently wrote a real
   "seen" record into this machine's actual local `.data/admin-notices.json` —
   caught only by reading that file afterward and finding an entry nobody had
   asked to create. `audit-events.ts`'s own isolation trick only works because
   IT is the first and only thing in its process to import `demoStore.ts`; that
   is an ordering assumption a shared file like `audit-app.ts` cannot promise as
   more sections are added to it. A dedicated process removes the assumption
   rather than relying on import order forever holding.
   ============================================================================= */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail++; };
const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

console.log("\nAdmin notice\n");

const tmp = mkdtempSync(join(tmpdir(), "audit-admin-notice-"));
process.env.DATA_DIR = tmp;   // demoStore resolves DATA_DIR at module load — this
                              // is the FIRST import of it in this process.

const store = await import("../engine/demoStore.ts");
store.DATA_DIR === tmp
  ? ok("this test is isolated in a throwaway DATA_DIR")
  : bad(`DATA_DIR is ${store.DATA_DIR}, not the temp dir — this test would write to the real library`);

const { pendingAdminNotice, ackAdminNotice, reloadAdminNoticesForTest } =
  await import("../engine/adminNotices.ts");
const { isAdminEmail } = await import("../engine/admins.ts");

const NEW_ADMINS = [
  "ddubinsky@invoca.com", "bmccarty@invoca.com", "djuengst@invoca.com",
  "kjellick@invoca.com", "kpaklaian@invoca.com", "mfidler@invoca.com",
];

NEW_ADMINS.every((e) => isAdminEmail(e))
  ? ok("all six newly added addresses are project admins")
  : bad("at least one of the six new addresses is not recognised as an admin");

NEW_ADMINS.every((e) => pendingAdminNotice(e))
  ? ok("each of the six has a pending notice before dismissing it")
  : bad("at least one of the six shows no pending notice");

pendingAdminNotice("random.person@invoca.com")
  ? bad("an admin outside this announcement's list still got a notice")
  : ok("an admin who is NOT on this announcement's list gets no notice");

isAdminEmail("random.person@invoca.com")
  ? bad("the control address used above is somehow already an admin — pick a different one")
  : ok("the control address used above is genuinely not an admin");

ackAdminNotice(NEW_ADMINS[0]);
reloadAdminNoticesForTest();   // force a fresh read off disk, not the in-memory cache
(!pendingAdminNotice(NEW_ADMINS[0]) && pendingAdminNotice(NEW_ADMINS[1]))
  ? ok("dismissing one person's notice does not clear anyone else's")
  : bad("acknowledging one notice affected another person's, or did not persist");

ackAdminNotice(NEW_ADMINS[0]);   // a second ack must not throw or double-write
reloadAdminNoticesForTest();
!pendingAdminNotice(NEW_ADMINS[0])
  ? ok("acknowledging an already-seen notice is a harmless no-op")
  : bad("re-acknowledging a seen notice brought it back");

/* ⚠️ WIRING, NOT JUST THE PURE FUNCTIONS — a perfect store nobody's route calls is
   the silent no-op this repo keeps recording. Comments stripped first, the
   standing fix for a check that would otherwise fire on its own documentation. */
const api = code("engine/demoApi.ts");
(api.match(/adminNotice: pendingAdminNotice/g) || []).length >= 2
  ? ok("both /api/me and /api/demos report the pending notice")
  : bad("at least one of /api/me or /api/demos no longer reports it");
/p === "\/api\/admin-notice\/ack" && method === "POST"/.test(api)
  ? ok("a POST route exists to acknowledge it")
  : bad("no route acknowledges the notice, so it can never be dismissed");

const viteCfg = code("vite.config.ts");
/startsWith\('\/api\/admin-notice'\)/.test(viteCfg)
  ? ok("the dev server's route guard admits /api/admin-notice, not just /api/me and /api/demos")
  : bad("the dev twin's narrower prefix would silently 404 the ack route");

const ctx = code("src/data/DemoLibraryContext.tsx");
(/adminNotice/.test(ctx) && /dismissAdminNotice/.test(ctx))
  ? ok("the demo-library context exposes adminNotice and a way to dismiss it")
  : bad("the frontend context does not carry the notice through");

const modal = code("src/components/AdminNoticeModal.tsx");
(/useDemoLibrary/.test(modal) && /adminNotice/.test(modal))
  ? ok("the modal reads its visibility from the same context, not a route or localStorage")
  : bad("the modal does not key off the server-decided flag");

const app = code("src/App.tsx");
(/<AdminNoticeModal\s*\/>/.test(app) && /<EnvBadge\s*\/>/.test(app))
  ? ok("mounted beside EnvBadge — outside <Routes>, so no standalone screen misses it")
  : bad("AdminNoticeModal is not mounted where every route, including the standalone ones, can show it");

console.log(fail ? `\n${fail} check(s) failed\n` : "\nAll admin-notice checks passed\n");
process.exit(fail ? 1 : 0);

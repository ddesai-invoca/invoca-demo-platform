/* =============================================================================
   shareCodes — one 6-digit password per prospect email, reused forever
   -----------------------------------------------------------------------------
   Asked for 10/9/2026: *"generate a random 5 or 6 number password, and that password
   get associated to their email, so if they put that same password in again in the
   future then associate it to that email. if they enter their same email in again in
   the future then share that same number with them."*

   ⚠️⚠️ **WHAT THIS REPLACES, AND WHY IT IS BETTER.** The emailed password used to be the
   prospect's name with the spaces removed, which the unlock page prints in its own
   heading, so anybody holding the link could derive it. A random code per person cannot
   be derived, and because each code belongs to exactly one address, typing it TELLS us who
   opened the demo, even on a later visit that skips the email step.

   ⚠️⚠️ **STORED IN PLAIN TEXT, AND IT HAS TO BE.** "Share that same number with them"
   means the code must be readable to send again, so a hash would not do. It lives on the
   server disk (`DATA_DIR`, git-ignored, never served) and is a demo access code, not an
   account password. The 32-byte link token is still what keeps strangers out.

   ⚠️ **ONE CODE PER ADDRESS ACROSS EVERY LINK.** A person keeps the same number whichever
   demo they are sent. The token in the URL decides WHICH demo opens, so a code alone
   unlocks nothing. Codes are UNIQUE, which is what makes "this code means this person"
   true.

   ⚠️ **ONE JSON FILE, ATOMIC WRITE**, the same shape `eventSettings` uses. A handful of
   prospects a day is nowhere near the size that needs anything more.
   ============================================================================= */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./demoStore.ts";

const FILE = path.join(DATA_DIR, "share-codes.json");

interface CodeEntry { code: string; createdAt: string }
type CodeBook = Record<string, CodeEntry>;

function read(): CodeBook {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")) as CodeBook; } catch { return {}; }
}

function write(book: CodeBook) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(book, null, 2));
  fs.renameSync(tmp, FILE);
}

const norm = (email: string) => email.trim().toLowerCase();

/** A 6-digit code, never starting with 0 so it reads the same written down and typed. */
function freshCode(taken: Set<string>): string {
  for (let i = 0; i < 1000; i++) {
    const c = String(crypto.randomInt(100000, 1000000));
    if (!taken.has(c)) return c;
  }
  throw new Error("could not mint a unique share code");
}

/** This address's code: the one it already has, or a new one that nobody else holds. */
export function codeForEmail(email: string): string {
  const key = norm(email);
  const book = read();
  if (book[key]) return book[key].code;
  const code = freshCode(new Set(Object.values(book).map((e) => e.code)));
  book[key] = { code, createdAt: new Date().toISOString() };
  write(book);
  return code;
}

/** Who a code belongs to, or null. Spaces are ignored so "482 913" still matches. */
export function emailForCode(candidate: string): string | null {
  const code = (candidate ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  for (const [email, e] of Object.entries(read())) {
    /* Constant-time per entry, so a near miss takes as long as a far one. */
    if (e.code.length === code.length && crypto.timingSafeEqual(Buffer.from(e.code), Buffer.from(code))) return email;
  }
  return null;
}

/* ── the master password ──────────────────────────────────────────────────── */
/* ⚠️⚠️ **ONE PASSWORD EVERY INVOCA EMPLOYEE CAN USE, asked for by name ("invoca2026").**
   `SHARE_MASTER_PASSWORD` overrides it on the server, so it can be rotated on Render
   without a deploy, and it should be: this file is in the repository, so the default is
   readable by anyone who can read the repo. */
export const MASTER_WHO = "Invoca employee";
const master = () => process.env.SHARE_MASTER_PASSWORD?.trim() || "invoca2026";

export function isMasterPassword(candidate: string): boolean {
  /* Hashed first so the two buffers are always the same length for timingSafeEqual. */
  const a = crypto.createHash("sha256").update((candidate ?? "").trim()).digest();
  const b = crypto.createHash("sha256").update(master()).digest();
  return crypto.timingSafeEqual(a, b);
}

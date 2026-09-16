import { useCallback, useEffect, useState } from "react";
import { useAiAssistant } from "./AiAssistantContext";

/* =============================================================================
   "Book online" — the SE can point it anywhere (9/12/2026)
   -----------------------------------------------------------------------------
   Asked for straight after the booking-path table landed: *"when i right click on the book
   online it gives the user the option to enter the URL where they want the button to take
   them to when its click, so there will def be a default place it goes, but the user can
   also change it."*

   ⚠️⚠️ **THIS IS WHAT MAKES `bookingPath` A DEFAULT RATHER THAN A CEILING.** That table is
   hand-resolved and can only ever cover the prospects somebody has looked up; the platform
   generates new ones constantly, a booking page moves, and a regional franchise books
   somewhere the national site does not. Every one of those is an SE with the right URL in
   their clipboard and, until this, no way to use it. The table is still what an untouched
   demo uses — this is the escape hatch, not the mechanism.

   ⚠️⚠️ **AN OVERRIDE IS OPENED VERBATIM, AND THAT IS A DELIBERATE TRADE.** The default URL
   is wrapped in the whole tracking envelope (`oppref`, the utm set, `rwg_token`) because
   that is the demo's own point. An overridden one is NOT: the instruction was "take them to
   this URL", and the URL an SE pastes is very often a real booking link they copied
   complete with its own parameters (the real Roto-Rooter destination carries `zipCode` and
   `gad`). Silently rewriting a pasted link's query is how you break one — and appending our
   own beside theirs reads as a bug the moment they look at the address bar. **Consequence,
   stated: an overridden link carries no `oppref` unless the SE includes one.** The menu
   still shows the default underneath, so what was replaced is never hidden.

   ⚠️ **PER PROSPECT, PERSISTED, NO TTL** — the same shape and the same reasoning as
   [[locationOverride]]: keyed by profile id so one company's link cannot follow another,
   localStorage so it does not travel to a colleague (right for an SE re-pointing a screen
   for one conversation), and no expiry because a deliberate destination is a setting rather
   than a session artifact.

   ⚠️ **ONLY http AND https GET STORED.** The value is rendered straight into an `href`, so
   a `javascript:` URL would be script on our own origin. Cheap to refuse at the one place
   that writes the store, rather than trusting every future reader of it.
   ============================================================================= */

/* =============================================================================
   IT SAVES WITH THE DEMO NOW, NOT ONLY IN THIS BROWSER (9/15/2026)
   -----------------------------------------------------------------------------
   Asked for directly: *"it should always stay and save even when the users closes it and
   opens it the next day."*

   ⚠️ **THE FIRST HALF OF THAT ALREADY HELD, AND SAYING SO MATTERS — localStorage has no
   expiry and this store never had a TTL**, so closing the browser and returning the next
   day always kept the link. What it could NOT do is leave the machine: a colleague opening
   the same demo, the same SE on a second laptop, or the live site after a link was saved on
   localhost, all fell back to the tracked default with nothing on screen to say why.

   ⚠⚠ **SO THE VALUE LIVES ON THE DEMO RECORD, THROUGH THE LAYER THAT ALREADY TRAVELS.**
   `AiAssistantContext`'s override store is keyed `<demoId>::<path>`, is written to
   localStorage on every change, is PATCHed to the shared library debounced and owner-only,
   and is re-hydrated by `hydrateDemo` when anyone opens that demo. Writing the booking URL
   there as `bookingUrl` under this screen's own key gets every one of those properties and
   **needs no server change, no schema change and no migration** — a second persistence
   mechanism beside it is how the two end up disagreeing about one link.

   ⚠ **THE LOCAL KEY BELOW SURVIVES AS THE FALLBACK, and it is load-bearing rather than
   legacy.** `applyEdits` returns 0 for a demo the signed-in SE may not edit (`readOnly`) and
   for a bundled profile that is no library demo at all — both are real, and in both the SE
   still needs to be able to point the link at a replica for the conversation they are having.
   So a refused shared write falls back to this browser, exactly as before.
   ⚠ **PRECEDENCE IS LOCAL, THEN SHARED, and that ordering is the whole reason the two can
   coexist.** A successful shared write CLEARS the local copy, so a local value exists only
   when the shared write was refused — i.e. only when it is the SE's own, and theirs should
   win on their own machine. Without the clear, an owner re-pointing the link on one laptop
   would leave the other reading a stale local copy forever.
   ============================================================================= */
const KEY = "invoca-demo:booking-url";

/** The screen this setting belongs to. ONE definition: it is half of the store key that the
 *  demo record is written under, and two copies is how one side writes a key nobody reads. */
export const BOOKING_SCOPE_PATH = "/google-search";
export const bookingScopeKey = (profileId: string) => `${profileId}::${BOOKING_SCOPE_PATH}`;
/** The one field inside that scope. Its base is `""`, so the first save is a string-to-string
 *  write rather than the `undefined -> string` TYPE FLIP `editGuard` refuses — the trap the
 *  greeting, `serviceZips` and the voice picker each had to be let through by name. */
const BOOKING_FIELD = "bookingUrl";

function read(profileId: string): string | null {
  try {
    const raw = localStorage.getItem(`${KEY}::${profileId}`);
    if (!raw) return null;
    /* ⚠️ RE-VALIDATED ON READ, not only on write. This is a hand-editable store feeding an
       `href`; a stale or edited entry must fail closed to the default rather than render. */
    return normalizeUrl(raw).url;
  } catch {
    return null;
  }
}

/**
 * Turn what the SE typed into a URL we are willing to open, or say why not.
 * Exported so the audit tests the real rules rather than a copy of them.
 */
export function normalizeUrl(raw: string): { url: string | null; error: string | null } {
  const s = raw.trim();
  if (!s) return { url: null, error: "Enter a URL." };

  /* ⚠️⚠️ **A SAME-ORIGIN PATH IS ACCEPTED VERBATIM, AND IT IS WHAT "Replicate" WRITES.**
     Replicating a page now ENDS by pointing Book online at `/replica?url=…` on this origin
     rather than navigating there (asked for directly: "once its done, just show complete, but
     dont go to it, auto save the page"). That value has no scheme and no host, and the rules
     below would refuse it twice over: `https:///replica…` has no hostname at all, and even an
     absolute `${location.origin}/replica…` fails the needs-a-dot rule on **localhost**, so the
     feature would work on the live site and be broken for every SE testing it locally.
     ⚠️ **`//host/path` IS EXCLUDED** — a protocol-relative URL is somebody else's origin wearing
     a path's clothes. A single leading slash cannot carry a scheme, so `javascript:` stays
     unreachable through this branch and the guard below still owns every other shape. */
  if (s.startsWith("/") && !s.startsWith("//")) return { url: s, error: null };

  /* Nobody types the scheme, so assume https rather than refusing.
     ⚠️ **THE TEST IS `scheme://`, NOT `scheme:` — a bare colon is AMBIGUOUS WITH A PORT.**
     `[a-z0-9+.-]*` happily matches `example.com`, so testing for a bare colon read
     `example.com:8080/book` as the scheme "example.com:" and refused a perfectly good URL.
     Requiring the slashes still catches everything dangerous: an opaque `javascript:alert(1)`
     has none, so it becomes `https://javascript:alert(1)`, whose "port" is not a number and
     which `new URL` therefore rejects outright; a `javascript://…` that does have them keeps
     its protocol and is refused by the allow-list below. Both verified. */
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;

  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { url: null, error: "That is not a valid URL." };
  }

  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { url: null, error: "Only http and https links can be opened." };
  }
  /* ⚠️ A HOSTNAME WITH NO DOT IS A TYPO HERE, not an intranet host. These are public booking
     pages, and "rotorooter" quietly resolving to nothing mid-demo is worse than being told
     now. */
  if (!u.hostname.includes(".")) {
    return { url: null, error: "That does not look like a full web address." };
  }
  return { url: u.toString(), error: null };
}

function writeLocal(profileId: string, url: string | null) {
  try {
    if (url) localStorage.setItem(`${KEY}::${profileId}`, url);
    else localStorage.removeItem(`${KEY}::${profileId}`);
  } catch { /* private window */ }
}

export interface BookingOverride {
  /** The SE's own destination, or null when the default booking link is in use. */
  url: string | null;
  /** Store what they typed. Returns an error message, or null on success. */
  set: (raw: string) => string | null;
  /** Back to the default booking link. */
  clear: () => void;
}

export function useBookingOverride(profileId: string): BookingOverride {
  const { registerBase, effectiveData, applyEdits } = useAiAssistant();
  const key = bookingScopeKey(profileId);

  const [local, setLocal] = useState<string | null>(() => read(profileId));

  /* Re-read on a prospect switch, or the previous prospect's link stays in force until
     something else re-renders — the same stale-state shape [[locationOverride]] documents. */
  useEffect(() => { setLocal(read(profileId)); }, [profileId]);

  /* ⚠️ `applyEdits` REFUSES A KEY WITH NO BASE, so the base has to exist before the first
     save — and it must be `registerBase`, never `registerScope`, which is last-write-wins and
     would repoint whatever sparkle the SE has open at this screen's one field. */
  useEffect(() => { registerBase(key, { [BOOKING_FIELD]: "" }); }, [key, registerBase]);

  /* ⚠️ RE-VALIDATED ON READ like the local copy is: this arrives from a shared record that
     other people (and a future us) can write, and it is rendered straight into an `href`. */
  const raw = (effectiveData(key) as Record<string, unknown> | undefined)?.[BOOKING_FIELD];
  const shared = typeof raw === "string" && raw ? normalizeUrl(raw).url : null;

  const set = useCallback((rawIn: string): string | null => {
    const { url: next, error } = normalizeUrl(rawIn);
    if (!next) return error;
    /* Try the durable layer first. It lands for a library demo the SE may edit, and from
       there it is persisted locally AND PATCHed onto the record for everyone else. */
    if (applyEdits(key, [{ path: BOOKING_FIELD, value: JSON.stringify(next) }]) > 0) {
      writeLocal(profileId, null);   // one source of truth — see the precedence note above
      setLocal(null);
      return null;
    }
    /* Refused: someone else's demo, or a bundled profile that is no library demo. Their own
       browser is still the right place for it. */
    writeLocal(profileId, next);
    setLocal(next);
    return null;
  }, [applyEdits, key, profileId]);

  const clear = useCallback(() => {
    /* BOTH, unconditionally. Reset means "back to the tracked default", and leaving either
       copy behind would put the old link straight back on the next render. */
    applyEdits(key, [{ path: BOOKING_FIELD, value: JSON.stringify("") }]);
    writeLocal(profileId, null);
    setLocal(null);
  }, [applyEdits, key, profileId]);

  return { url: local ?? shared, set, clear };
}

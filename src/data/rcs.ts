/* =============================================================================
   rcs — what an RCS Business Messaging reply carries beyond its text (10/15/2026)
   -----------------------------------------------------------------------------
   Asked for: an RCS version of the Preview Agent and the workflow, "Aptive - RCS".
   RCS gives a business a verified sender, tappable suggested replies and rich
   cards; plain SMS gives it none of those.

   ⚠️ THE AGENT WRITES THEM AS MARKER LINES, AND THIS FILE IS THE ONE PARSER.
   The RCS brain (`brain.rcs`, see engine/chat.ts `rcsRules`) asks the model to
   end a message with
       [chips: Recurring plan | One-time treatment | Something else]
       [card: Thursday, Oct 16 | 10:00 AM | Book this time]
   which keeps the reply on the same /api/chat path as SMS (no server change on
   either twin) and lets this file turn it into real chips and cards. The phone and
   the Preview Workflow drawer both render through it, and the conversation report
   stores `rcsPlainText`, so a capture never shows a raw marker.
   ⚠️ Tolerant by design: a marker the model puts mid-line is still found, a chip
   list is capped at 4 and a carousel at 3 (what RCS clients display without
   scrolling past usefulness), and a reply with no markers is just text, so a
   model that ignores the format degrades to an ordinary SMS-looking thread.
   ============================================================================= */

import type { CustomerProfile } from "./schema";
import { twoPathGreeting, legacyTwoPathGreeting, withArticle } from "./smsTemplate";

export interface RcsCard {
  /** e.g. "Thursday, Oct 16" */
  title: string;
  /** e.g. "10:00 AM" */
  subtitle: string;
  /** The card's button, e.g. "Book this time". */
  action: string;
}

export interface RcsParts {
  text: string;
  chips: string[];
  cards: RcsCard[];
}

const MARKER = /\[\s*(chips?|cards?)\s*:\s*([^\]]*)\]/gi;

export function parseRcs(raw: string): RcsParts {
  const chips: string[] = [];
  const cards: RcsCard[] = [];
  const text = raw.replace(MARKER, (_m, kind: string, body: string) => {
    const parts = body.split("|").map((s) => s.trim()).filter(Boolean);
    if (/^chip/i.test(kind)) {
      for (const c of parts) if (c.length <= 40 && !chips.includes(c)) chips.push(c);
    } else if (parts.length) {
      cards.push({ title: parts[0], subtitle: parts[1] ?? "", action: parts[2] ?? "Book this time" });
    }
    return "";
  }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, chips: chips.slice(0, 4), cards: cards.slice(0, 3) };
}

/** The message as a person reads it, for the conversation report and the analyzer. */
export const rcsPlainText = (raw: string): string => parseRcs(raw).text || raw.trim();

/** What tapping a card sends: the time the customer picked, in their words. */
export const cardReply = (c: RcsCard): string => (c.subtitle ? `${c.title} at ${c.subtitle}` : c.title);

/** The brand's initials for the verified-sender avatar (no logo is stored on a profile). */
export function brandInitials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

/**
 * The RCS copy's opener is a FIXED line (it never goes through the model), so the chips its
 * two-way question deserves have to be added here. ⚠️ Only to the DEFAULT two-path greeting:
 * an opener somebody rewrote may ask something else entirely, and chips that answer a question
 * the message no longer asks would be worse than none.
 */
export function withRcsOpener<B extends { openingMessage?: string }>(brain: B, profile: CustomerProfile): B {
  const open = brain.openingMessage;
  if (!open || MARKER.test(open)) { MARKER.lastIndex = 0; return brain; }
  MARKER.lastIndex = 0;
  if (open.trim() !== twoPathGreeting(profile).trim() && open.trim() !== legacyTwoPathGreeting(profile).trim()) return brain;
  const term = (profile.bookingTerm || "appointment").toLowerCase();
  return { ...brain, openingMessage: `${open}\n[chips: Book ${withArticle(term)} | Help with an existing one]` };
}

/**
 * What an RCS business thread opens with on iPhone (matched to a recording, 10/15/2026): the
 * business's message link pre-fills the CUSTOMER's compose box with this line, and nothing
 * arrives until they hit send. Only then does the agent's welcome come back.
 */
export const RCS_KICKOFF = "Hit send to start a conversation 👉";

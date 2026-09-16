/* =============================================================================
   replicaRegistry.ts — the two captures that ship IN THE REPO, and nothing else
   -----------------------------------------------------------------------------
   Extracted from `replicaPages.ts` 9/16/2026, for exactly the reason `leadFields.ts`
   was: that module is full of `HTMLInputElement`, `Document` and `HTMLIFrameElement`,
   and the NODE project compiles with `lib: ["ES2023"]` and no DOM.

   ⚠️⚠️ **`server.ts` WAS IMPORTING `replicaPages.ts`, AND THAT IS WHY THE PRODUCTION
   ENTRY POINT WAS NOT TYPE-CHECKED AT ALL.** `tsconfig.node.json` excluded `server.ts`
   — measured, the exclusion was hiding **44 errors, 43 of them DOM types dragged in by
   that one dynamic import**. So the server's own mistakes compiled clean: a required
   field added to `StatusInput` went unnoticed at the call site, and during the alerting
   work a duplicated brace in `server.ts` passed `tsc -b` and surfaced only when the
   server was actually booted. This file is the other half of that fix; the include now
   covers `server.ts` and `googleAuth.ts`, and `audit:replicas` asserts both halves.

   ⚠️ **`replicaPages.ts` RE-EXPORTS everything here**, so every existing importer — the
   screen, the audit — is unchanged. Only the two SERVER-SIDE lookups were re-pointed,
   because those are the ones that must not reach a browser-only module.
   ⚠️ Nothing below touches the DOM, and nothing may be added that does. The field-map
   DERIVATION (which reads a live document) stays in `replicaPages.ts`.
   ============================================================================= */
import type { ReplicaFieldMap } from "./leadFields.ts";
import { TTL_DAYS, captureAgeDays } from "./leadFields.ts";

export interface ReplicaPage {
  /** Served from `public/replicas/<file>`. */
  file: string;
  /**
   * The prospect this belongs to, bare (`aptivepestcontrol.com`). Decides which prospect gets
   * a Replicate button. A replica can still be OPENED by slug without a matching prospect,
   * which is what makes a one-off test possible.
   */
  domain: string;
  /** The page this was captured from, shown in the replica's own chrome. */
  sourceUrl: string;
  capturedAt: string;
  /** What the SE is looking at, for the banner. */
  label: string;
  /**
   * OPTIONAL, and normally absent.
   *
   * ⚠️⚠️ **THE FIELD MAP IS DERIVED FROM THE LIVE FORM, NOT HAND-WRITTEN — that hand-mapping
   * was the slow, error-prone step and it is gone.** `deriveFieldMap` reads the rendered
   * document in the iframe and classifies each control by type, `autocomplete`, name and
   * label, so adding a prospect is: capture, drop the file, add three lines. Set this only to
   * OVERRIDE a form the classifier gets wrong, and say what it got wrong.
   */
  fields?: ReplicaFieldMap;
  /**
   * Self-contained: its CSS, fonts and images are embedded, so it renders exactly as it looked
   * when it was taken no matter what the site does afterwards.
   *
   * ⚠️⚠️ **A FROZEN CAPTURE EXPIRES AFTER `TTL_DAYS`, AND THAT IS THE DEAL THAT BOUGHT THE
   * FREEZING.** Embedding assets costs megabytes, so these are not kept indefinitely: past the
   * TTL `replicaFor` stops offering it and the URL falls back to the live render, and
   * `npm run capture:prune` deletes the file. A LINKED capture (this unset) is small and has
   * no expiry, but it follows the site as the site changes.
   */
  frozen?: boolean;
}

const REPLICAS: Record<string, ReplicaPage> = {
  aptive: {
    file: "aptive.html",
    domain: "aptivepestcontrol.com",
    sourceUrl: "https://aptivepestcontrol.com/build-a-plan/",
    capturedAt: "2026-09-12",
    label: "Build a Plan",
  },
  autonation: {
    file: "autonation.html",
    domain: "autonation.com",
    /* ⚠️ NOT `/appointment`, which `bookingPath` uses. That page is a multi-step scheduler
       widget behind a consent gate whose contact fields never appear on step one, so a capture
       of it shows a form an SE cannot fill. This is AutoNation's fleet enquiry — a genuine
       single-page lead form, and a Salesforce Web-to-Lead one at that, which makes it the
       better demo anyway. The two are allowed to differ: `bookingPath` answers "where does
       Book online go", this answers "which page can we actually replicate". */
    sourceUrl: "https://www.autonation.com/an-fleet-services",
    capturedAt: "2026-09-12",
    label: "Fleet Services enquiry",
  },
  /* ⚠️ ONLY THESE TWO LIVE HERE. Every other capture — whatever the Replicate button makes, or
     `npm run capture` — is written to the persistent store (`engine/replicaStore.ts`) instead,
     because that is the one that survives a restart and is checked at runtime, not compile
     time. `replicaFor`/`replicaBySlug` below answer for these two only; the server's
     `/api/replicate/lookup` checks them first, then the store. */
};

function hostOf(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
}

/**
 * The replica for this prospect, or null when nobody has captured one yet.
 *
 * ⚠️⚠️ **AN EXPIRED FROZEN CAPTURE ANSWERS null ON PURPOSE, so the caller takes the live path.**
 * This is the whole safety story for the 10-day TTL: the moment a capture is too old to trust
 * (or too old to still be on disk, since `capture:prune` deletes it) the feature quietly goes
 * back to rendering the page live. Slower, and it has to beat the site's bot check again, but
 * an SE never lands on a dead link. `replicaBySlug` deliberately does NOT expire — see there.
 */
export function replicaFor(domain: string, now: Date = new Date()): (ReplicaPage & { slug: string }) | null {
  const host = hostOf(domain);
  const hit = Object.entries(REPLICAS).find(([, p]) => hostOf(p.domain) === host);
  if (!hit) return null;
  if (hit[1].frozen && captureAgeDays(hit[1].capturedAt, now) >= TTL_DAYS) return null;
  return { ...hit[1], slug: hit[0] };
}

/** Is this capture past its TTL? Used by the prune script and reported by the audit. */
export function replicaExpired(page: ReplicaPage, now: Date = new Date()): boolean {
  return Boolean(page.frozen) && captureAgeDays(page.capturedAt, now) >= TTL_DAYS;
}

/**
 * Open by slug, so a replica can be shown even with no matching prospect loaded.
 *
 * ⚠️ **NO EXPIRY HERE, AND THE ASYMMETRY IS DELIBERATE.** `/replica/:slug` is somebody asking
 * for THIS capture by name — refusing on age would leave them with nothing, since there is no
 * URL to fall back to rendering. `replicaFor` is the automatic path and is where the TTL
 * belongs. A pruned file 404s in the frame, which is why prune reports what it removed.
 */
export function replicaBySlug(slug: string): (ReplicaPage & { slug: string }) | null {
  const p = REPLICAS[slug];
  return p ? { ...p, slug } : null;
}

/** Every registered slug — exposed for the audit. */
export function replicaSlugs(): string[] {
  return Object.keys(REPLICAS);
}

/* =============================================================================
   shareDefaults — the one value both the browser and the server need
   -----------------------------------------------------------------------------
   ⚠️⚠️ **ITS OWN MODULE BECAUSE `shareMode.ts` READS `location`, AND THE ENGINE
   PROJECT HAS NO DOM.** Importing that module from `engine/` put it into
   `tsconfig.node.json`, which compiles with `lib: ["ES2023"]`, and the build failed
   with "Cannot find name 'location'". This repo has already paid for exactly that
   once: `server.ts` importing `replicaPages.ts` produced 43 DOM-type errors and the
   fix was to extract the DOM-free half into `replicaRegistry.ts`. Same shape here,
   for one constant.

   ⚠️ ONE DEFINITION, FOUR CALLERS — the launch form's checkbox, the share dialog's
   pre-filled field, the server's fallback when a request omits `days`, and extend.
   Four literals is how the form offers 30 while the server quietly stores 7.
   ============================================================================= */

/** How long a new prospect link lasts, in days. */
export const DEFAULT_SHARE_DAYS = 30;

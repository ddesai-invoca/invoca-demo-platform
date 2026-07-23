/* =============================================================================
   generate.ts — CLI wrapper around the generation pipeline (engine/core.ts)
   -----------------------------------------------------------------------------
   Run:
     export ANTHROPIC_API_KEY=sk-ant-...
     npm run generate -- --name "Mavis Tires & Brakes" --url https://www.mavis.com/

   The same pipeline is also exposed at runtime via POST /api/generate
   (see vite.config.ts) so the in-app Launch screen can generate on demand.
   ============================================================================= */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateProfile, slugify } from "./core.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../src/data/generated");

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg("--name");
  const url = arg("--url");
  if (!name || !url) {
    console.error('Usage: npm run generate -- --name "Customer Name" --url https://example.com/');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Export your key, then re-run.");
    process.exit(1);
  }

  const phaseLabel: Record<string, string> = {
    research: "[1/8] Researching the customer…",
    report: "[2/8] Generating Digital Insights report…",
    dashboard: "[3/8] Generating Marketing Performance Dashboard…",
    callReview: "[4/8] Generating Call Review calls…",
    opsDashboard: "[5/8] Generating Marketing & Operations dashboard…",
    conversationIntelligence: "[6/8] Generating Conversation Intelligence…",
    smsConversationIntelligence: "[7/8] Generating AI SMS Conversation Intelligence…",
    agentConfig: "[8/8] Generating Agent Studio configuration…",
  };
  const validated = await generateProfile(name, url, {
    onProgress: (e) => { if (e.status === "start") console.log(phaseLabel[e.phase] ?? e.phase); },
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${slugify(name)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(validated, null, 2));

  console.log(`\n✓ Generated ${validated.customerName}`);
  console.log(`  Industry:     ${validated.industry}`);
  console.log(`  Rows:         ${validated.reports.digitalInsights.rows.length}`);
  console.log(`  Written to:   ${path.relative(process.cwd(), outPath)}`);
  console.log(`\nOpen the app and pick "${validated.networkName}" in the network switcher.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

# Demo Generation Engine

Turns a customer **name + URL** into a validated `CustomerProfile` the app loads
automatically.

## Setup (once)
```bash
cp .env.example .env      # then paste your ANTHROPIC_API_KEY into .env
```
(Or `export ANTHROPIC_API_KEY=sk-ant-...` in your shell.)

## Generate a demo customer
```bash
npm run generate -- --name "Mavis Tires & Brakes" --url https://www.mavis.com/
```

What happens:
1. **Research** — Claude (Opus 4.8) fetches the site + web-searches the company,
   then writes a business brief (products, prices, channels, campaigns, journeys).
2. **Generate** — Claude turns the brief into Digital Insights demo data,
   constrained to the schema via **structured outputs**, then Zod-validated.
3. Writes `src/data/generated/<slug>.json`.

Open the app (`npm run dev`) and pick the new customer in the network switcher —
the whole screen re-skins to their data.

## How it stays consistent
Every screen reads from the same `CustomerProfile`, and the engine's output is
validated against the canonical Zod schema (`src/data/schema.ts`) before it's
written. Malformed data fails loudly instead of half-rendering.

## Adding fields / screens later
Extend `CustomerProfile` (and `GenerationOutput`) in `src/data/schema.ts`. The
engine's structured-output schema is derived from Zod automatically, so new
fields flow through without touching the engine code — just update the
generation prompt to describe them.

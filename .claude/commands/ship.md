---
description: Review, check and ship the current changes as a branch + PR
---

Ship the work currently in my working tree, following this repo's rules. Walk
through every step below in order. Explain what you find as you go, and stop and
ask me if anything looks wrong rather than pushing through it.

## 1. See what actually changed

Run `git status` and `git diff`. Tell me in plain language what changed and why
it looks like it changed. If the tree is clean, say so and stop.

If you see changes you can't account for — files neither of us touched this
session, half-finished edits, debug output — surface them before going further.
Do not assume they are mine to ship.

## 2. Get on a branch

If I'm on `main`, create a branch named `<myname>/<short-description>` from the
current work. Never commit directly to `main` — several people share this
sandbox and `main` deploys to the shared Render service.

Pull first (`git pull --rebase`) so I'm building on everyone else's latest. If
that produces conflicts, stop and walk me through them rather than resolving
them on your own.

## 3. Check what you're about to stage

**Stage specific files by name. Never `git add -A` or `git add .`** — generated
demo files, captures and scratch output live in this working tree and get swept
in by a broad add.

Before staging, check for anything that must not be committed:

- `.env` or any file holding a real key, token or password
- anything under `.data/`
- large binaries or captures that aren't part of the change

`.env` and `.data/` are already gitignored — if either shows up as stageable,
something is wrong with the ignore rules and I want to know before we continue.

If a file's name looks harmless but its contents might hold a secret, read it
before staging it.

## 4. Run the checks

Run `npm run audit`. It runs the type check first, then the full audit suite —
a large set of rules this codebase enforces about how its screens and data fit
together.

If it fails: read the failure, explain what it's actually complaining about, and
fix the cause. Don't weaken or delete a check to make it pass. If a check seems
wrong rather than the code, say so explicitly and let me decide.

## 5. Commit

Write a commit message that says **what changed and why** — the reasoning, not a
restatement of the diff. Someone reading it in three months should understand the
motivation without opening the files.

## 6. Push and open a PR

Push the branch and open a pull request with `gh pr create`. In the description,
cover what changed, why, and how I verified it (or what still needs verifying).

Give me the PR URL when you're done.

---

**If anything in here conflicts with what I've asked you to do in conversation,
ask me — don't silently pick one.**

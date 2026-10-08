# The share link's password, emailed on request

A prospect opening a share link now enters **their email** and is sent the password,
rather than being given it by the person who shared the link.

## What the password is

The prospect's own name with the spaces removed — `United Veterinary Care` becomes
`UnitedVeterinaryCare`. One definition, in `src/data/sharePassword.ts`, read by both the
route that creates a share and the email that sends it.

> ⚠️ **It is not a secret, and the design should be read that way.** The unlock page prints
> the prospect's name in its own heading, so anyone holding the link can work the password
> out without asking. **The real secret is the 32-byte token in the URL**, exactly as
> before. What the email step buys is a **record of who opened the demo** and one less
> thing for a rep to pass along by hand.
>
> If the password ever needs to be a real gate, it has to stop being derivable from the
> page it guards — a random code emailed per request, with the prospect name taken off the
> unlock screen.

## Sending as noreply@invoca.com

Set `SHARE_FROM=noreply@invoca.com` in the environment.

> ⚠️ **Setting it does not guarantee it.** Gmail only honours a `From` the sending account
> is allowed to use — the account itself, or an address verified under
> **Settings › Accounts › "Send mail as"**. Anything else is silently **rewritten** to the
> real account: the mail still arrives, just from the wrong address, and nothing errors.
> Nothing in this codebase can detect that.
>
> So one of these has to be true:
> - `noreply@invoca.com` is the mailbox the Gmail grant was minted for (`GMAIL_SENDER`), or
> - it is a verified "Send mail as" alias on that mailbox.
>
> Leave `SHARE_FROM` unset and the mail goes from the sending account, which is the honest
> default.

## What stops it being a mail relay

The route is public — a prospect has no Invoca session — and it sends mail to an address
the caller types, so:

- the body is **fixed**: the password and that demo's own link, nothing caller-controlled
- the address is shape-checked and length-bounded
- the link must be **live** (not revoked, not expired)
- **12 requests per link per day**, after which it answers 429
- every request is **recorded on the share**, so a burst is visible afterwards rather than
  only blocked at the time

## When a password was set by hand

If the person sharing typed their own password, it **cannot** be emailed — the store keeps
only a hash, so there is nothing to send. The request is still recorded, and the prospect
is told to ask their Invoca contact. Sending the derived password instead would be worse
than sending nothing: it would not open the link and nothing would explain why.

## If the email never arrives

The gate keeps an **"I already have the password"** link, so a spam filter, an unconfigured
mailer or a password passed along in person all still work.

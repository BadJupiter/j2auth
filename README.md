# j2auth

Jupiter 2.0 mobile authentication — the shared module every Jupiter app
authenticates through.

Authenticate a mobile device from anywhere to establish a User identity token.
Users are known across the entire universe of Jupiter applications, but operate
within the context of specific apps identified by app tokens.

## This repo is the source of truth

Edit `j2auth.js` **here**, then distribute. Never edit a deployed copy in
place — that's how six copies quietly forked (reconciled 2026-08-12).

```bash
./check-copies.sh          # fail if any deployed copy has drifted
./check-copies.sh --fix    # overwrite the copies from canonical
```

Worth wiring into a pre-commit hook on v2-client and v2-db-feedback.

## Where the copies live

One per consuming repo. **Inside v2-client there is exactly one copy, at the
repo root** — every sub-app loads `../j2auth.js`. Don't reintroduce per-app
copies; `check-copies.sh` fails if you do.

| Repo | Path | Loaded by |
|---|---|---|
| v2-client | `j2auth.js` | `s2/`, `squares/`, `ips/`, `bourbon/`, `eleven/`, `admin/` — all via `../j2auth.js` |
| v2-db-feedback | `docs/js/j2auth.js` | `colusacasino/`, `saddlewest/` via `/js/j2auth.js` |

## What it needs from the host page

- A `bootstrap.Modal`-compatible global. The consumer apps load real Bootstrap;
  the dashboards deliberately don't (its global reboot fights their CSS) and
  supply `bs-shim.js` instead.
- `VMasker` (vanilla-masker) for the phone input.
- The shared auth-modal markup — the element IDs (`authModal`, `phone`,
  `sendCodeBtn`, `code1`–`code4`, `verifyCodeBtn`, …) are addressed directly.
  Copy it verbatim; don't tidy the class names.

## API

Globals, because this is a classic script rather than a module:

| | |
|---|---|
| `j2AuthInit(bizid, apptoken)` | resolve the device cookie to a User |
| `authenticateUser()` | run the SMS modal; resolves `true`/`false` |
| `isAuthenticated`, `userProfile` | post-auth state |
| `getCookie()` | the device token — the credential the API authorizes |

## The one per-app policy decision

After a successful verify, j2auth calls `registerBusinessUser()`, creating a
role-less `(:User)-[:REGISTERED_FOR]->(:Business)` edge.

That's correct for **consumer apps** — it's how a guest becomes known to a
business, and it's what `/register-biz/` exists for. It is wrong for **admin
dashboards**, where merely attempting to sign in must not grant membership of
the business that gates access.

Dashboards opt out by overriding the global before any flow runs, rather than
by forking this file:

```js
window.registerBusinessUser = () => {};
```

Both the feedback dashboards (`docs/js/auth.js`) and the admin console
(`admin/js/auth.js`) do exactly this.

## Reconciliation notes (2026-08-12)

Six copies had drifted. Most differences were whitespace, but two were real:

- **`apptoken` in the `/register-biz/` body.** Present in the canonical, root
  and bourbon copies; missing from s2, squares and ips. The server takes it as
  optional and appends it to `r.apps`, so it's purely additive — kept.
- **A duplicated post-verify block.** `verifyAuthenticationCode()` already sets
  the cookie, refreshes `userToken` and fetches `userProfile`. The verify
  click-handler repeated all three, costing a second `/userprofile/` round-trip
  on every sign-in. The IPS copy had fixed this (2026-01-04) with comments
  explaining why; that fix is now canonical.
- s2, squares and ips had also **lost the `registerBusinessUser()` call**. It's
  restored here, since it's the documented behavior and the override above is
  the supported way to opt out. **Those three apps change behavior** — an
  authenticated user now gets a role-less REGISTERED_FOR edge to that app's
  business. `MERGE` makes it idempotent and it grants no permissions, but it
  should be a conscious choice; add the override if any of them shouldn't.

## Toward a real submodule

This repo was created to be consumed as a git submodule (see the original
README intent) and the setup is close, with one concrete blocker:

- ✅ `BadJupiter/j2auth` is **public**, which GitHub Pages requires to fetch a
  submodule.
- ❌ The remote is `ssh://git@github.com/BadJupiter/j2auth.git`. **Pages cannot
  clone ssh submodules** — `.gitmodules` must use an `https://` URL. This is
  the likely reason the original experiment stalled.

Switching the remote to https and adding the submodule to v2-client and
v2-db-feedback would give one true source with per-repo pinning (each repo
points at a commit, so rollout stays deliberate — which matters for auth). The
copy-plus-drift-check above is the same guarantee with less ceremony; it just
depends on the check actually running.

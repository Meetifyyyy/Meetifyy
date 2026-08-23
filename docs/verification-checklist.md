# Verification checklist

21 commits, 118 files. Everything below is **statically verified only** — 135
frontend tests, 257 backend tests, clean typecheck and build, and the frontend
boots with no console errors. None of it has been exercised against a real
database, because this environment has no Postgres server and no way to install
one. You have the only environment that can prove these work.

Ordered by risk: the first four touch code paths used everywhere, so a defect
there is worse than anything further down.

---

## Before you start

The service worker caches aggressively. **Hard-reload once** (Ctrl+Shift+R), or
the old bundle will make working code look broken. On an installed PWA, remove
it from the home screen and re-add it.

---

## 1. Typing, everywhere — highest risk

`MentionInput` is shared by the post composer, comment composer, reply boxes and
chat. Its DOM-sync rule changed: while the field has focus the DOM is
authoritative and the component will not rewrite it. All four call sites store
the value verbatim, which is what makes that safe — but it is the single change
with the widest blast radius.

- [ ] Type a sentence **with spaces** in the post composer. Every character lands.
- [ ] Same in a comment box, and in a reply box **under a comment that already has replies** — that was the exact failing case.
- [ ] Type a multi-word message in chat.
- [ ] Type `@` and pick someone. The pill appears, the caret sits after it, and typing continues normally.
- [ ] Post something, then type again immediately. The field is not stuck.
- [ ] Post a comment, delete it, then post another. This is the reported "can't post again" sequence.

## 2. Media loading

Every media reference now resolves through `getMediaUrl`. Fourteen render sites
were passing raw storage keys straight to `<img src>`.

- [ ] Post images load in the feed (not just when opened).
- [ ] Chat gallery in a conversation's details — images and videos both, with video showing a frame rather than a black box.
- [ ] Tap a gallery item; the viewer opens with the right media.
- [ ] Activity cover images on crew cards and the activity page.
- [ ] Community avatars **and covers** — the cover in particular read the wrong column entirely, so it may look *new* rather than fixed.
- [ ] Avatars in the invite modal, new-message modal and search results.
- [ ] Anything genuinely missing shows a muted tile with an icon — never a broken-image glyph, never a stock photo.

## 3. Comments and replies

- [ ] Open a reply box, then open another. The first closes.
- [ ] Reply to a nested comment. The thread expands so you can see it.
- [ ] Delete a comment with no replies — it disappears entirely, and the count drops by one.
- [ ] Delete a comment that has replies — it becomes "[deleted]" but keeps the replies, and the count still drops by one.
- [ ] The header count matches the number of visible comments.

## 4. Messages

- [ ] Delete a conversation while it is open. It closes and leaves the list immediately.
- [ ] Message that person again. The thread is empty — the old messages do not come back.
- [ ] Confirm from the other account that **their** copy is untouched.
- [ ] Send Message on a profile whose DM you previously deleted. It opens a fresh thread instead of "This conversation doesn't exist".
- [ ] Click a message notification toast. The full conversation loads, not one message.

## 5. Everything else

- [ ] Someone joins your activity → you get a toast **and** a row on the Notifications page, reading "<username> joined your activity", with the activity name and cover.
- [ ] Promote a member to admin. The system message, the conversation-list preview and Group Details all update without a refresh, on both accounts.
- [ ] Create a post → appears immediately, and is still there after navigating away and back.
- [ ] Create an activity → appears on the Crew page immediately, in the right section.
- [ ] Change your avatar → it updates in the feed, chat and share/invite modals without a refresh, and on a second account too.
- [ ] A community owner sees an "Owner" chip, not a Join/Joined toggle.
- [ ] PWA: uninstall, re-add. The splash is white with the logo — no black ring.

---

## Only you can do these

### Cloudflare — the campus-network failure

The zone is already on Cloudflare nameservers. Full detail in
[network-reachability.md](./network-reachability.md).

1. DNS → the `dev` record → set to **Proxied** (orange cloud).
2. SSL/TLS → **Full (strict)**.
3. Verify: `curl -sI https://dev.meetifyy.app/ | grep -i cf-ray` returns a header. It currently returns nothing.
4. Separately: the apex returns Cloudflare **error 1000** (a proxy loop). Replace its A records with a redirect rule to the app hostname.

Code cannot fix this. The browser never reaches us, so nothing of ours runs.

### Move the API off the shared PaaS wildcard

`*.up.railway.app` is shared by every Railway project and is a standing
blocklist target. Give the API `api.meetifyy.app` in the same Cloudflare zone and
point `VITE_API_URL` at it. The same-origin `/_api` failover added in this work
is a safety net, not a substitute.

---

## Known remaining debt

Deliberately not addressed — each is a real finding, none is a live bug.

- **`/api/messages/*` mirrors `/api/group-chats/*`** for group management. The web client uses the group-chats path; the mirror now emits the same realtime events, but two routes to one operation will drift again. Deleting the mirror needs confidence that no other client uses it.
- **`OptimizedImage` has no callers.** Dead component.
- **Storage durability.** `CloudflareR2Provider.upload` no longer swallows failures, and `createPost` verifies the object exists before attaching it. Uploads that failed *before* those changes left `Media` rows pointing at nothing; those posts cannot be recovered and the orphaned rows are worth cleaning up.
- **No DOM test environment.** The frontend has vitest but no jsdom or testing-library, so component behaviour cannot be tested — only pure functions. Adding them would let the typing and reply-box rules above be pinned by tests instead of by hand.

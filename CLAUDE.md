# CLAUDE.md — j-j-wedding-photos

Standalone guest photo feed for the J&J wedding (10·10·2026, Provence). Sibling
of `j-j-wedding` (guest info site, which links here from its homepage) and
`j-j-wedding-quiz`. Static site, no build step, one page: `index.html` +
`js/app.js` (ES module) + `css/app.css`. Read `README.md` for the services.

## Invariants — do not break these

**1. Stay inside Firestore's free 50k reads/day.** The feed pages with one-off
`getDocs` reads and streams *only posts newer than the first page*
(`watchNew`). Do not put a live listener on the whole feed or on each post's
likes. The latest two comments are denormalised onto the post (`recent`) so the
feed never reads comment subcollections. The post count is one
`getCountFromServer` call per page open.

**2. The "new posts" cutoff must be a server timestamp.** `state.newestAt` is
the first post's `createdAt`, or epoch 0 on an empty feed — never
`Timestamp.now()`. A phone with a fast clock hid new posts in testing.

**3. Every write is tied to the anonymous uid**, and the rules check shapes
field by field. If you add a field to a post or comment, add it to the
`hasOnly` list in `firebase/firestore.rules` and redeploy, or writes will fail.

## Data model

```
admins/{uid}                         exists -> that device can delete anything
posts/{id}   { uid, name, caption, publicId, version, w, h,   <- first photo, for older readers
               photos: [{publicId, version, w, h}] (1–10, carousel),
               createdAt, likes: {uid: true}, commentCount,
               recent: [{id, uid, name, text}] (last 2 comments) }
posts/{id}/comments/{cid}  { uid, name, text, createdAt }
```

Comment add/delete runs in a transaction that also moves `commentCount` by one
and rewrites `recent`.

## Accounts and keys

- gcloud's *default* account on this machine is the user's work account. Always
  pass `--account aerojim92@gmail.com` for this project; never switch the default.
- The Firebase web key is public by design and restricted in Google Cloud to
  the site's origins and to identitytoolkit / securetoken / firestore. GitHub
  secret scanning flags it as a "Google API Key" leak; that's expected. Check the
  restriction still holds (a request with another site's Referer must get
  PERMISSION_DENIED), then resolve the alert as "won't fix". Don't try to hide
  the key; a static page can't.
- Do not upgrade the Firebase project to Blaze.

## Testing

Serve with `python -m http.server 8765 --bind 127.0.0.1` from this folder
(bind and folder both matter). There is no test suite; drive it with
Playwright (Edge channel), and delete any test post you create from the same
browser context — a new context is a new anonymous user and can't delete it.

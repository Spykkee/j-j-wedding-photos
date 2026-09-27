# J&J Wedding Photos

An Instagram-style photo feed for the J&J wedding weekend (9–11 October 2026,
Provence). Guests open it from a QR code, type their name once, and post
photos, likes and comments. There is nothing to install and no account to make.

Live: <https://spykkee.github.io/j-j-wedding-photos/>

## How it works

| Piece | Service | Notes |
| --- | --- | --- |
| Page | GitHub Pages off `main` | static, no build step |
| Photos | Cloudinary `mxntbnq1`, unsigned preset `jj-wedding-guests` | shrunk to 2048px and stripped of GPS on the phone before upload |
| Posts, likes, comments | Firebase project `jj-wedding-photos` (Firestore, europe-west1, free Spark plan) | anonymous sign-in; rules in `firebase/firestore.rules` |

Everything is on free tiers and the Firebase project has no billing account.

## Deleting

Deleting a post removes it and its comments from Firestore at once. The photos
on Cloudinary are removed by an hourly GitHub Actions job
([.github/workflows/cleanup.yml](.github/workflows/cleanup.yml) →
[scripts/cleanup-cloudinary.mjs](scripts/cleanup-cloudinary.mjs)), because only a
request signed with the Cloudinary API secret can delete, and a web page can't
hold a secret. The job deletes images that no post uses once they're over 2 hours
old. It needs two repo secrets, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`
(Cloudinary → Settings → API Keys). Run it by hand from the Actions tab; it
defaults to a dry run.

## Moderating

A guest can delete their own posts and comments from the phone and browser they
posted from. To let a phone delete anything:

1. Open `https://spykkee.github.io/j-j-wedding-photos/?me` on that phone and copy the Device ID.
2. In the [Firestore console](https://console.firebase.google.com/project/jj-wedding-photos/firestore),
   add a document with that ID to the `admins` collection (any field, e.g. `name`).

Anything can also be deleted straight from the console.

## Working on it

```sh
python -m http.server 8765 --bind 127.0.0.1
# http://localhost:8765/
```

The Firebase browser key only accepts requests from `spykkee.github.io`,
`localhost:8765` and `127.0.0.1:8765` (set in Google Cloud → APIs & Services →
Credentials). Serve on another port and sign-in will fail until it's added there.

Deploy rules after changing them:

```sh
cd firebase && firebase deploy --only firestore:rules
```

## After the wedding

Cloudinary → Media Library → folder `jj-wedding` → select all → Download.

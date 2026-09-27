// Deletes Cloudinary photos that no post uses any more.
//
// A web page can't delete from Cloudinary (it needs the account's API secret),
// so when a guest deletes a post only the Firestore side goes at once. This
// script runs hourly on GitHub Actions (.github/workflows/cleanup.yml) with the
// secret, and removes every image in the `jj-wedding` folder that no post
// points to.
//
// Safety:
//   - only images older than GRACE_HOURS, so an upload whose post isn't
//     written yet is never touched;
//   - aborts if the posts can't be read, and refuses to wipe the folder when
//     it finds no posts at all while Cloudinary still holds several images;
//   - at most MAX_DELETE images per run;
//   - DRY_RUN=true only lists what it would delete.
//
// Env: CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, DRY_RUN and ALLOW_EMPTY (optional).
// Without the Cloudinary credentials it only prints the photos in use.

const CLOUD = 'mxntbnq1';
const FOLDER = 'jj-wedding';
const PROJECT = 'jj-wedding-photos';
// Public Firebase web key, restricted to the site's origins (hence the Referer).
const FIREBASE_KEY = 'AIzaSyC36sp8u0sPznPOlfULlbShZBaoRLO0ttE';
const REFERER = 'https://spykkee.github.io/j-j-wedding-photos/';
const GRACE_HOURS = 2;
const MAX_DELETE = 100;

const { CLOUDINARY_API_KEY: KEY, CLOUDINARY_API_SECRET: SECRET } = process.env;
const DRY = process.env.DRY_RUN === 'true';
const ALLOW_EMPTY = process.env.ALLOW_EMPTY === 'true';

async function json(res, what) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${JSON.stringify(body.error || body).slice(0, 300)}`);
  return body;
}

/** Sign in the way a guest's phone does, so the Firestore rules apply as usual. */
async function guestToken() {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', referer: REFERER },
    body: JSON.stringify({ returnSecureToken: true })
  });
  return (await json(res, 'anonymous sign-in')).idToken;
}

/** Every Cloudinary public id that some post still uses. */
async function photosInUse(token) {
  const used = new Set();
  let posts = 0, pageToken = '';
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/posts`);
    url.searchParams.set('pageSize', '300');
    url.searchParams.append('mask.fieldPaths', 'publicId');
    url.searchParams.append('mask.fieldPaths', 'photos');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const page = await json(await fetch(url, { headers: { authorization: `Bearer ${token}` } }), 'list posts');
    for (const d of page.documents || []) {
      posts++;
      const f = d.fields || {};
      if (f.publicId) used.add(f.publicId.stringValue);
      for (const v of f.photos?.arrayValue?.values || []) {
        const id = v.mapValue?.fields?.publicId?.stringValue;
        if (id) used.add(id);
      }
    }
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return { used, posts };
}

const auth = () => 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64');

async function cloudinaryImages() {
  const all = [];
  let cursor = '';
  do {
    const url = new URL(`https://api.cloudinary.com/v1_1/${CLOUD}/resources/by_asset_folder`);
    url.searchParams.set('asset_folder', FOLDER);
    url.searchParams.set('max_results', '500');
    if (cursor) url.searchParams.set('next_cursor', cursor);
    const page = await json(await fetch(url, { headers: { authorization: auth() } }), 'list Cloudinary folder');
    all.push(...page.resources.filter(r => r.resource_type === 'image'));
    cursor = page.next_cursor || '';
  } while (cursor);
  return all;
}

async function destroy(ids) {
  for (let i = 0; i < ids.length; i += 100) {
    const url = new URL(`https://api.cloudinary.com/v1_1/${CLOUD}/resources/image/upload`);
    ids.slice(i, i + 100).forEach(id => url.searchParams.append('public_ids[]', id));
    url.searchParams.set('invalidate', 'true');
    const res = await json(await fetch(url, { method: 'DELETE', headers: { authorization: auth() } }), 'delete');
    for (const [id, status] of Object.entries(res.deleted || {})) console.log(`  ${status.padEnd(10)} ${id}`);
  }
}

const { used, posts } = await photosInUse(await guestToken());
console.log(`${posts} posts use ${used.size} photos.`);

if (!KEY || !SECRET) {
  console.log('No Cloudinary credentials: nothing else to do.');
  process.exit(0);
}

const images = await cloudinaryImages();
const cutoff = Date.now() - GRACE_HOURS * 3600e3;
const orphans = images.filter(r => !used.has(r.public_id) && Date.parse(r.created_at) < cutoff);
const young = images.filter(r => !used.has(r.public_id) && Date.parse(r.created_at) >= cutoff).length;
console.log(`Cloudinary folder "${FOLDER}": ${images.length} images, ${orphans.length} unused and older than ${GRACE_HOURS} h`
  + (young ? `, ${young} unused but too recent to touch yet` : '') + '.');

if (posts === 0 && images.length > 5 && !ALLOW_EMPTY) {
  throw new Error('Found no posts but several images: refusing to empty the folder. If that is really right, '
    + 'run the workflow by hand with "Allow emptying the folder" ticked.');
}
if (!orphans.length) process.exit(0);

const batch = orphans.slice(0, MAX_DELETE).map(r => r.public_id);
if (DRY) {
  console.log('Dry run, would delete:');
  batch.forEach(id => console.log('  ' + id));
} else {
  console.log(`Deleting ${batch.length}${orphans.length > batch.length ? ` (of ${orphans.length}, the rest next run)` : ''}:`);
  await destroy(batch);
}

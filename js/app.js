/* ---------------------------------------------------------------------------
   J&J wedding photo feed — a standalone, Instagram-style page (index.html).

   Images go straight from the phone to Cloudinary (unsigned preset); the post
   record — who, caption, likes, comments — lives in Firestore, project
   jj-wedding-photos. Guests sign in anonymously; the rules in
   firebase/firestore.rules tie every write to that anonymous uid.

   Firestore free tier is 50k reads a day, so the feed is paged with one-off
   reads and only *new* posts are streamed live. Like counts on older posts
   refresh when the page is reopened, which is how Instagram behaves too.
   --------------------------------------------------------------------------- */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getFirestore, collection, doc, query, orderBy, limit, startAfter, where,
  getDocs, getDoc, getCountFromServer, onSnapshot, addDoc, updateDoc, runTransaction, writeBatch,
  serverTimestamp, deleteField, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const CLOUD = 'mxntbnq1';
const PRESET = 'jj-wedding-guests';
const PAGE = 9;
const PREVIEW = 2;              // latest comments shown under each photo, kept on the post itself
const MAX_PHOTOS = 10;          // photos in one post, swiped like an Instagram carousel
const MAX_EDGE = 2048;          // long edge after in-browser downscale
const NAME_KEY = 'jj-photos-name';
const VIEW_KEY = 'jj-photos-view';
const LANG_KEY = 'jj-lang';     // same key as the wedding site (same origin), so the choice carries over
const LANGS = ['en', 'fr', 'ko'];
const LANG_CODE = { en: 'EN', fr: 'FR', ko: 'KR' };

const app = initializeApp({
  apiKey: 'AIzaSyC36sp8u0sPznPOlfULlbShZBaoRLO0ttE',
  authDomain: 'jj-wedding-photos.firebaseapp.com',
  projectId: 'jj-wedding-photos',
  storageBucket: 'jj-wedding-photos.firebasestorage.app',
  messagingSenderId: '1084337910879',
  appId: '1:1084337910879:web:2925cdc79fbf75a5be97ea'
});
const auth = getAuth(app);
const db = getFirestore(app);
const postsCol = collection(db, 'posts');

/* ---------------------------------------------------------------- strings */

const STR = {
  en: {
    seePhoto: 'See the photo',
    docTitle: 'J&J Wedding Photos', language: 'Language', yourName: 'Your name',
    title: 'J & J — Wedding Photos', statPosts: 'posts', statDates: 'Oct 2026', statPlace: 'France',
    newPost: 'New post',
    prev: 'Previous photo', next: 'Next photo',
    qrTitle: 'Open it on your phone', qrText: 'Point your camera at this code to share your own photos.',
    qrAlt: 'QR code linking to the J&J wedding photo feed',
    intro: 'Share your photos of the weekend with everyone, and like and comment on your favourites.',
    add: 'Add photos', feed: 'Feed', grid: 'Grid',
    postingAs: 'Posting as {name}', setName: 'Set your name', change: 'Change',
    nameTitle: 'What’s your name?', nameHelp: 'So everyone knows who shared each photo. It’s saved on this phone.',
    namePh: 'Your name', save: 'Continue', cancel: 'Cancel',
    photos1: '1 photo', photosN: '{n} photos',
    captionPh: 'Write a caption… (optional)', share: 'Share',
    uploading: 'Uploading…', failed: 'Upload failed', retry: 'Retry', done: 'Shared ✦',
    likes0: 'Be the first to like this', likes1: '1 like', likesN: '{n} likes',
    cmts0: 'Add a comment', cmts1: 'View 1 comment', cmtsN: 'View all {n} comments',
    comments: 'Comments', commentPh: 'Add a comment…', send: 'Post', noComments: 'No comments yet.',
    empty: 'No photos yet — be the first to share one!', loading: 'Loading photos…',
    error: 'Couldn’t load the photos. Check your connection and try again.', retryLoad: 'Try again',
    end: 'You’re all caught up ✦',
    delPost: 'Delete this photo?', delComment: 'Delete this comment?', del: 'Delete',
    like: 'Like', comment: 'Comment', close: 'Close', newPhotos: 'New photos',
    deviceId: 'Device ID', actionFailed: 'That didn’t work. Check your connection and try again.'
  },
  fr: {
    seePhoto: 'Voir la photo',
    docTitle: 'Photos du mariage J&J', language: 'Langue', yourName: 'Votre prénom',
    title: 'J & J — Photos du mariage', statPosts: 'publications', statDates: 'oct. 2026', statPlace: 'France',
    newPost: 'Nouvelle publication',
    prev: 'Photo précédente', next: 'Photo suivante',
    qrTitle: 'Ouvrez-le sur votre téléphone', qrText: 'Visez ce code avec votre appareil photo pour partager vos propres photos.',
    qrAlt: 'QR code vers le fil photo du mariage de J&J',
    intro: 'Partagez vos photos du week-end avec tout le monde, et likez et commentez vos préférées.',
    add: 'Ajouter des photos', feed: 'Fil', grid: 'Grille',
    postingAs: 'Vous publiez en tant que {name}', setName: 'Indiquer votre prénom', change: 'Modifier',
    nameTitle: 'Comment vous appelez-vous ?', nameHelp: 'Pour que chacun sache qui a partagé chaque photo. C’est enregistré sur ce téléphone.',
    namePh: 'Votre prénom', save: 'Continuer', cancel: 'Annuler',
    photos1: '1 photo', photosN: '{n} photos',
    captionPh: 'Ajouter une légende… (facultatif)', share: 'Partager',
    uploading: 'Envoi…', failed: 'Échec de l’envoi', retry: 'Réessayer', done: 'Partagée ✦',
    likes0: 'Aucun j’aime pour l’instant', likes1: '1 j’aime', likesN: '{n} j’aime',
    cmts0: 'Ajouter un commentaire', cmts1: 'Voir le commentaire', cmtsN: 'Voir les {n} commentaires',
    comments: 'Commentaires', commentPh: 'Ajouter un commentaire…', send: 'Publier', noComments: 'Pas encore de commentaire.',
    empty: 'Pas encore de photo — partagez la première !', loading: 'Chargement des photos…',
    error: 'Impossible de charger les photos. Vérifiez votre connexion et réessayez.', retryLoad: 'Réessayer',
    end: 'Vous avez tout vu ✦',
    delPost: 'Supprimer cette photo ?', delComment: 'Supprimer ce commentaire ?', del: 'Supprimer',
    like: 'J’aime', comment: 'Commenter', close: 'Fermer', newPhotos: 'Nouvelles photos',
    deviceId: 'Identifiant de l’appareil', actionFailed: 'Ça n’a pas marché. Vérifiez votre connexion et réessayez.'
  },
  ko: {
    seePhoto: '사진 크게 보기',
    docTitle: 'J&J 웨딩 사진', language: '언어', yourName: '이름',
    title: 'J & J — 웨딩 사진', statPosts: '게시물', statDates: '2026년 10월', statPlace: '프랑스',
    newPost: '새 게시물',
    prev: '이전 사진', next: '다음 사진',
    qrTitle: '휴대폰에서 열어 보세요', qrText: '카메라로 이 코드를 비추면 직접 찍은 사진을 올릴 수 있어요.',
    qrAlt: 'J&J 웨딩 사진 피드 QR 코드',
    intro: '주말 동안 찍은 사진을 모두와 함께 나눠 주세요. 마음에 드는 사진에는 좋아요와 댓글도 남겨 주세요.',
    add: '사진 올리기', feed: '피드', grid: '그리드',
    postingAs: '게시자: {name}', setName: '이름 설정하기', change: '변경',
    nameTitle: '이름이 어떻게 되세요?', nameHelp: '누가 사진을 올렸는지 모두가 알 수 있도록요. 이 휴대폰에 저장됩니다.',
    namePh: '이름', save: '계속', cancel: '취소',
    photos1: '사진 1장', photosN: '사진 {n}장',
    captionPh: '설명을 입력하세요… (선택)', share: '공유하기',
    uploading: '업로드 중…', failed: '업로드 실패', retry: '다시 시도', done: '공유 완료 ✦',
    likes0: '첫 번째로 좋아요를 눌러 주세요', likes1: '좋아요 1개', likesN: '좋아요 {n}개',
    cmts0: '댓글 달기', cmts1: '댓글 1개 보기', cmtsN: '댓글 {n}개 모두 보기',
    comments: '댓글', commentPh: '댓글 달기…', send: '게시', noComments: '아직 댓글이 없어요.',
    empty: '아직 사진이 없어요 — 첫 사진을 올려 주세요!', loading: '사진을 불러오는 중…',
    error: '사진을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.', retryLoad: '다시 시도',
    end: '모든 사진을 다 봤어요 ✦',
    delPost: '이 사진을 삭제할까요?', delComment: '이 댓글을 삭제할까요?', del: '삭제',
    like: '좋아요', comment: '댓글', close: '닫기', newPhotos: '새 사진',
    deviceId: '기기 ID', actionFailed: '처리하지 못했어요. 연결을 확인하고 다시 시도해 주세요.'
  }
};

let currentLang = (() => {
  try { const v = localStorage.getItem(LANG_KEY); if (LANGS.includes(v)) return v; } catch { /* private mode */ }
  const nav = (navigator.language || 'en').slice(0, 2);
  return LANGS.includes(nav) ? nav : 'en';
})();
const lang = () => currentLang;
function setLang(l) {
  if (!LANGS.includes(l) || l === currentLang) return;
  currentLang = l;
  try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ }
  applyStatic();
  refreshAll();
}
function tr(key, vars) {
  let s = (STR[lang()] || STR.en)[key] ?? STR.en[key] ?? key;
  if (vars) for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
  return s;
}
const plural = (n, base, vars = {}) => tr(n === 0 && STR.en[base + '0'] ? base + '0' : n === 1 ? base + '1' : base + 'N', { n, ...vars });

function applyStatic() {
  document.documentElement.lang = lang();
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = tr(el.dataset.t); });
  document.querySelectorAll('[data-t-aria]').forEach(el => el.setAttribute('aria-label', tr(el.dataset.tAria)));
  document.querySelectorAll('[data-t-ph]').forEach(el => el.setAttribute('placeholder', tr(el.dataset.tPh)));
  document.querySelectorAll('[data-t-alt]').forEach(el => el.setAttribute('alt', tr(el.dataset.tAlt)));
  document.querySelectorAll('.lang__btn').forEach(b => b.classList.toggle('is-on', b.dataset.lang === lang()));
  $('lang-code').textContent = LANG_CODE[lang()];
  document.body.classList.toggle('lang-ko', lang() === 'ko');
}

/* ---------------------------------------------------------------- helpers */

const $ = id => document.getElementById(id);
const els = {
  feed: $('ph-feed'), grid: $('ph-grid'), status: $('ph-status'), sentinel: $('ph-sentinel'),
  tray: $('ph-tray'), who: $('ph-who'), whoInitial: $('ph-who-initial'), add: $('ph-add'), cta: $('ph-cta'),
  count: $('ph-count'), file: $('ph-file'),
  newBtn: $('ph-new'), me: $('ph-me'),
  nameDlg: $('ph-name-dlg'), nameForm: $('ph-name-form'), nameInput: $('ph-name-input'), nameCancel: $('ph-name-cancel'),
  composeDlg: $('ph-compose-dlg'), composeForm: $('ph-compose-form'), composeTitle: $('ph-compose-title'),
  previews: $('ph-previews'), caption: $('ph-caption'), composeCancel: $('ph-compose-cancel'),
  cmtDlg: $('ph-cmt-dlg'), cmts: $('ph-cmts'), cmtForm: $('ph-cmt-form'), cmtInput: $('ph-cmt-input'), cmtClose: $('ph-cmt-close')
};

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids) if (kid != null) el.append(kid);
  return el;
}

const ICON = {
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.3S3.5 14.6 3.5 8.9C3.5 6.2 5.6 4.3 8 4.3c1.8 0 3.2 1 4 2.4.8-1.4 2.2-2.4 4-2.4 2.4 0 4.5 1.9 4.5 4.6 0 5.7-8.5 11.4-8.5 11.4Z"/></svg>',
  bubble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4.5 19.5l1.3-4.3A7.5 7.5 0 1 1 20 11.5Z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>',
  stack: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="7.5" y="7.5" width="12" height="12" rx="1.8"/><path d="M4.5 16.5v-10a2 2 0 0 1 2-2h10"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7"/></svg>'
};

function imgUrl(p, t) {
  return `https://res.cloudinary.com/${CLOUD}/image/upload/${t}/f_auto,q_auto/v${p.version}/${p.publicId}`;
}

function timeAgo(date) {
  if (!date) return '';
  const s = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' });
  const a = Math.abs(s);
  if (a < 45) return rtf.format(0, 'second');
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day');
  return date.toLocaleDateString(lang(), { day: 'numeric', month: 'long' });
}

function toast(msg) {
  const t = h('div', { class: 'ph-toast', role: 'alert', text: msg });
  document.body.append(t);
  setTimeout(() => t.classList.add('is-out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

/* ---------------------------------------------------------------- state */

const state = {
  uid: null,
  admin: false,
  name: (() => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } })(),
  view: (() => { try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'feed'; } catch { return 'feed'; } })(),
  posts: new Map(),        // id -> data
  order: [],               // ids, newest first
  cards: new Map(),        // id -> { card, tile }
  cursor: null,            // last DocumentSnapshot from the paged read
  done: false,
  loading: false,
  newestAt: null,          // Timestamp of the newest post when the feed opened
  openPost: null,          // id whose comments sheet is open
  unsubCmts: null,
  uploads: 0,
  total: null              // number of posts, from one count query when the page opens
};

function renderCount() {
  els.count.textContent = state.total == null ? '–' : new Intl.NumberFormat(lang()).format(state.total);
}
function bumpCount(d) {
  if (state.total == null) return;
  state.total = Math.max(0, state.total + d);
  renderCount();
}

/* ---------------------------------------------------------------- name */

function renderWho() {
  els.whoInitial.textContent = state.name ? state.name.charAt(0).toUpperCase() : '';
  els.who.classList.toggle('is-unset', !state.name);
  els.who.setAttribute('aria-label', state.name ? tr('postingAs', { name: state.name }) : tr('setName'));
  els.who.title = els.who.getAttribute('aria-label');
}

function askName() {
  return new Promise(resolve => {
    els.nameInput.value = state.name;
    const done = ok => {
      els.nameForm.removeEventListener('submit', onSubmit);
      els.nameCancel.removeEventListener('click', onCancel);
      els.nameDlg.removeEventListener('cancel', onCancel);
      resolve(ok);
    };
    const onSubmit = e => {
      e.preventDefault();
      const v = els.nameInput.value.trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!v) { els.nameInput.focus(); return; }
      state.name = v;
      try { localStorage.setItem(NAME_KEY, v); } catch { /* private mode */ }
      renderWho();
      els.nameDlg.close();
      done(true);
    };
    const onCancel = () => { els.nameDlg.close(); done(false); };
    els.nameForm.addEventListener('submit', onSubmit);
    els.nameCancel.addEventListener('click', onCancel);
    els.nameDlg.addEventListener('cancel', onCancel);
    els.nameDlg.showModal();
    els.nameInput.focus();
  });
}

const ensureName = async () => state.name || (await askName());

/* ---------------------------------------------------------------- rendering */

/** Older posts carry one photo at the top level; newer ones a `photos` list. */
function photosOf(p) {
  return p.photos && p.photos.length ? p.photos : [{ publicId: p.publicId, version: p.version, w: p.w, h: p.h }];
}
function likeCount(p) { return Object.keys(p.likes || {}).length; }
function canDelete(uid) { return state.admin || (state.uid && uid === state.uid); }

function buildCard(id) {
  const p = state.posts.get(id);
  const photos = photosOf(p);
  // The first photo sets the frame, like Instagram; tall phone shots keep theirs, anything taller is cropped.
  const ratio = Math.min(photos[0].h / photos[0].w, 1.34);
  const initial = (p.name || '?').trim().charAt(0).toUpperCase();

  const slides = photos.map((ph, i) => h('img', {
    class: 'ph-car__img',
    alt: photos.length > 1 ? `${p.caption || p.name} (${i + 1}/${photos.length})` : (p.caption || p.name),
    loading: 'lazy', decoding: 'async', draggable: 'false',
    src: imgUrl(ph, 'c_limit,w_800'),
    srcset: [480, 800, 1200].map(w => `${imgUrl(ph, 'c_limit,w_' + w)} ${w}w`).join(', '),
    sizes: '(max-width: 600px) 100vw, 560px'
  }));
  const track = h('div', { class: 'ph-car' }, ...slides);
  const burst = h('span', { class: 'ph-burst', html: ICON.heart, 'aria-hidden': 'true' });
  const media = h('div', { class: 'ph-card__media', style: `aspect-ratio: 1 / ${ratio.toFixed(4)}` }, track, burst);
  let dots = null;
  if (photos.length > 1) {
    const counter = h('span', { class: 'ph-car__count', 'aria-hidden': 'true' });
    const prevBtn = h('button', { type: 'button', class: 'ph-car__arrow ph-car__arrow--prev', 'aria-label': tr('prev'), html: ICON.chevron });
    const nextBtn = h('button', { type: 'button', class: 'ph-car__arrow ph-car__arrow--next', 'aria-label': tr('next'), html: ICON.chevron });
    dots = h('div', { class: 'ph-car__dots', 'aria-hidden': 'true' }, ...photos.map(() => h('span')));
    media.append(counter, prevBtn, nextBtn);
    const go = dir => track.scrollBy({ left: dir * track.clientWidth, behavior: 'smooth' });
    // Arrow clicks must not count towards a double-tap like.
    prevBtn.addEventListener('click', e => { e.stopPropagation(); go(-1); });
    nextBtn.addEventListener('click', e => { e.stopPropagation(); go(1); });
    const sync = () => {
      const i = Math.max(0, Math.min(photos.length - 1, Math.round(track.scrollLeft / (track.clientWidth || 1))));
      counter.textContent = `${i + 1}/${photos.length}`;
      [...dots.children].forEach((d, k) => d.classList.toggle('is-on', k === i));
      prevBtn.hidden = i === 0;
      nextBtn.hidden = i === photos.length - 1;
    };
    track.addEventListener('scroll', sync, { passive: true });
    sync();
  }

  const del = canDelete(p.uid)
    ? h('button', { type: 'button', class: 'ph-card__del' },
        h('span', { html: ICON.trash }), h('span', { class: 'ph-card__del-label', text: tr('del') }))
    : null;

  const head = h('header', { class: 'ph-card__head' },
    h('span', { class: 'ph-avatar', 'aria-hidden': 'true', text: initial }),
    h('div', { class: 'ph-card__who' },
      h('div', { class: 'ph-card__name', text: p.name }),
      h('time', { class: 'ph-card__time' })),
    del);

  const likeBtn = h('button', { type: 'button', class: 'ph-icon-btn ph-like', html: ICON.heart });
  const cmtBtn = h('button', { type: 'button', class: 'ph-icon-btn ph-cmt-btn', 'aria-label': tr('comment'), html: ICON.bubble });
  const actions = h('div', { class: 'ph-card__actions' }, likeBtn, cmtBtn, dots);
  const likes = h('div', { class: 'ph-card__likes' });
  const caption = p.caption
    ? h('p', { class: 'ph-card__caption' }, h('strong', { text: p.name }), ' ', document.createTextNode(p.caption))
    : null;
  const cmtLink = h('button', { type: 'button', class: 'ph-card__cmts' });
  const recent = h('button', { type: 'button', class: 'ph-card__recent' });

  const card = h('article', { class: 'ph-card', 'data-id': id }, head, media, actions, likes, caption, cmtLink, recent);

  // Heart button and double-tap (or double-click) on the photo both toggle the like.
  const toggleLike = () => {
    const liked = !!(state.posts.get(id).likes || {})[state.uid];
    like(id, !liked);
    return !liked;
  };
  let lastTap = 0;
  media.addEventListener('click', () => {
    const now = Date.now();
    if (now - lastTap < 320) {
      lastTap = 0;
      if (toggleLike()) { pop(burst); pop(likeBtn); }
    } else lastTap = now;
  });
  likeBtn.addEventListener('click', () => { if (toggleLike()) pop(likeBtn); });
  cmtBtn.addEventListener('click', () => openComments(id, true));
  cmtLink.addEventListener('click', () => openComments(id, state.posts.get(id).commentCount === 0));
  recent.addEventListener('click', () => openComments(id, false));
  if (del) del.addEventListener('click', () => removePost(id));

  const tile = h('button', { type: 'button', class: 'ph-tile', 'aria-label': p.caption || p.name },
    h('img', { alt: '', loading: 'lazy', decoding: 'async', src: imgUrl(photos[0], 'c_fill,g_auto,w_400,h_400') }),
    photos.length > 1 ? h('span', { class: 'ph-tile__multi', html: ICON.stack, 'aria-hidden': 'true' }) : null);
  tile.addEventListener('click', () => {
    setView('feed');
    card.scrollIntoView({ block: 'start' });
  });

  state.cards.set(id, { card, tile });
  updateCard(id);
  return state.cards.get(id);
}

function updateCard(id) {
  const p = state.posts.get(id);
  const c = state.cards.get(id);
  if (!p || !c) return;
  const card = c.card;
  const n = likeCount(p);
  const liked = !!(p.likes || {})[state.uid];
  const likeBtn = card.querySelector('.ph-like');
  likeBtn.classList.toggle('is-on', liked);
  likeBtn.setAttribute('aria-pressed', liked ? 'true' : 'false');
  likeBtn.setAttribute('aria-label', tr('like'));
  card.querySelector('.ph-card__likes').textContent = plural(n, 'likes');
  const delLabel = card.querySelector('.ph-card__del-label');
  if (delLabel) delLabel.textContent = tr('del');
  card.querySelector('.ph-card__likes').classList.toggle('is-zero', n === 0);
  const count = p.commentCount || 0;
  const shown = (p.recent || []).slice(-PREVIEW);
  const link = card.querySelector('.ph-card__cmts');
  link.textContent = plural(count, 'cmts');
  // Hide "View all" when every comment is already previewed below it.
  link.hidden = count > 0 && count <= shown.length;
  const recent = card.querySelector('.ph-card__recent');
  recent.hidden = !shown.length;
  recent.replaceChildren(...shown.map(c =>
    h('span', { class: 'ph-card__recent-line' }, h('strong', { text: c.name }), ' ', document.createTextNode(c.text))));
  const time = card.querySelector('.ph-card__time');
  if (p.at) { time.textContent = timeAgo(p.at); time.dateTime = p.at.toISOString(); }
}

function refreshAll() {
  for (const id of state.order) updateCard(id);
  renderWho();
  renderCount();
  renderStatus();
}

function renderStatus(kind) {
  const s = els.status;
  s.replaceChildren();
  s.className = 'ph-status';
  if (kind === 'error') {
    const b = h('button', { type: 'button', class: 'ph-btn ph-btn--ghost', text: tr('retryLoad') });
    b.addEventListener('click', () => loadMore());
    s.append(h('p', { text: tr('error') }), b);
    return;
  }
  if (state.loading) { s.append(h('p', { class: 'ph-status__soft', text: tr('loading') })); return; }
  if (state.done && state.order.length === 0) { s.classList.add('is-empty'); s.append(h('p', { text: tr('empty') })); return; }
  if (state.done) s.append(h('p', { class: 'ph-status__soft', text: tr('end') }));
}

function toData(snap) {
  const d = snap.data({ serverTimestamps: 'estimate' });
  return { ...d, at: d.createdAt ? d.createdAt.toDate() : new Date() };
}

/** Insert or update a post. `top` puts brand-new posts first. */
function upsert(snap, top) {
  const id = snap.id;
  const data = toData(snap);
  const known = state.posts.has(id);
  state.posts.set(id, data);
  if (known) { updateCard(id); return; }
  const { card, tile } = buildCard(id);
  if (top) {
    state.order.unshift(id);
    els.feed.prepend(card);
    els.grid.prepend(tile);
    if (window.scrollY > 600) els.newBtn.hidden = false;
  } else {
    state.order.push(id);
    els.feed.append(card);
    els.grid.append(tile);
  }
}

function dropPost(id) {
  const c = state.cards.get(id);
  if (c) { c.card.remove(); c.tile.remove(); }
  state.cards.delete(id);
  state.posts.delete(id);
  state.order = state.order.filter(x => x !== id);
  renderStatus();
}

function setView(v) {
  state.view = v;
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ }
  els.feed.hidden = v !== 'feed';
  els.grid.hidden = v !== 'grid';
  document.querySelectorAll('.ph-view').forEach(b => {
    b.classList.toggle('is-on', b.dataset.view === v);
    b.setAttribute('aria-pressed', b.dataset.view === v ? 'true' : 'false');
  });
}

function pop(el) {
  el.classList.remove('is-pop');
  void el.offsetWidth;
  el.classList.add('is-pop');
}

/* ---------------------------------------------------------------- loading */

async function loadMore() {
  if (state.loading || state.done) return;
  state.loading = true;
  renderStatus();
  try {
    const q = state.cursor
      ? query(postsCol, orderBy('createdAt', 'desc'), startAfter(state.cursor), limit(PAGE))
      : query(postsCol, orderBy('createdAt', 'desc'), limit(PAGE));
    const snap = await getDocs(q);
    if (!state.cursor) {
      // A server time, never the phone's clock: a phone running fast would miss posts.
      state.newestAt = snap.docs[0] ? snap.docs[0].get('createdAt') : Timestamp.fromMillis(0);
      watchNew();
    }
    snap.docs.forEach(d => upsert(d, false));
    if (snap.docs.length) state.cursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE) state.done = true;
    state.loading = false;
    renderStatus();
    // Keep filling until the sentinel is off-screen (short first pages on tall screens).
    if (!state.done && nearBottom()) loadMore();
  } catch (err) {
    console.error(err);
    state.loading = false;
    renderStatus('error');
  }
}

function nearBottom() {
  return els.sentinel.getBoundingClientRect().top < window.innerHeight + 900;
}

/** Stream only posts newer than what the first page showed. */
function watchNew() {
  const q = query(postsCol, where('createdAt', '>', state.newestAt), orderBy('createdAt', 'desc'));
  onSnapshot(q, snap => {
    // Oldest first so each unshift leaves the newest on top.
    const changes = snap.docChanges().slice().reverse();
    for (const ch of changes) {
      if (ch.type === 'removed') { if (state.posts.has(ch.doc.id)) bumpCount(-1); dropPost(ch.doc.id); }
      else { if (ch.type === 'added' && !state.posts.has(ch.doc.id)) bumpCount(1); upsert(ch.doc, true); }
    }
    renderStatus();
  }, err => console.error(err));
}

/* ---------------------------------------------------------------- likes */

async function like(id, on) {
  if (!state.uid) return;
  const p = state.posts.get(id);
  if (!p) return;
  const had = !!(p.likes || {})[state.uid];
  if (had === on) return;
  const likes = { ...(p.likes || {}) };
  if (on) likes[state.uid] = true; else delete likes[state.uid];
  p.likes = likes;
  updateCard(id);
  try {
    await updateDoc(doc(db, 'posts', id), { ['likes.' + state.uid]: on ? true : deleteField() });
  } catch (err) {
    console.error(err);
    const back = { ...(p.likes || {}) };
    if (had) back[state.uid] = true; else delete back[state.uid];
    p.likes = back;
    updateCard(id);
    toast(tr('actionFailed'));
  }
}

async function removePost(id) {
  if (!confirm(tr('delPost'))) return;
  try {
    // The post and all its comments go together. The photos on Cloudinary are
    // removed by the hourly cleanup job (.github/workflows/cleanup.yml), which
    // holds the Cloudinary secret that a web page can't.
    const postRef = doc(db, 'posts', id);
    const cmts = await getDocs(collection(postRef, 'comments'));
    const b = writeBatch(db);
    cmts.docs.forEach(d => b.delete(d.ref));
    b.delete(postRef);
    await b.commit();
    if (state.posts.has(id)) bumpCount(-1);
    dropPost(id);
  } catch (err) {
    console.error(err);
    toast(tr('actionFailed'));
  }
}

/* ---------------------------------------------------------------- comments */

function openComments(id, focus) {
  state.openPost = id;
  els.cmts.replaceChildren(...[describe(id), h('li', { class: 'ph-cmts__empty', text: tr('loading') })].filter(Boolean));
  els.cmtInput.value = '';
  els.cmtDlg.showModal();
  if (focus) els.cmtInput.focus(); else els.cmtClose.focus();

  const q = query(collection(db, 'posts', id, 'comments'), orderBy('createdAt', 'asc'), limit(300));
  state.unsubCmts = onSnapshot(q, snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...toData(d) }));
    renderComments(id, list);
    // Keep the card's counter honest while the sheet is open.
    const p = state.posts.get(id);
    if (p && !snap.metadata.hasPendingWrites) {
      p.commentCount = list.length;
      p.recent = toRecent(list);
      updateCard(id);
    }
  }, err => {
    console.error(err);
    els.cmts.replaceChildren(h('li', { class: 'ph-cmts__empty', text: tr('error') }));
  });
}

const toRecent = list => list.slice(-PREVIEW).map(c => ({ id: c.id, uid: c.uid, name: c.name, text: c.text }));

/** The post's caption, shown above the comments as its description. */
function describe(postId) {
  const p = state.posts.get(postId);
  if (!p || !p.caption) return null;
  return h('li', { class: 'ph-desc' },
    h('span', { class: 'ph-avatar ph-avatar--sm', 'aria-hidden': 'true', text: (p.name || '?').charAt(0).toUpperCase() }),
    h('div', { class: 'ph-cmt__body' },
      h('p', {}, h('strong', { text: p.name }), ' ', document.createTextNode(p.caption)),
      h('div', { class: 'ph-cmt__meta' }, h('time', { class: 'ph-cmt__time', text: timeAgo(p.at) }))));
}

function renderComments(postId, list) {
  state.cmtList = list;
  const desc = describe(postId);
  if (!list.length) {
    els.cmts.replaceChildren(...[desc, h('li', { class: 'ph-cmts__empty', text: tr('noComments') })].filter(Boolean));
    return;
  }
  const wasAtBottom = els.cmts.scrollHeight - els.cmts.scrollTop - els.cmts.clientHeight < 40;
  els.cmts.replaceChildren(...[desc].filter(Boolean), ...list.map(c => {
    const del = canDelete(c.uid)
      ? h('button', { type: 'button', class: 'ph-cmt__del', text: tr('del') })
      : null;
    if (del) del.addEventListener('click', () => removeComment(postId, c.id));
    return h('li', { class: 'ph-cmt' },
      h('span', { class: 'ph-avatar ph-avatar--sm', 'aria-hidden': 'true', text: (c.name || '?').charAt(0).toUpperCase() }),
      h('div', { class: 'ph-cmt__body' },
        h('p', {}, h('strong', { text: c.name }), ' ', document.createTextNode(c.text)),
        h('div', { class: 'ph-cmt__meta' }, h('time', { class: 'ph-cmt__time', text: timeAgo(c.at) }), del)));
  }));
  if (wasAtBottom) els.cmts.scrollTop = els.cmts.scrollHeight;
}

function closeComments() {
  if (state.unsubCmts) state.unsubCmts();
  state.unsubCmts = null;
  state.openPost = null;
  state.cmtList = null;
  if (els.cmtDlg.open) els.cmtDlg.close();
}

async function sendComment(e) {
  e.preventDefault();
  const id = state.openPost;
  const text = els.cmtInput.value.trim().slice(0, 500);
  if (!id || !text || !state.uid) return;
  if (!(await ensureName())) return;
  const postRef = doc(db, 'posts', id);
  const cmtRef = doc(collection(postRef, 'comments'));
  const entry = { id: cmtRef.id, uid: state.uid, name: state.name, text };
  els.cmtInput.value = '';
  try {
    const after = await runTransaction(db, async tx => {
      const cur = (await tx.get(postRef)).data();
      const next = { commentCount: (cur.commentCount || 0) + 1, recent: [...(cur.recent || []), entry].slice(-PREVIEW) };
      tx.set(cmtRef, { uid: state.uid, name: state.name, text, createdAt: serverTimestamp() });
      tx.update(postRef, next);
      return next;
    });
    const p = state.posts.get(id);
    if (p) { Object.assign(p, after); updateCard(id); }
    els.cmts.scrollTop = els.cmts.scrollHeight;
  } catch (err) {
    console.error(err);
    els.cmtInput.value = text;
    toast(tr('actionFailed'));
  }
}

async function removeComment(postId, commentId) {
  if (!confirm(tr('delComment'))) return;
  const postRef = doc(db, 'posts', postId);
  const recent = toRecent((state.cmtList || []).filter(c => c.id !== commentId));
  try {
    const after = await runTransaction(db, async tx => {
      const cur = (await tx.get(postRef)).data();
      const next = { commentCount: Math.max(0, (cur.commentCount || 1) - 1), recent };
      tx.delete(doc(postRef, 'comments', commentId));
      tx.update(postRef, next);
      return next;
    });
    const p = state.posts.get(postId);
    if (p) { Object.assign(p, after); updateCard(postId); }
  } catch (err) {
    console.error(err);
    toast(tr('actionFailed'));
  }
}

/* ---------------------------------------------------------------- uploading */

let picked = [];

async function startAdd() {
  if (!(await ensureName())) return;
  els.file.value = '';
  els.file.click();
}

function openCompose(files) {
  picked = files;
  els.composeTitle.textContent = (files.length === 1 ? tr('photos1') : tr('photosN', { n: files.length }))
    + ' · ' + tr('postingAs', { name: state.name });
  els.previews.replaceChildren(...files.map(f => {
    const url = URL.createObjectURL(f);
    const img = h('img', { alt: '', src: url });
    img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    img.addEventListener('error', () => { URL.revokeObjectURL(url); img.replaceWith(h('span', { class: 'ph-previews__blank', html: ICON.heart })); }, { once: true });
    return img;
  }));
  els.caption.value = '';
  els.composeDlg.showModal();
}

/** Downscale to MAX_EDGE and re-encode as JPEG. This also drops EXIF, so no
    GPS location leaves the phone. Falls back to the original file if the
    browser can't decode it (e.g. HEIC on Android) — Cloudinary converts it. */
async function prepare(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const k = Math.min(1, MAX_EDGE / Math.max(w0, h0));
    const w = Math.round(w0 * k), hh = Math.round(h0 * k);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hh;
    canvas.getContext('2d').drawImage(img, 0, 0, w, hh);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.86));
    return blob || file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function uploadToCloudinary(blob, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', blob, 'photo.jpg');
    fd.append('upload_preset', PRESET);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && res.public_id) resolve(res);
        else reject(new Error((res.error && res.error.message) || 'HTTP ' + xhr.status));
      } catch (e) { reject(e); }
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.send(fd);
  });
}

function trayItem(file, count) {
  const thumbUrl = URL.createObjectURL(file);
  const thumb = h('img', { alt: '', src: thumbUrl });
  thumb.addEventListener('error', () => thumb.replaceWith(h('span', { class: 'ph-previews__blank' })), { once: true });
  const uploadingText = () => count > 1 ? tr('uploading') + ' · ' + tr('photosN', { n: count }) : tr('uploading');
  const label = h('span', { class: 'ph-tray__label', text: uploadingText() });
  const bar = h('span', { class: 'ph-tray__bar' }, h('span', { class: 'ph-tray__fill' }));
  const retry = h('button', { type: 'button', class: 'ph-btn ph-btn--ghost ph-btn--sm', text: tr('retry'), hidden: true });
  const row = h('div', { class: 'ph-tray__item' }, thumb, h('div', { class: 'ph-tray__info' }, label, bar), retry);
  els.tray.append(row);
  els.tray.hidden = false;
  return {
    row, retry,
    progress(f) { row.querySelector('.ph-tray__fill').style.width = Math.round(f * 100) + '%'; },
    fail() { row.classList.add('is-failed'); label.textContent = tr('failed'); retry.hidden = false; },
    reset() { row.classList.remove('is-failed'); label.textContent = uploadingText(); retry.hidden = true; this.progress(0); },
    ok() {
      row.classList.add('is-done');
      label.textContent = tr('done');
      this.progress(1);
      setTimeout(() => { row.remove(); URL.revokeObjectURL(thumbUrl); if (!els.tray.children.length) els.tray.hidden = true; }, 1800);
    }
  };
}

/** Upload every photo of one post, then create the post. `done` keeps the
    photos that already made it, so Retry only resends the ones that failed. */
async function uploadPost(files, caption, item, done = []) {
  state.uploads++;
  // The hourly cleanup removes photos no post uses once they're 2 h old, so a
  // Retry much later re-sends everything rather than trusting old uploads.
  done.at = done.at || [];
  done.forEach((_, i) => { if (Date.now() - (done.at[i] || 0) > 3600e3) delete done[i]; });
  const frac = files.map((_, i) => (done[i] ? 1 : 0));
  const tick = () => item.progress(0.02 + 0.93 * frac.reduce((a, b) => a + b, 0) / files.length);
  tick();
  try {
    // Two at a time: quick on good wifi, gentle on a weak signal.
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const i = next++;
        if (done[i]) continue;
        const blob = await prepare(files[i]);
        const res = await uploadToCloudinary(blob, f => { frac[i] = f; tick(); });
        done[i] = { publicId: res.public_id, version: res.version, w: res.width, h: res.height };
        done.at[i] = Date.now();
        frac[i] = 1; tick();
      }
    };
    await Promise.all([worker(), worker()]);
    const photos = done.slice(0, files.length);
    await addDoc(postsCol, {
      uid: state.uid,
      name: state.name,
      caption,
      ...photos[0],               // the first photo also at the top level, for older readers
      photos,
      createdAt: serverTimestamp(),
      likes: {},
      commentCount: 0
    });
    item.ok();
  } catch (err) {
    console.error(err);
    item.fail();
    item.retry.onclick = () => { item.reset(); uploadPost(files, caption, item, done); };
  } finally {
    state.uploads--;
  }
}

async function share(e) {
  e.preventDefault();
  const files = picked;
  const caption = els.caption.value.trim().slice(0, 300);
  picked = [];
  els.composeDlg.close();
  if (!files.length) return;
  window.scrollTo({ top: els.tray.offsetTop - 80, behavior: 'smooth' });
  await uploadPost(files, caption, trayItem(files[0], files.length));
}

/* ---------------------------------------------------------------- wiring */

function wire() {
  els.who.addEventListener('click', () => askName());
  // Tapping the tab you're already on jumps back to the top, like Instagram.
  document.querySelectorAll('.ph-view').forEach(b => b.addEventListener('click', () => {
    const top = document.querySelector('.tabs').getBoundingClientRect().top + window.scrollY - 56;
    if (b.dataset.view === state.view || b.closest('.dock')) window.scrollTo({ top: window.scrollY > top ? top : window.scrollY, behavior: 'smooth' });
    setView(b.dataset.view);
  }));
  els.add.addEventListener('click', startAdd);
  els.cta.addEventListener('click', startAdd);
  // Profile photo opens full size; any tap closes it.
  const viewer = $('viewer');
  $('ring').addEventListener('click', () => viewer.showModal());
  viewer.addEventListener('click', () => viewer.close());
  document.querySelectorAll('.lang__btn').forEach(b => b.addEventListener('click', () => { setLang(b.dataset.lang); $('lang').open = false; }));
  document.addEventListener('click', e => { if (!e.target.closest('#lang')) $('lang').open = false; });
  els.file.addEventListener('change', () => {
    const files = [...els.file.files].filter(f => !f.type || f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (files.length) openCompose(files.slice(0, MAX_PHOTOS));
  });
  els.composeForm.addEventListener('submit', share);
  els.composeCancel.addEventListener('click', () => { picked = []; els.composeDlg.close(); });
  els.cmtForm.addEventListener('submit', sendComment);
  els.cmtClose.addEventListener('click', closeComments);
  els.cmtDlg.addEventListener('close', closeComments);
  // Tap the dim backdrop to dismiss the comments sheet.
  els.cmtDlg.addEventListener('click', e => { if (e.target === els.cmtDlg) closeComments(); });
  els.newBtn.addEventListener('click', () => { els.newBtn.hidden = true; window.scrollTo({ top: 0, behavior: 'smooth' }); });
  window.addEventListener('scroll', () => { if (window.scrollY < 300) els.newBtn.hidden = true; }, { passive: true });
  window.addEventListener('beforeunload', e => { if (state.uploads > 0) { e.preventDefault(); e.returnValue = ''; } });

  new IntersectionObserver(entries => {
    if (entries.some(en => en.isIntersecting)) loadMore();
  }, { rootMargin: '900px 0px' }).observe(els.sentinel);

  setInterval(() => { for (const id of state.order) updateCard(id); }, 60000);
}

applyStatic();
renderWho();
setView(state.view);
wire();
state.loading = true;
renderStatus();

onAuthStateChanged(auth, async user => {
  if (!user) {
    signInAnonymously(auth).catch(err => { console.error(err); state.loading = false; renderStatus('error'); });
    return;
  }
  if (state.uid) return;
  state.uid = user.uid;
  if (new URLSearchParams(location.search).has('me')) {
    els.me.hidden = false;
    els.me.replaceChildren(h('span', { text: tr('deviceId') + ': ' }), h('code', { text: user.uid }));
  }
  try { state.admin = (await getDoc(doc(db, 'admins', user.uid))).exists(); } catch { state.admin = false; }
  getCountFromServer(postsCol).then(c => { state.total = c.data().count; renderCount(); }).catch(err => console.error(err));
  state.loading = false;
  loadMore();
});

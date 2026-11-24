// nalidagame.online accounts, progress and leaderboard (build flag VITE_NG_PLATFORM=1).
// With the flag off, PLATFORM is the literal `false` after Vite's env replacement, every call site in
// main.ts is dead code, and nothing here is bundled or run: no network, today's flow.
//
// Server copy for game 'dronedeliver' (NalidaGame apps/api/src/games/dronedeliver.js):
//   progress = { unlocked: 1..4, best: { "1"?: int, ... "4"?: int } }   GET -> {data, progressAt, revision}
//   PUT {data, progressAt, baseRevision}: compare-and-swap on revision, 409 stale_progress {data, progressAt, revision}
//   when stale. 'unlocked' is derived by the server from cleared plays: the client's value is only a claim, and the
//   data the server returns is always adopted. Plays rejected with a 4xx (implausible_score, stage_locked, ...) are dropped.
//   play     = { stage: "1".."4", score, cleared, durationSec, detail: { delivered, perfect, good, missed, expired, crashes } }
// Nicknames come from the API and are untrusted: they only ever reach the DOM through textContent.

export const PLATFORM = import.meta.env.VITE_NG_PLATFORM === '1';
const GAME_ID = 'dronedeliver';
const trimSlash = (url: string) => url.replace(/\/+$/, '');
const API = /* @__PURE__ */ trimSlash(import.meta.env.VITE_NG_API || 'https://api.nalidagame.online');
const PORTAL = /* @__PURE__ */ trimSlash(import.meta.env.VITE_NG_PORTAL || 'https://nalidagame.online');
const LOGIN_URL = `${PORTAL}/login`;
const NICKNAME_URL = `${PORTAL}/nickname`;
const TIMEOUT = 8000;
const STAGE_COUNT = 4;

type StageKey = '1' | '2' | '3' | '4';
export type Progress = { unlocked: number; best: Partial<Record<StageKey, number>> };
export type ShiftResult = {
  stage: number; score: number; cleared: boolean; durationSec: number;
  detail: { delivered: number; perfect: number; good: number; missed: number; expired: number; crashes: number };
};
type User = { id: string; loginId: string; nickname: string | null };
type Saved = { data: unknown; progressAt?: number; revision?: unknown };
type PutResult = Saved & { conflict: boolean };
type Play = Omit<ShiftResult, 'stage'> & { stage: string };
type Outcome = string | [string, boolean?];
type BoardEntry = { rank?: unknown; nickname?: unknown; score?: unknown; stage?: unknown; me?: unknown };
type Sdk = {
  me(): Promise<User | null>;
  redirectToLogin(): void;
  redirectToNickname(): void;
  plays: { submit(play: Play): Promise<{ newBest?: boolean; best?: unknown; rank?: unknown }> };
  leaderboard(q: { limit: number }): Promise<{ entries: BoardEntry[]; me: BoardEntry | null }>;
  onChange(cb: (u: User | null) => void): void;
};
type SdkGlobal = { init(opts: { gameId: string; apiBase: string; loginUrl: string; nicknameUrl: string }): Sdk };
type ApiError = Error & { status?: number; code?: string; data?: Saved & { error?: string } };

/** What the screens in main.ts give this module: render a card (innerHTML of trusted static markup) and bind a button. */
export type Ui = { show(html: string, extraClass?: string): HTMLElement; bind(id: string, fn: () => void): void };

let sdk: Sdk | null = null;
let user: User | null = null;
let lost: '' | 'expired' | 'switched' = '';
let locked = false; // another tab of this account took over; this one stays read-only until the player takes it back
let progress: Progress = { unlocked: 1, best: {} };
let confirmed: Progress = { unlocked: 1, best: {} }; // the last copy the server vouched for
let revision: number | null = null; // the server's progress revision we last saw (null: old API without revisions)

/** main.ts hooks: progress changed from the server (refresh the stage buttons), this tab was locked (stop the shift). */
export const platformHooks = { onProgress: () => {}, onLock: () => {} };

const int = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.floor(Number(v)));
const err = (code: string): ApiError => Object.assign(new Error(code), { code });

function timed<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(err('network')), TIMEOUT))]);
}

function cleanProgress(raw: unknown): Progress {
  const d = (raw && typeof raw === 'object' ? raw : {}) as { unlocked?: unknown; best?: unknown };
  const best: Progress['best'] = {};
  const b = (d.best && typeof d.best === 'object' ? d.best : {}) as Record<string, unknown>;
  for (let i = 1; i <= STAGE_COUNT; i++) {
    const n = int(b[String(i)]);
    if (n != null && n > 0) best[String(i) as StageKey] = n;
  }
  return { unlocked: Math.min(STAGE_COUNT, Math.max(1, int(d.unlocked) ?? 1)), best };
}

/** Best per stage = max of both; 'unlocked' is the server's, except what a cleared play still waiting to be posted claims. */
function mergeServer(local: Progress, server: Progress): Progress {
  const best: Progress['best'] = { ...local.best };
  for (const [k, v] of Object.entries(server.best) as [StageKey, number][]) best[k] = Math.max(best[k] ?? 0, v);
  return { unlocked: Math.max(server.unlocked, claimedUnlock()), best };
}
const claimedUnlock = () => pending.reduce((n, q) => (q.play.cleared ? Math.max(n, Math.min(STAGE_COUNT, Number(q.play.stage) + 1)) : n), 1);

function toast(text: string) {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.textContent = text;
  Object.assign(el.style, { position: 'fixed', left: '50%', top: '16px', transform: 'translateX(-50%)', zIndex: '1000', maxWidth: '90vw', padding: '10px 16px',
    background: 'rgba(10,20,30,0.94)', color: '#fff', border: '1px solid #4ea1ff', borderRadius: '8px', font: '14px sans-serif', pointerEvents: 'none' });
  document.body.append(el);
  setTimeout(() => el.remove(), 5000);
}

// Progress goes through fetch here (not sdk.progress) because the SDK drops baseRevision and the revision of a 409.
async function api(method: 'GET' | 'PUT', body?: unknown): Promise<{ status: number; data: Saved & { error?: string } }> {
  const init: RequestInit = { method, credentials: 'include', headers: {} };
  if (method === 'PUT') {
    Object.assign(init.headers!, { 'Content-Type': 'application/json', 'X-NG-User': user!.id });
    init.body = JSON.stringify(body);
  }
  const res = await timed(fetch(`${API}/v1/games/${GAME_ID}/progress`, init).catch(() => Promise.reject(err('network'))));
  const data = (await res.json().catch(() => ({}))) as Saved & { error?: string };
  if (res.ok || (res.status === 409 && data.error === 'stale_progress')) return { status: res.status, data };
  throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, code: data.error, data });
}
const getProgress = async (): Promise<Saved> => (await api('GET')).data;
const revOf = (s: Saved) => { const n = int(s.revision); return n != null && n >= 0 ? n : null; };
async function putProgressOnce(baseRevision: number | null, progressAt: number): Promise<PutResult> {
  const r = await api('PUT', { data: progress, progressAt, ...(baseRevision != null ? { baseRevision } : {}) });
  return { ...r.data, conflict: r.status === 409 };
}

// ------------------------------------------------------------ gate

const GATE: Record<string, [string, string, string?]> = {
  check: ['로그인 확인 중', 'nalidagame.online 계정을 확인하고 있습니다.'],
  login: ['로그인이 필요합니다', '하늘길 택배는 nalidagame.online 계정으로 플레이합니다. 로그인하면 진행 상황과 랭킹이 저장됩니다.', '로그인'],
  nickname: ['닉네임 설정이 필요합니다', 'nalidagame.online 에서 닉네임을 정하면 게임으로 돌아옵니다.', '닉네임 설정'],
  expired: ['로그인이 만료되었습니다', '다시 로그인하면 이어서 플레이할 수 있습니다.', '다시 로그인'],
  locked: ['다른 탭에서 플레이 중입니다', '같은 계정으로 다른 탭에서 게임을 열어 이 탭은 잠겼습니다. 두 곳에서 저장하면 진행도가 서로 덮어써질 수 있습니다.', '이 탭에서 이어서 하기'],
  switched: ['다른 계정으로 로그인되었습니다', '다른 탭에서 계정이 바뀌었습니다. 새로고침하면 지금 계정으로 이어서 플레이합니다.', '새로고침'],
  down: ['서버에 연결할 수 없습니다', '게임 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', '다시 시도'],
};

let ui: Ui;
let onReady: () => void = () => {};

const withNext = (url: string) => `${url}?next=${encodeURIComponent(location.href)}`;
const goLogin = () => (sdk ? sdk.redirectToLogin() : location.assign(withNext(LOGIN_URL)));
const goNickname = () => (sdk ? sdk.redirectToNickname() : location.assign(withNext(NICKNAME_URL)));

function showGate(state: keyof typeof GATE) {
  const [title, msg, action] = GATE[state];
  const card = ui.show(`<div class="logo">하늘길 택배 · nalidagame.online</div><h1></h1><p></p>
    ${action ? '<div class="btns"><button class="primary" id="b-gate"></button></div>' : ''}`, 'ng-gate');
  card.querySelector('h1')!.textContent = title;
  card.querySelector('p')!.textContent = msg;
  if (!action) return;
  card.querySelector('#b-gate')!.textContent = action;
  ui.bind('b-gate', () => {
    if (state === 'nickname') goNickname();
    else if (state === 'switched') location.reload();
    else if (state === 'locked') void takeOver();
    else if (state === 'down') void attempt();
    else goLogin();
  });
}

function loadSdk(): Promise<SdkGlobal> {
  const w = window as unknown as { NalidaGame?: SdkGlobal };
  if (w.NalidaGame) return Promise.resolve(w.NalidaGame);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${API}/sdk/nalidagame.js`;
    s.onload = () => (w.NalidaGame ? resolve(w.NalidaGame) : reject(err('network')));
    s.onerror = () => { s.remove(); reject(err('network')); };
    document.head.append(s);
  });
}

async function attempt() {
  showGate('check');
  try {
    sdk = sdk ?? (await timed(loadSdk())).init({ gameId: GAME_ID, apiBase: API, loginUrl: LOGIN_URL, nicknameUrl: NICKNAME_URL });
    const me = await timed(sdk.me());
    if (!me) return showGate('login');
    if (!me.nickname) return showGate('nickname');
    user = me;
    const saved = await getProgress();
    progress = confirmed = cleanProgress(saved.data);
    revision = revOf(saved);
    sdk.onChange((u) => {
      if (!user) return;
      if (!u) lost = 'expired';
      else if (u.id !== user.id) lost = 'switched';
      else user = u;
    });
    // Another tab may have logged out or switched accounts while this one was hidden.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !user) return;
      timed(sdk!.me()).catch(() => {});
      void refreshProgress(); // another device or tab may have saved while this one was hidden
    });
    startTabGuard();
    onReady();
  } catch (e) {
    console.error('nalidagame gate', e);
    showGate('down');
  }
}

/** Before the title screen: no session (or no nickname), no game. Calls `ready` once logged in with progress loaded. */
export function bootPlatform(screens: Ui, ready: () => void) {
  ui = screens;
  onReady = ready;
  void attempt();
}

/** False (and the gate is shown) once the session expired or another account logged in on the shared cookie. */
export function sessionOk(): boolean {
  if (!lost && !locked) return true;
  showGate(lost || 'locked');
  return false;
}

// ------------------------------------------------------------ two tabs, one account

// The newest tab wins: opening the game (or taking over) claims the account on a BroadcastChannel and any older
// tab locks itself. Different devices cannot see each other here; the progress revision covers those.
const tabId = Math.random().toString(36).slice(2);
let claimAt = 0;
let channel: BroadcastChannel | null = null;
function claim() {
  claimAt = Date.now();
  channel?.postMessage({ type: 'claim', id: tabId, at: claimAt });
}
function startTabGuard() {
  if (typeof BroadcastChannel === 'undefined' || !user) return;
  channel = new BroadcastChannel(`ng-dronedeliver-${user.id}`);
  channel.onmessage = (ev: MessageEvent) => {
    const m = ev.data as { type?: string; id?: string; at?: number } | null;
    if (!m || m.type !== 'claim' || m.id === tabId || locked) return;
    const at = Number(m.at) || 0;
    if (at < claimAt || (at === claimAt && String(m.id) < tabId)) return; // we claimed later
    locked = true;
    platformHooks.onLock();
  };
  claim();
}
async function takeOver() {
  locked = false;
  claim();
  await refreshProgress();
  onReady();
}

export const nickname = () => user?.nickname ?? '';
export const stageUnlocked = (id: number) => id <= progress.unlocked;

// ------------------------------------------------------------ after a shift

/** The result screen's platform line; main.ts re-renders it from here and listens for changes. */
export const shiftStatus = { text: '', nicknameButton: false, onChange: () => {} };
function setStatus(text: string, nicknameButton = false) {
  shiftStatus.text = text;
  shiftStatus.nicknameButton = nicknameButton;
  shiftStatus.onChange();
}

let saveRetry = 0;
let saveWait = 0;
let rev = 0; // bumped on every local progress change
let savedRev = 0; // the revision the server has
let saveQueue: Promise<unknown> = /* @__PURE__ */ Promise.resolve();

// Saves run one at a time, so an older reply can never mark newer progress as saved.
function saveProgress(): Promise<void> {
  const run = saveQueue.then(putProgress);
  saveQueue = run.catch(() => {});
  return run;
}

/** Take the server's copy: wholesale when nothing local is unsaved, merged (best = max) otherwise. */
function adopt(saved: Saved, keepLocal: boolean): boolean {
  const server = cleanProgress(saved.data);
  confirmed = server;
  const before = JSON.stringify(progress);
  progress = keepLocal ? mergeServer(progress, server) : { unlocked: Math.max(server.unlocked, claimedUnlock()), best: server.best };
  revision = revOf(saved) ?? revision;
  const changed = JSON.stringify(progress) !== before;
  if (changed) platformHooks.onProgress();
  return changed;
}

const MERGED_NOTICE = '다른 기기에서 저장된 진행도를 불러와 합쳤어요.';

// Post queued plays first (the server derives 'unlocked' from cleared plays), fetch the server copy and merge it
// (another tab or device may have saved since we loaded), then PUT with baseRevision. A 409 stale_progress returns
// the newer server copy: merge, adopt its revision, retry once. A second conflict counts as a failed save.
async function putProgress(): Promise<void> {
  clearTimeout(saveRetry);
  if (!sdk || !user || lost || locked || rev === savedRev) return;
  const sending = rev;
  try {
    await flushPlays();
    // Plays still waiting (offline / 5xx) are unproven: keep the save dirty and retry rather than store their scores.
    if (pending.length) throw err('network');
    const cur = await getProgress();
    stillOurs();
    const known = revision;
    const others = known != null && revOf(cur) != null && revOf(cur) !== known;
    adopt(cur, true); // unsaved local changes are about to be sent: merge, never replace
    let notify = others;
    stillOurs();
    let r = await putProgressOnce(revision, Math.max(Date.now(), (Number(cur.progressAt) || 0) + 1));
    if (r.conflict) {
      notify = true;
      adopt(r, true);
      stillOurs();
      r = await putProgressOnce(revision, Math.max(Date.now(), (Number(r.progressAt) || 0) + 1));
    }
    if (r.conflict) {
      adopt(r, true);
      throw err('conflict');
    }
    adopt(r, rev !== sending); // the server's cleaned copy wins unless the player progressed meanwhile
    savedRev = sending;
    saveWait = 0;
    if (notify) toast(MERGED_NOTICE);
  } catch (e) {
    const x = e as ApiError;
    if (x.code === 'user_mismatch') lost = 'switched';
    else if (x.status === 401) lost = 'expired';
    else if (x.code === 'locked') { /* another tab took over mid-save: nothing more to send; take-over re-saves */ }
    else if (x.code === 'network' || x.code === 'conflict') {
      // Unreachable or busy: keep the progress in memory and retry 15 s, 30 s, ... up to 5 min (also sent with the next shift).
      saveWait = Math.min(300_000, saveWait * 2 || 15_000);
      saveRetry = window.setTimeout(() => void saveProgress().catch(() => {}), saveWait);
    } else console.error('progress save failed', x);
    throw x;
  }
}

/** Another tab may have claimed the account while a request was in flight: send nothing more from this one. */
function stillOurs() {
  if (locked) throw err('locked');
}

/** Re-read the server copy (tab became visible again, take-over, rejected play) and show what changed. */
function refreshProgress(): Promise<void> {
  const run = saveQueue.then(async () => {
    if (!sdk || !user || lost || locked) return;
    await flushPlays();
    const cur = await getProgress();
    const other = revision != null && revOf(cur) != null && revOf(cur) !== revision;
    if (adopt(cur, rev !== savedRev) && other) toast(MERGED_NOTICE);
    if (rev !== savedRev) void saveProgress().catch(() => {});
  }).catch((e: ApiError) => { if (e.status === 401) lost = 'expired'; });
  saveQueue = run;
  return run;
}

// ------------------------------------------------------------ plays

function playError(e: ApiError): Outcome {
  if (e.code === 'nickname_required') return ['랭킹에 올리려면 nalidagame.online 에서 닉네임을 정해야 합니다.', true];
  if (e.code === 'user_mismatch') return ['다른 계정으로 로그인되어 기록을 올리지 않았습니다. 새로고침해 주세요.'];
  if (e.status === 401) return ['로그인이 만료되어 기록을 올리지 못했습니다. 타이틀에서 다시 로그인해 주세요.'];
  if (e.status === 429) return ['기록 제출이 너무 잦습니다. 잠시 후 다시 플레이해 주세요.'];
  if (e.code === 'implausible_score') return ['점수가 비정상적이라 이 기록은 랭킹에 반영되지 않았습니다.'];
  if (e.code === 'stage_locked') return ['아직 열리지 않은 스테이지라 기록을 올리지 못했습니다.'];
  if (e.status && e.status >= 400 && e.status < 500) return ['이 기록은 랭킹에 반영되지 않았습니다.'];
  if (e.code === 'network') return ['서버에 연결하지 못해 랭킹에 올리지 못했습니다.'];
  return ['기록을 올리지 못했습니다.'];
}

// Plays that could not reach the server (offline, 5xx) wait here, in order, and go out before the next progress
// save. Any 4xx is final: the play is dropped, never retried. In memory only.
type Queued = { play: Play; done: (o: Outcome) => void };
const pending: Queued[] = [];
const MAX_PENDING = 20;
let flushing: Promise<void> = /* @__PURE__ */ Promise.resolve();

function playText(res: { newBest?: boolean; best?: unknown; rank?: unknown }): string {
  const rank = int(res.rank);
  const top = int(res.best);
  return `${res.newBest ? '새 최고 기록! ' : ''}${rank != null ? `랭킹 ${rank}위` : '랭킹 반영'}${top != null ? ` · 최고 ${top}점` : ''}`;
}

function submitPlay(play: Play): Promise<Outcome> {
  return new Promise((resolve) => {
    pending.push({ play, done: resolve });
    while (pending.length > MAX_PENDING) pending.shift()!.done(['기록을 올리지 못했습니다.']);
    void flushPlays();
  });
}

function flushPlays(): Promise<void> {
  flushing = flushing.then(drain);
  return flushing;
}

// A rejected play must not leave its score or unlock in the local progress (it would be sent with the next save).
function dropClaim(play: Play) {
  const k = play.stage as StageKey;
  const best = { ...progress.best };
  if (best[k] === play.score) {
    if (confirmed.best[k] != null) best[k] = confirmed.best[k];
    else delete best[k];
  }
  progress = { unlocked: Math.max(confirmed.unlocked, claimedUnlock()), best };
  platformHooks.onProgress();
}

async function drain() {
  while (pending.length && sdk && user && !lost && !locked) {
    const q = pending[0];
    try {
      const res = await timed(sdk.plays.submit(q.play));
      pending.shift();
      q.done(playText(res));
    } catch (e) {
      const x = e as ApiError;
      if (x.code === 'user_mismatch' || x.status === 401) {
        if (x.code === 'user_mismatch') lost = 'switched';
        for (const p of pending.splice(0)) p.done(playError(x));
        return;
      }
      if (x.code === 'network' || (x.status != null && x.status >= 500)) {
        // Stays queued; whoever waits on an answer gets the failure now.
        for (const p of pending) { p.done(playError(x)); p.done = () => {}; }
        return;
      }
      pending.shift();
      dropClaim(q.play);
      q.done(playError(x));
      if (x.code === 'stage_locked') void refreshProgress();
    }
  }
  for (const p of pending.splice(0)) p.done(['기록을 올리지 못했습니다.']);
}

/** Every finished shift (clear or fail): update progress locally, post the play, then save progress. Never throws. */
export function recordShift(r: ShiftResult) {
  const key = String(r.stage) as StageKey;
  const score = Math.max(0, Math.floor(r.score));
  const best: Progress['best'] = { ...progress.best };
  if (score > (best[key] ?? 0)) best[key] = score;
  const unlocked = r.cleared ? Math.max(progress.unlocked, Math.min(STAGE_COUNT, r.stage + 1)) : progress.unlocked;
  if (unlocked !== progress.unlocked || best[key] !== progress.best[key]) rev++;
  progress = { unlocked, best };
  if (locked) return setStatus('다른 탭에서 플레이 중이라 기록을 저장하지 못했습니다.');
  if (!sdk || !user || lost) return setStatus('로그인이 끊겨 기록을 저장하지 못했습니다.');
  setStatus('기록 저장 중…');
  const posted = submitPlay({ ...r, stage: key, score, durationSec: Math.round(r.durationSec) });
  // The play goes first so the server's 'unlocked' has caught up when progress is written.
  const saved = posted.then(() => saveProgress()).then(() => true, () => false);
  void Promise.all([saved, posted]).then(([ok, p]) => {
    const [text, nick] = typeof p === 'string' ? [p] : p;
    setStatus(ok ? text : `${text} 진행 상황은 아직 저장되지 않았습니다.`, nick === true);
  });
}

export const openNicknamePage = goNickname;

// ------------------------------------------------------------ leaderboard

/** Top 20 + the player's own row. Numbers are coerced to integers, nicknames go in as text only. */
export function showLeaderboard(back: () => void) {
  if (!sdk || !sessionOk()) return;
  const card = ui.show(`<h2>랭킹</h2><h1>하늘길 택배 랭킹</h1><p class="ng-note">불러오는 중…</p>
    <table class="lb"><thead><tr><th>순위</th><th>닉네임</th><th>최고 점수</th><th>스테이지</th></tr></thead><tbody></tbody></table>
    <div class="btns"><button class="primary" id="b-lb-back">돌아가기</button><button id="b-lb-reload">새로고침</button></div>`, 'ng-board');
  ui.bind('b-lb-back', back);
  ui.bind('b-lb-reload', () => showLeaderboard(back));
  const note = card.querySelector<HTMLElement>('.ng-note')!;
  const body = card.querySelector('tbody')!;
  const row = (e: BoardEntry) => {
    const tr = document.createElement('tr');
    if (e.me === true) tr.className = 'me';
    const rank = int(e.rank), score = int(e.score), stage = int(e.stage);
    for (const text of [rank != null ? String(rank) : '-', String(e.nickname ?? ''), score != null ? String(score) : '-', stage != null ? `스테이지 ${stage}` : '-']) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    body.append(tr);
  };
  timed(sdk.leaderboard({ limit: 20 })).then((r) => {
    if (!body.isConnected) return; // the player left this screen meanwhile
    const entries = Array.isArray(r.entries) ? r.entries : [];
    entries.forEach(row);
    if (r.me && !entries.some((e) => e.me === true)) row(r.me);
    note.textContent = entries.length ? (r.me ? '' : '아직 내 기록이 없습니다. 근무를 마치면 랭킹에 올라갑니다.') : '아직 기록이 없습니다.';
  }, (e: ApiError) => {
    if (body.isConnected) note.textContent = e.code === 'network' ? '서버에 연결하지 못했습니다.' : '랭킹을 불러오지 못했습니다.';
  });
}

// End-to-end check of the save-conflict guard (VITE_NG_PLATFORM=1) against a LOCAL NalidaGame API that has the
// progress revision + play plausibility rules (NalidaGame branch feat/dd-save-revision-trust).
//   NG_API=http://localhost:8790 npm run e2e:save-guard     # API started with ALLOW_LAN_ORIGINS=1 COOKIE_SECURE=0
// Scenarios: two browser contexts (same account, two devices) with a stale save -> 409 stale_progress -> merged, nothing
// lost; two tabs in one context -> older tab locked, take-over; an implausible play is rejected once and dropped
// (no retry); a normal play is still recorded. Refuses any API that is not http://localhost:<port>.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';

const API = (process.env.NG_API || '').replace(/\/+$/, '');
if (!/^http:\/\/localhost(:\d+)?$/.test(API)) {
  console.error('NG_API must be a local NalidaGame API on localhost, e.g. http://localhost:8790');
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configFile = join(root, 'vite.config.ts');
const outDir = join(tmpdir(), `dronedeliver-ng-guard-${process.pid}`);
Object.assign(process.env, { VITE_NG_PLATFORM: '1', VITE_NG_API: API, VITE_NG_PORTAL: 'http://localhost:9/portal' });
await build({ root, configFile, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
const server = await preview({ root, configFile, build: { outDir }, preview: { port: 5298, strictPort: false } });
const base = server.resolvedUrls.local[0];
const url = `${base}?debug=1&nolock=1`;
const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  executablePath: process.env.CHROME_PATH,
  channel: process.env.CHROME_PATH ? undefined : 'chrome',
  args: process.platform === 'darwin' ? ['--ignore-gpu-blocklist', '--use-angle=metal'] : ['--ignore-gpu-blocklist'],
});
const step = (m) => console.log(`- ${m}`);
const calls = [];
const errors = [];
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag}: ${e}`));
  page.on('response', async (res) => {
    const req = res.request();
    if (!req.url().includes('/v1/games/')) return;
    let body = null;
    try { body = await res.json(); } catch { /* none */ }
    calls.push({ tag, method: req.method(), path: new URL(req.url()).pathname, status: res.status(), request: req.postData() ? JSON.parse(req.postData()) : undefined, response: body });
  });
};
const api = (page, method, path, body) => page.evaluate(async ([api, method, path, body]) => {
  const r = await fetch(api + path, { method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [API, method, path, body]);
const h1 = (page) => page.evaluate(() => document.querySelector('#screen-card h1')?.textContent ?? '');
const waitH1 = (page, t) => page.waitForFunction((x) => document.querySelector('#screen-card h1')?.textContent === x, t, { timeout: 15000 });
const settled = (page) => page.waitForFunction(() => { const t = document.getElementById('ng-status')?.textContent; return t && t !== '기록 저장 중…'; }, null, { timeout: 20000 });
/** Play stage 1 through the debug hook: score and shift length are set directly. */
async function clear(page, score, time) {
  await page.click('#b-start');
  await page.click('#b-go');
  await page.evaluate(([score, time]) => { const s = window.__game.sim; s.stats.delivered = 5; s.time = time; s.score = score; }, [score, time]);
  await waitH1(page, '목표 달성');
  await settled(page);
  return page.textContent('#ng-status');
}
const toTitle = async (page) => { await page.click('#b-title'); await page.waitForSelector('#b-start'); };
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('div[role=status]')].map((e) => e.textContent));
const mine = (tag, method, suffix) => calls.filter((c) => c.tag === tag && c.method === method && c.path.endsWith(suffix));

try {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const A = await ctxA.newPage(); watch(A, 'A');
  const B = await ctxB.newPage(); watch(B, 'B');

  // Same account on two "devices" (separate cookie jars).
  const loginId = `dd_guard_${randomBytes(4).toString('hex')}`;
  const password = randomBytes(12).toString('hex');
  await A.goto(url, { waitUntil: 'domcontentloaded' });
  await waitH1(A, '로그인이 필요합니다');
  assert.equal((await api(A, 'POST', '/v1/auth/signup', { loginId, password })).status, 201);
  assert.equal((await api(A, 'PATCH', '/v1/me', { nickname: `가드${randomBytes(2).toString('hex')}` })).status, 200);
  await B.goto(url, { waitUntil: 'domcontentloaded' });
  await waitH1(B, '로그인이 필요합니다');
  assert.equal((await api(B, 'POST', '/v1/auth/login', { loginId, password })).status, 200);
  await A.reload({ waitUntil: 'domcontentloaded' });
  await B.reload({ waitUntil: 'domcontentloaded' });
  await A.waitForSelector('#b-start', { timeout: 15000 });
  await B.waitForSelector('#b-start', { timeout: 15000 });
  step(`account ${loginId}: signed in in two browser contexts, both on the title screen`);

  // 1. A clears stage 1 (play first, then progress PUT with baseRevision): revision moves on.
  const t1 = await clear(A, 620, 150);
  const putA = mine('A', 'PUT', '/progress').at(-1);
  const postA = mine('A', 'POST', '/plays').at(-1);
  assert.equal(postA.status, 201, JSON.stringify(postA));
  assert.equal(putA.status, 200, JSON.stringify(putA));
  assert.equal(typeof putA.request.baseRevision, 'number');
  assert.ok(putA.response.revision > putA.request.baseRevision);
  assert.equal(putA.response.data.unlocked, 2);
  step(`A clears stage 1: POST plays ${postA.status} then PUT progress baseRevision ${putA.request.baseRevision} -> ${putA.response.revision}, unlocked ${putA.response.data.unlocked}; line "${t1}"`);

  // 2. B still holds the old revision. A write from A lands between B's fetch and B's PUT: 409 stale_progress,
  //    B merges the server copy, adopts its revision and retries once; the player is told.
  let raced = false;
  await B.route(`${API}/v1/games/dronedeliver/progress`, async (route) => {
    if (route.request().method() !== 'PUT' || raced) return route.continue();
    raced = true;
    const cur = (await api(A, 'GET', '/v1/games/dronedeliver/progress')).body;
    const r = await api(A, 'PUT', '/v1/games/dronedeliver/progress', { data: { unlocked: 2, best: { 1: 700 } }, progressAt: Date.now() + 120_000, baseRevision: cur.revision });
    assert.equal(r.status, 200, JSON.stringify(r));
    await route.continue();
  });
  const t2 = await clear(B, 650, 150);
  await B.unroute(`${API}/v1/games/dronedeliver/progress`);
  const puts = mine('B', 'PUT', '/progress').slice(-2);
  assert.deepEqual(puts.map((c) => c.status), [409, 200], JSON.stringify(puts));
  assert.equal(puts[0].response.error, 'stale_progress');
  assert.equal(puts[1].request.baseRevision, puts[0].response.revision, 'retry uses the revision from the 409');
  assert.equal(puts[1].response.data.best[1], 700, 'the other device\'s better score survived');
  assert.ok((await toasts(B)).some((t) => t.includes('다른 기기에서 저장된 진행도를 불러와 합쳤어요')), 'merge notice shown');
  const server = (await api(A, 'GET', '/v1/games/dronedeliver/progress')).body;
  assert.equal(server.data.best[1], 700);
  assert.equal(server.data.unlocked, 2);
  step(`B saves with a stale revision: PUT ${puts.map((c) => c.status).join(' -> ')}, merged best ${JSON.stringify(puts[1].response.data.best)}, notice shown, server copy ${JSON.stringify(server.data)} rev ${server.revision}; line "${t2}"`);

  // 3. Stage buttons follow the server: stage 2 is open on B's title.
  await toTitle(B);
  assert.equal(await B.evaluate(() => document.getElementById('b-s2').disabled), false);

  // 4. Second tab of the same account (same context): the older tab locks, take-over brings it back.
  const A2 = await ctxA.newPage(); watch(A2, 'A2');
  await A2.goto(url, { waitUntil: 'domcontentloaded' });
  await A2.waitForSelector('#b-start', { timeout: 15000 });
  await waitH1(A, '다른 탭에서 플레이 중입니다');
  step('second tab opened: the older tab shows "다른 탭에서 플레이 중입니다" and is locked');
  await A.click('#b-gate');
  await A.waitForSelector('#b-start', { timeout: 15000 });
  await waitH1(A2, '다른 탭에서 플레이 중입니다');
  step('take-over in the older tab: it is back on the title, the other tab is now locked');
  await A2.close();

  // 5. An implausible play (huge score in 1 s): the API rejects it, the client drops it (one POST, no retry) and tells the player.
  const posts0 = mine('A', 'POST', '/plays').length;
  const t5 = await clear(A, 90000, 1).catch(async () => (await A.textContent('#ng-status')));
  await A.waitForTimeout(3000);
  const bad = mine('A', 'POST', '/plays').slice(posts0);
  assert.equal(bad.length, 1, 'rejected play is not retried: ' + JSON.stringify(bad));
  assert.equal(bad[0].status, 422);
  assert.equal(bad[0].response.error, 'implausible_score');
  assert.match(await A.textContent('#ng-status'), /비정상/);
  assert.equal((await api(A, 'GET', '/v1/games/dronedeliver/progress')).body.data.best[1], 700, 'rejected score left no trace');
  step(`implausible play: POST ${bad[0].status} ${bad[0].response.error}, one attempt only, line "${await A.textContent('#ng-status')}"`);

  // 6. A normal play is still recorded.
  await A.click('#b-title'); await A.waitForSelector('#b-start');
  const posts1 = mine('A', 'POST', '/plays').length;
  const t6 = await clear(A, 800, 150);
  const ok = mine('A', 'POST', '/plays').slice(posts1);
  assert.equal(ok.length, 1);
  assert.equal(ok[0].status, 201, JSON.stringify(ok[0]));
  assert.equal((await api(A, 'GET', '/v1/games/dronedeliver/progress')).body.data.best[1], 800);
  step(`normal play: POST ${ok[0].status}, best 800 saved; line "${t6}"`);

  assert.deepEqual(errors, []);
  console.log('\nAPI calls:');
  for (const c of calls) console.log(JSON.stringify(c));
  console.log('\nsave-guard e2e OK');
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}

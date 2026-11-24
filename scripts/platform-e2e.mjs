// End-to-end check of the nalidagame.online integration (VITE_NG_PLATFORM=1) against a LOCAL NalidaGame API.
// Builds the game with the flag on into a temp dir, serves it, and in headless Chrome: checks the login gate,
// signs up a throwaway account on that API, clears and fails stage 1 through the ?debug=1 hook, and checks the
// saved progress, the posted plays, the leaderboard, the progress conflict merge, play errors and that
// leaderboard fields cannot inject HTML. Prints every /v1/games request with its response.
//
//   NG_API=http://localhost:8790 npm run e2e:platform     # API started with ALLOW_LAN_ORIGINS=1 COOKIE_SECURE=0
//   NG_E2E_SHOTS=/some/dir                                # optional screenshots
//
// Refuses any NG_API that is not http://localhost:<port>: it creates accounts, and the game is served on
// localhost, so the API must share that host for its SameSite=Lax session cookie.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';

const API = (process.env.NG_API || '').replace(/\/+$/, '');
if (!/^http:\/\/localhost(:\d+)?$/.test(API)) {
  console.error('NG_API must be a local NalidaGame API on localhost (not 127.0.0.1: cookie site), e.g. http://localhost:8790');
  process.exit(2);
}
const PORTAL = 'http://localhost:9/portal'; // never reached: requests to it are intercepted
const shots = process.env.NG_E2E_SHOTS;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configFile = join(root, 'vite.config.ts');
const outDir = join(tmpdir(), `dronedeliver-ng-e2e-${process.pid}`);
Object.assign(process.env, { VITE_NG_PLATFORM: '1', VITE_NG_API: API, VITE_NG_PORTAL: PORTAL });
await build({ root, configFile, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
const server = await preview({ root, configFile, build: { outDir }, preview: { port: 5299, strictPort: false } });
const base = server.resolvedUrls.local[0];
const url = `${base}?debug=1&nolock=1`;

const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  executablePath: process.env.CHROME_PATH,
  channel: process.env.CHROME_PATH ? undefined : 'chrome',
  args: process.platform === 'darwin' ? ['--ignore-gpu-blocklist', '--use-angle=metal'] : ['--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
if (process.env.NG_E2E_VERBOSE) page.on('console', (m) => console.log('  [console]', m.type(), m.text()));

// Evidence: every game API call with its status and bodies.
const calls = [];
page.on('response', async (res) => {
  const req = res.request();
  if (!req.url().includes('/v1/games/')) return;
  let body = null;
  try { body = await res.json(); } catch { /* 204 / none */ }
  calls.push({ method: req.method(), path: new URL(req.url()).pathname + new URL(req.url()).search, status: res.status(),
    xNgUser: req.headers()['x-ng-user'] ? 'set' : 'none', request: req.postData() ? JSON.parse(req.postData()) : undefined, response: body });
});

const card = () => page.evaluate(() => {
  const c = document.getElementById('screen-card');
  return { cls: c.className, h1: c.querySelector('h1')?.textContent ?? '', text: c.textContent };
});
const waitH1 = (text) => page.waitForFunction((t) => document.querySelector('#screen-card h1')?.textContent === t, text, { timeout: 15000 });
const api = (method, path, body) => page.evaluate(async ([api, method, path, body]) => {
  const r = await fetch(api + path, { method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [API, method, path, body]);
const shot = async (name) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`) }); };
const last = (method, suffix) => [...calls].reverse().find((c) => c.method === method && c.path.endsWith(suffix));
const step = (msg) => console.log(`- ${msg}`);

try {
  // 1. Logged out: the gate, no title screen, the login button goes to the portal with a return URL.
  await page.route(`${PORTAL}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'portal' }));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitH1('로그인이 필요합니다');
  assert.equal(await page.$('#b-start'), null, 'title screen must not show without a login');
  await shot('ng-gate');
  await Promise.all([page.waitForURL(`${PORTAL}/login?**`), page.click('#b-gate')]);
  const next = new URL(page.url()).searchParams.get('next');
  assert.ok(next.startsWith(base), `login return URL ${next}`);
  step(`logged out: gate shown, login -> ${new URL(page.url()).pathname}?next=${next}`);

  // 2. Throwaway account on the local API: without a nickname the gate asks for one.
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitH1('로그인이 필요합니다');
  const loginId = `dd_e2e_${randomBytes(4).toString('hex')}`;
  const nick = `배송${randomBytes(2).toString('hex')}`;
  const signup = await api('POST', '/v1/auth/signup', { loginId, password: randomBytes(12).toString('hex') });
  assert.equal(signup.status, 201, JSON.stringify(signup));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitH1('닉네임 설정이 필요합니다');
  const setNick = await api('PATCH', '/v1/me', { nickname: nick });
  assert.equal(setNick.status, 200, JSON.stringify(setNick));
  step(`signup ${loginId} -> 201, nickname gate shown, PATCH /v1/me ${nick} -> 200`);

  // 3. Logged in: title with stages 2-4 locked.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#b-start', { timeout: 15000 });
  const locks = await page.evaluate(() => [2, 3, 4].map((n) => document.getElementById(`b-s${n}`).disabled));
  assert.deepEqual(locks, [true, true, true]);
  assert.equal(await page.textContent('#ng-nick'), nick);
  await shot('ng-title');
  step(`title: nickname ${nick}, stages 2-4 locked`);

  // 4. Clear stage 1 through the debug hook: progress PUT unlocked=2 + best, play POST 201.
  await page.click('#b-start');
  await page.click('#b-go');
  await page.evaluate(() => { const s = window.__game.sim; s.stats.delivered = 5; s.stats.perfect = 2; s.stats.good = 2; s.score = s.stage.target; });
  await waitH1('목표 달성');
  await page.waitForFunction(() => { const t = document.getElementById('ng-status')?.textContent; return t && t !== '기록 저장 중…'; }, null, { timeout: 15000 });
  const put = last('PUT', '/progress');
  const post = last('POST', '/plays');
  assert.equal(put.status, 200);
  assert.deepEqual(put.response.data, { unlocked: 2, best: { 1: 620 } });
  assert.equal(post.status, 201);
  assert.equal(put.xNgUser, 'set');
  const status1 = await page.textContent('#ng-status');
  await shot('ng-result');
  step(`stage 1 clear: PUT progress ${put.status} ${JSON.stringify(put.response.data)}, POST plays ${post.status}, result line "${status1}"`);
  const stored = await api('GET', '/v1/games/dronedeliver/progress');
  assert.deepEqual(stored.body.data, { unlocked: 2, best: { 1: 620 } });

  // 5. Leaderboard from the result screen lists the player.
  await page.click('#b-board');
  await page.waitForSelector('.lb tbody tr', { timeout: 15000 });
  const rows = await page.$$eval('.lb tbody tr', (trs) => trs.map((tr) => ({ me: tr.className === 'me', cells: [...tr.cells].map((c) => c.textContent) })));
  const mine = rows.find((r) => r.cells[1] === nick);
  assert.ok(mine && mine.me && mine.cells[2] === '620' && mine.cells[3] === '스테이지 1', JSON.stringify(rows));
  await shot('ng-board');
  step(`leaderboard: ${JSON.stringify(mine.cells)} (me row)`);

  // 6. Hostile leaderboard fields render as text, never as markup.
  await page.route(`${API}/v1/games/dronedeliver/leaderboard**`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': base.replace(/\/$/, ''), 'Access-Control-Allow-Credentials': 'true' },
    body: JSON.stringify({ entries: [
      { rank: '1<img src=x onerror="window.__xss=1">', nickname: '<img src=x onerror="window.__xss=1"><b>x</b>', score: '<script>window.__xss=1</script>', stage: '"><svg onload=window.__xss=1>' },
      { rank: 2, nickname: '</td><td>&amp;', score: 1e3 + 0.7, stage: 3, me: 'true' },
    ], me: null }),
  }));
  await page.click('#b-lb-reload');
  await page.waitForSelector('.lb tbody tr', { timeout: 15000 });
  const hostile = await page.evaluate(() => ({
    cells: [...document.querySelectorAll('.lb tbody tr')].map((tr) => [...tr.cells].map((c) => c.textContent)),
    elements: document.querySelectorAll('.lb tbody img, .lb tbody script, .lb tbody svg, .lb tbody b').length,
    meRows: document.querySelectorAll('.lb tbody tr.me').length,
    xss: window.__xss ?? null,
  }));
  assert.equal(hostile.elements, 0);
  assert.equal(hostile.xss, null);
  assert.equal(hostile.meRows, 0, 'me must be the boolean true');
  assert.deepEqual(hostile.cells[0], ['-', '<img src=x onerror="window.__xss=1"><b>x</b>', '-', '-']);
  assert.deepEqual(hostile.cells[1], ['2', '</td><td>&amp;', '1000', '스테이지 3']);
  await page.unroute(`${API}/v1/games/dronedeliver/leaderboard**`);
  step(`hostile leaderboard: rendered as text ${JSON.stringify(hostile.cells)}, 0 injected elements, no script ran`);

  // 7. Back on the title: stage 2 open, 3-4 still locked.
  await page.click('#b-lb-back');
  await page.click('#b-title');
  const locks2 = await page.evaluate(() => [2, 3, 4].map((n) => document.getElementById(`b-s${n}`).disabled));
  assert.deepEqual(locks2, [false, true, true]);
  step('title after clear: stage 2 open, 3-4 locked');

  // 8. Another device saved newer progress after this tab loaded: the save fetches and merges it first, so the
  //    stage 2 clear keeps the other device's unlock and scores (max of both) instead of overwriting them.
  const gamePuts = () => calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/progress') && c.xNgUser === 'set');
  const other = await api('PUT', '/v1/games/dronedeliver/progress', { data: { unlocked: 3, best: { 2: 2000, 3: 700 } }, progressAt: Date.now() + 60_000 });
  assert.equal(other.status, 200, JSON.stringify(other));
  await page.click('#b-s2');
  await page.click('#b-go');
  await page.evaluate(() => { const s = window.__game.sim; s.stats.delivered = 9; s.score = s.stage.target; });
  await waitH1('목표 달성');
  await page.waitForFunction(() => { const t = document.getElementById('ng-status')?.textContent; return t && t !== '기록 저장 중…'; }, null, { timeout: 15000 });
  const merged = gamePuts().at(-1);
  assert.equal(merged.status, 200);
  assert.deepEqual(merged.response.data, { unlocked: 3, best: { 1: 620, 2: 2000, 3: 700 } });
  step(`stage 2 clear after a newer save elsewhere: GET + merge, PUT ${merged.status} ${JSON.stringify(merged.response.data)}, POST plays ${last('POST', '/plays').status}`);

  // 8b. A write that lands between that fetch and the PUT: 409 conflict, merge, write once more.
  let raced = false;
  await page.route(`${API}/v1/games/dronedeliver/progress`, async (route) => {
    if (route.request().method() !== 'PUT' || raced) return route.continue();
    raced = true;
    const r = await api('PUT', '/v1/games/dronedeliver/progress', { data: { unlocked: 4, best: { 1: 800 } }, progressAt: Date.now() + 120_000 });
    assert.equal(r.status, 200, JSON.stringify(r));
    await route.continue();
  });
  await page.click('#b-title');
  await page.click('#b-s3');
  await page.click('#b-go');
  await page.evaluate(() => { const s = window.__game.sim; s.stats.delivered = 9; s.score = s.stage.target; });
  await waitH1('목표 달성');
  await page.waitForFunction(() => { const t = document.getElementById('ng-status')?.textContent; return t && t !== '기록 저장 중…'; }, null, { timeout: 15000 });
  await page.unroute(`${API}/v1/games/dronedeliver/progress`);
  const puts = gamePuts().slice(-2);
  assert.deepEqual(puts.map((c) => c.status), [409, 200]);
  assert.deepEqual(puts[0].request.data, { unlocked: 4, best: { 1: 620, 2: 2000, 3: 1600 } });
  assert.deepEqual(puts[1].response.data, { unlocked: 4, best: { 1: 800, 2: 2000, 3: 1600 } });
  assert.match(await page.textContent('#ng-status'), /랭킹 \d+위/);
  step(`stage 3 clear with a write racing the save: PUT ${puts.map((c) => c.status).join(' -> ')} ${JSON.stringify(puts[1].response.data)}`);

  // 9. A failed shift posts cleared=false and, with nothing new to save, sends no progress.
  const putCount = calls.filter((c) => c.method === 'PUT').length;
  await page.click('#b-retry');
  await page.click('#b-go');
  await page.evaluate(() => { const s = window.__game.sim; s.time = s.stage.timeLimit; });
  await waitH1('근무 종료');
  await page.waitForFunction(() => { const t = document.getElementById('ng-status')?.textContent; return t && t !== '기록 저장 중…'; }, null, { timeout: 15000 });
  const failPlay = last('POST', '/plays');
  assert.equal(failPlay.status, 201);
  assert.equal(failPlay.request.cleared, false);
  assert.equal(calls.filter((c) => c.method === 'PUT').length, putCount);
  step(`stage 3 fail: POST plays ${failPlay.status} (cleared=false), no progress PUT`);

  // 10. Play errors keep the result screen: 409 nickname_required offers the nickname page, 429 explains.
  for (const [status, error, expectNick] of [[409, 'nickname_required', true], [429, 'rate_limited', false], [400, 'score_too_high', false]]) {
    await page.route(`${API}/v1/games/dronedeliver/plays`, (route) => route.fulfill({
      status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': base.replace(/\/$/, ''), 'Access-Control-Allow-Credentials': 'true' },
      body: JSON.stringify({ error, message: 'x' }),
    }));
    await page.click('#b-retry');
    await page.click('#b-go');
    await page.evaluate(() => { const s = window.__game.sim; s.time = s.stage.timeLimit; });
    await waitH1('근무 종료');
    await page.waitForFunction(() => { const t = document.getElementById('ng-status')?.textContent; return t && t !== '기록 저장 중…'; }, null, { timeout: 15000 });
    const r = await page.evaluate(() => ({ text: document.getElementById('ng-status').textContent, nick: !document.getElementById('b-nick').hidden, retry: !!document.getElementById('b-retry') }));
    assert.equal(r.nick, expectNick);
    assert.ok(r.retry);
    await page.unroute(`${API}/v1/games/dronedeliver/plays`);
    step(`play ${status} ${error}: "${r.text}", nickname button ${r.nick ? 'shown' : 'hidden'}, result screen kept`);
  }

  // 11. Logged out in another tab while a shift is paused: resuming (P or 계속하기) shows the expired gate and the shift stops
  //     behind it (it must not keep running and replace the gate with a result screen).
  await page.click('#b-retry');
  await page.click('#b-go');
  await page.keyboard.press('KeyP');
  await waitH1('잠시 휴식');
  await api('POST', '/v1/auth/logout', {});
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyP'); // resume by keyboard; 계속하기 goes through the same setPaused(false)
  await waitH1('로그인이 만료되었습니다');
  await page.evaluate(() => { const s = window.__game.sim; s.time = s.stage.timeLimit; });
  await page.waitForTimeout(1000);
  const halted = await page.evaluate(() => ({ phase: window.__game.sim.phase, h1: document.querySelector('#screen-card h1')?.textContent }));
  assert.equal(halted.h1, '로그인이 만료되었습니다');
  assert.notEqual(halted.phase, 'playing');
  step(`logout elsewhere during a paused shift: P resume -> expired gate, shift stopped (phase ${halted.phase})`);

  assert.deepEqual(errors, []);
  console.log('\nAPI calls:');
  for (const c of calls) console.log(JSON.stringify(c));
  console.log('\nplatform e2e OK');
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}

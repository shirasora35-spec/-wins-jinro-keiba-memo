const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relative, overrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = name => {
    if (name in overrides) return overrides[name];
    if (name.startsWith('.')) return load(path.join(path.dirname(relative), `${name}.ts`), overrides);
    return require(name);
  };
  new Function('exports', 'require', 'module', output)(module.exports, localRequire, module);
  return module.exports;
}
const { getTargetRaceDates } = load('lib/date.ts');
const { matchRacesToMemos } = load('lib/match.ts');
const { parseRaceIds } = load('lib/race-list.ts');

test('Monday keeps the possible three-day meeting; Tuesday switches to the next weekend', () => {
  assert.deepEqual(getTargetRaceDates(new Date('2026-09-14T03:00:00Z')),
    ['2026-09-12', '2026-09-13', '2026-09-14']);
  for (let day = 15; day <= 20; day++) {
    assert.deepEqual(getTargetRaceDates(new Date(`2026-09-${day}T03:00:00Z`)),
      ['2026-09-19', '2026-09-20', '2026-09-21']);
  }
});
test('last week shifts all three dates and respects the JST Monday boundary', () => {
  assert.deepEqual(getTargetRaceDates(new Date('2026-09-13T14:59:59Z'), 'last'),
    ['2026-09-05', '2026-09-06', '2026-09-07']);
  assert.deepEqual(getTargetRaceDates(new Date('2026-09-13T15:00:00Z'), 'last'),
    ['2026-09-05', '2026-09-06', '2026-09-07']);
  assert.deepEqual(getTargetRaceDates(new Date('2026-09-14T15:00:00Z'), 'last'),
    ['2026-09-12', '2026-09-13', '2026-09-14']);
  assert.deepEqual(getTargetRaceDates(new Date('2026-01-01T03:00:00Z'), 'last'),
    ['2025-12-27', '2025-12-28', '2025-12-29']);
});

const horse = 'ミスティマウンテン';
function match(content, names = [horse]) {
  return matchRacesToMemos([{
    date: '2026-09-05', venue: '札幌', raceNumber: 8, raceName: 'テスト',
    raceId: 'fixture', horses: names.map(name => ({ name })),
  }], [{
    id: 'fixture', content, channelId: 'test', channelName: 'test',
    authorName: 'test', timestamp: '2026-09-01T00:00:00Z',
  }]);
}
test('structured memo belongs only to the named horse, ending before a non-runner', () => {
  const result = match(`札幌8R 3着${horse} →出遅れて外を回した\n次走注目\n札幌9R 4着ピエナオルカ\n→別馬の回顧`, [horse, 'ミスティ']);
  assert.equal(result.length, 1);
  assert.equal(result[0].horseName, horse);
  assert.equal(result[0].memos[0].excerpt, `札幌8R 3着${horse} →出遅れて外を回した\n次走注目`);
});
test('full-width structured headings normalize and stop at race-level notes', () => {
  const result = match(`札幌８Ｒ ３着ﾐｽﾃｨﾏｳﾝﾃﾝ【B】\n→注目\n阪神9R →レース全体`);
  assert.equal(result.length, 1);
  assert.ok(!result[0].memos[0].excerpt.includes('阪神'));
});
test('prefix alone never attaches a longer horse name to another horse', () => {
  assert.equal(match('ミスティマウンテン：外を回した', ['ミスティ']).length, 0);
});
test('a comparison inside another horse section is not a memo for the mentioned runner', () => {
  assert.equal(match(`札幌9R 4着ピエナオルカ\n→比較相手は「${horse}」。\nこの馬自身は伸びなかった`).length, 0);
  assert.equal(match(`札幌9R 4着ピエナオルカ\n\n→比較相手は「${horse}」。`).length, 0);
});

test('public page only reads the published snapshot', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app/page.tsx'), 'utf8');
  assert.ok(page.includes('getPublishedSnapshot'));
  assert.ok(page.includes('../lib/published'));
  assert.ok(!page.includes('../lib/sync'));
  assert.ok(!page.includes('getDiscordMemos'));
  assert.ok(!page.includes('getRaces'));
  assert.ok(!page.includes('matchRacesToMemos'));
});

test('netkeiba parser only uses links in the displayed date race list', () => {
  const html = `
    <a href="/race/shutuba.html?race_id=202699990101">navigation</a>
    <div class="RaceListDayWrap"><li data-kaisaidate="20260919"></li><div class="RaceList_Main_Box">
      <a href="/race/shutuba.html?race_id=202606040801">1R</a>
      <a href="/race/shutuba.html?race_id=202606040802&rf=race_list">2R</a>
      <a href="/race/shutuba.html?race_id=202606040801">duplicate</a>
    </div></div>
    <div class="RaceListDayWrap"><li data-kaisaidate="20260920"></li><div class="RaceList_Main_Box">
      <a href="?race_id=202606040901">another date</a>
    </div></div>`;
  assert.deepEqual(parseRaceIds(html, '2026-09-19'), ['202606040801', '202606040802']);
  assert.deepEqual(parseRaceIds(html, '2026-09-20'), ['202606040901']);
  assert.deepEqual(parseRaceIds(html, '2026-09-21'), []);
  assert.throws(() => parseRaceIds(html, '2026-09-12'), /対象週/);
});

test('netkeiba parser fails closed if race links exist but the expected list is missing', () => {
  assert.throws(
    () => parseRaceIds('<a href="?race_id=202606040801">unknown layout</a>', '2026-09-19'),
    /一覧構造/,
  );
});

test('mobile race cards extract actual names and assigned numbers, not database link labels', () => {
  const { extractHorses } = load('lib/races.ts');
  const $ = require('cheerio').load(`<table>
    <tr class="HorseList"><td class="Waku2">3</td><td>
      <dt class="Horse HorseLink"><a href="/modal/horse.html">ミスティマウンテン</a></dt>
      <a href="/horse/123/">ミスティマウンテンのデータベース</a></td></tr>
    <tr class="HorseList"><td><dt class="Horse HorseLink"><a>ピエナオルカ</a></dt></td></tr>
  </table>`);
  assert.deepEqual(extractHorses($), [{name: horse, number: 3}, {name: 'ピエナオルカ', number: undefined}]);
});

test('race refresh fetches one meeting list, only requested day cards, and retains failed card IDs', async () => {
  const originalFetch = global.fetch;
  const oldSource = process.env.RACE_SOURCE;
  process.env.RACE_SOURCE = 'netkeiba';
  const urls = [];
  const list = `<div class="RaceListDayWrap"><li data-kaisaidate="20260919"></li>
    <div class="RaceList_Main_Box"><a href="?race_id=202606040501">1</a><a href="?race_id=202606040502">2</a></div></div>
    <div class="RaceListDayWrap"><li data-kaisaidate="20260920"></li>
    <div class="RaceList_Main_Box"><a href="?race_id=202606040601">1</a></div></div>`;
  global.fetch = async url => {
    urls.push(String(url));
    if (url.includes('pid=race_list')) return new Response(list);
    if (url.includes('040502')) return new Response('', {status: 503});
    return new Response(`<span id="kaisaiDate:20260919">1R</span><h1 class="Race_Name">試験</h1>
      <table><tr class="HorseList"><td class="HorseLink"><a>${horse}</a></td></tr></table>`);
  };
  try {
    const result = await load('lib/races.ts').getRaces(['2026-09-19', '2026-09-21']);
    assert.equal(result.externalRequestCount, 3);
    assert.equal(result.races.length, 1);
    assert.equal(result.races[0].date, '2026-09-19');
    assert.deepEqual(result.successfulDates, ['2026-09-19', '2026-09-21']);
    assert.deepEqual(result.failedRaceIds, ['2026-09-19:202606040502']);
    assert.ok(!urls.some(url => url.includes('040601')));
  } finally {
    global.fetch = originalFetch;
    if (oldSource === undefined) delete process.env.RACE_SOURCE; else process.env.RACE_SOURCE = oldSource;
  }
});

test('race merge removes wrong-day duplicates but preserves failed card and failed day data', () => {
  const { mergeRaces } = load('lib/sync.ts', { './storage': {} });
  const base = {venue: '中山', raceNumber: 1, raceName: '', horses: []};
  const previous = [
    {...base, date: '2026-09-19', raceId: 'failed'},
    {...base, date: '2026-09-20', raceId: 'failed'},
    {...base, date: '2026-09-21', raceId: 'keep-day'},
  ];
  const result = mergeRaces(previous, [], ['2026-09-19', '2026-09-20'], ['2026-09-19:failed']);
  assert.deepEqual(result.map(r => `${r.date}:${r.raceId}`), ['2026-09-19:failed', '2026-09-21:keep-day']);
});

test('Discord increment deduplicates two channels, catches multi-page new messages and retains old data', async () => {
  const originalFetch = global.fetch;
  const envKeys = ['DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_IDS', 'DISCORD_HISTORY_MAX_MESSAGES'];
  const saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {DISCORD_BOT_TOKEN: 'test-only', DISCORD_CHANNEL_IDS: 'one,two', DISCORD_HISTORY_MAX_MESSAGES: '4000'});
  const timestamp = new Date().toISOString();
  const oldMemo = {id: '100', channelId: 'one', channelName: 'one', authorName: 'fixture', content: '保存済み', timestamp};
  const previous = {version: 1, updatedAt: timestamp, channels: {
    one: {channelId: 'one', channelName: 'one', newestMessageId: '100', updatedAt: timestamp},
    two: {channelId: 'two', channelName: 'two', newestMessageId: '50', updatedAt: timestamp},
  }, memos: [oldMemo]};
  const urls = [];
  global.fetch = async url => {
    urls.push(String(url));
    if (url.includes('/two/')) return Response.json([{id: '50', content: '既存', timestamp}]);
    if (url.includes('before=')) return Response.json([{id: '101', content: '追加101', timestamp}, {id: '100', content: '保存済み', timestamp}]);
    return Response.json(Array.from({length:100}, (_, i) => ({id:String(201-i), content:`追加${201-i}`, timestamp})));
  };
  try {
    const result = await load('lib/discord.ts').syncDiscordMemos(previous);
    assert.equal(result.mode, 'incremental');
    assert.equal(result.fetchedCount, 101);
    assert.equal(result.externalRequestCount, 3);
    assert.equal(result.store.memos.length, 102);
    assert.equal(result.store.channels.one.newestMessageId, '201');
    assert.ok(urls.every(url => url.includes('/messages?')));
    assert.ok(result.store.memos.some(m => m.id === '100'));

    global.fetch = async () => new Response('never expose this response body', {status: 403});
    const failed = await load('lib/discord.ts').syncDiscordMemos(previous);
    assert.equal(failed.store.channels.one.newestMessageId, '100');
    assert.equal(failed.store.memos.length, 1);
    assert.ok(!JSON.stringify(failed.errors).includes('never expose'));
  } finally {
    global.fetch = originalFetch;
    for (const key of envKeys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});

test('admin endpoints reject missing and incorrect credentials without starting sync', () => {
  const { isAuthorizedSyncRequest } = load('lib/admin-auth.ts');
  const oldSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-only';
  try {
    assert.equal(isAuthorizedSyncRequest(new Request('https://fixture.invalid')), false);
    assert.equal(isAuthorizedSyncRequest(new Request('https://fixture.invalid', {headers:{authorization:'Bearer incorrect'}})), false);
    assert.equal(isAuthorizedSyncRequest(new Request('https://fixture.invalid', {headers:{authorization:'Bearer test-only'}})), true);
  } finally {
    if (oldSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldSecret;
  }
});

test('storage uses the canonical pre-read generation for conditional writes', async () => {
  const oldVercel = process.env.VERCEL;
  const oldStore = process.env.BLOB_STORE_ID;
  process.env.VERCEL = '1';
  process.env.BLOB_STORE_ID = 'test-only';
  const calls = [];
  class NotFound extends Error {}
  const { readJson, writeJson } = load('lib/storage.ts', {
    '@vercel/blob': {
      BlobNotFoundError: NotFound,
      head: async pathname => { calls.push('head'); if (pathname === 'missing') throw new NotFound(); return {etag: 'canonical-generation'}; },
      get: async () => { calls.push('get'); return {statusCode: 200, stream: new Response('{"ok":true}').body, blob: {etag:'"http-download-generation"'}}; },
      put: async (pathname, body, options) => { calls.push('put'); assert.equal(options.ifMatch, 'canonical-generation'); assert.equal(options.addRandomSuffix, false); },
    },
    './sync-error': {classifySyncError: () => 'TEST', SyncStorageError: class extends Error {}},
  });
  try {
    const result = await readJson('existing', true);
    await writeJson('existing', result.value, result.etag);
    assert.deepEqual(calls, ['head', 'get', 'put']);
    assert.equal(await readJson('missing', true), null);
  } finally {
    if (oldVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
    if (oldStore === undefined) delete process.env.BLOB_STORE_ID; else process.env.BLOB_STORE_ID = oldStore;
  }
});

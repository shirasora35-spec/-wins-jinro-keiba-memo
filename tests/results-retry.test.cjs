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

test('result retry repairs a failed snapshot write without fetching already saved results again', async () => {
  const weekStart = '2026-10-03';
  const horseName = 'ミスティマウンテン';
  const raceId = '202605010101';
  const race = {
    date: weekStart, venue: '東京', raceNumber: 1, raceName: 'fixture', raceId,
    horses: [{ name: horseName }],
  };
  const database = {
    races: { value: { version: 1, weekStart, races: [race], errors: [], source: 'test' }, etag: 'race-generation' },
    discord: { value: { channels: {}, memos: [{
      id: '1', channelId: '1', channelName: 'fixture', authorName: 'fixture',
      content: `${horseName}：メモ`, timestamp: '2026-10-01T00:00:00Z',
    }] } },
    snapshot: { value: { matches: [{ horseName }] }, etag: 'snapshot-generation' },
  };
  const writes = [];
  let failSnapshotOnce = true;
  let resultFetchCount = 0;
  const { syncCompletedMeetingResults } = load('lib/sync.ts', {
    './storage': {
      raceStorePath: () => 'races', discordStorePath: () => 'discord', snapshotPath: () => 'snapshot',
      readJson: async key => database[key] || null,
      writeJson: async (key, value, etag) => {
        assert.equal(etag, database[key]?.etag);
        writes.push(key);
        if (key === 'snapshot' && failSnapshotOnce) {
          failSnapshotOnce = false;
          throw new Error('transient snapshot write failure');
        }
        database[key] = { value, etag: `${key}-generation-${writes.length}` };
      },
    },
    './races': {
      getRaceResults: async () => {
        resultFetchCount++;
        return { positions: { [raceId]: { [horseName]: '1' } }, errors: [], externalRequestCount: 1 };
      },
    },
    './discord': {},
  });
  const now = new Date('2026-10-06T00:00:00Z');

  await assert.rejects(syncCompletedMeetingResults(now), /transient snapshot write failure/);
  assert.equal(database.races.value.races[0].horses[0].finishPosition, '1');
  assert.equal(database.snapshot.value.matches[0].finishPosition, undefined);

  const retry = await syncCompletedMeetingResults(now);
  assert.equal(retry.ok, true);
  assert.equal(retry.externalRequestCount, 0);
  assert.equal(resultFetchCount, 1);
  assert.equal(database.snapshot.value.matches[0].finishPosition, '1');
  assert.deepEqual(writes, ['races', 'snapshot', 'snapshot']);
  assert.equal(database.snapshot.value.diagnostics.externalRequestCount, 0);

  // Already-complete results remain idempotent while a fresh snapshot is built.
  await syncCompletedMeetingResults(now, 2);
  assert.equal(resultFetchCount, 1);
  assert.equal(database.snapshot.value.matches[0].finishPosition, '1');
  assert.equal(database.snapshot.value.diagnostics.externalRequestCount, 2);
});

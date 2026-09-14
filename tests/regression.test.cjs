const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relative) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', output)(module.exports, require, module);
  return module.exports;
}
const { getTargetRaceDates } = load('lib/date.ts');
const { matchRacesToMemos } = load('lib/match.ts');

test('normal dates preserve the existing Sat/Sun/Mon window on every weekday', () => {
  for (let day = 14; day <= 20; day++) {
    assert.deepEqual(getTargetRaceDates(new Date(`2026-09-${day}T03:00:00Z`)),
      ['2026-09-19', '2026-09-20', '2026-09-21']);
  }
});
test('last week shifts all three dates and respects the JST Monday boundary', () => {
  assert.deepEqual(getTargetRaceDates(new Date('2026-09-13T14:59:59Z'), 'last'),
    ['2026-09-05', '2026-09-06', '2026-09-07']);
  assert.deepEqual(getTargetRaceDates(new Date('2026-09-13T15:00:00Z'), 'last'),
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

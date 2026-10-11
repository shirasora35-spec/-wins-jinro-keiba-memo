const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(relative, overrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const output = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2021, jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module = {exports:{}};
  const localRequire = name => {
    if (name in overrides) return overrides[name];
    if (name.startsWith('.')) {
      const base = path.join(path.dirname(relative), name);
      return load(base + (fs.existsSync(path.join(__dirname, '..', base + '.ts')) ? '.ts' : '.tsx'), overrides);
    }
    return require(name);
  };
  new Function('exports','require','module',output)(module.exports,localRequire,module);
  return module.exports;
}
const {normalizeStartTime, groupHorsesByStartTime} = load('lib/race-order.ts');
const {extractStartTime, getRaces} = load('lib/races.ts');
const {matchRacesToMemos} = load('lib/match.ts');
const horse = (id, venue, startTime, number = 1) => ({date:'2026-10-11', raceId:id, venue, raceNumber:Number(id.slice(-2)) || 1, raceName:'テスト', startTime, horseName:`馬${id}-${number}`, horseNumber:number, memos:[]});

test('start times normalize one-digit and full-width hours and reject invalid or non-time values', () => {
  assert.equal(normalizeStartTime('9:05'), '09:05');
  assert.equal(normalizeStartTime(' １５：４５ '), '15:45');
  for (const value of [undefined, null, 945, '', '24:00', '12:60', '12:5', '-1:00', '15:45発走']) assert.equal(normalizeStartTime(value), undefined);
});
test('parser reads verified mobile and desktop race metadata without using unrelated clocks', () => {
  const parse = html => extractStartTime(require('cheerio').load(html));
  assert.equal(parse('<div>更新 09:00</div><div class="Race_Data">15:45 <span>芝</span>1800m (左 A)</div>'), '15:45');
  assert.equal(parse('<div class="RaceData01">9:05発走 / ダ1200m</div>'), '09:05');
  assert.equal(parse('<div class="Race_Data">発走時刻未定</div><div>12:00 更新</div>'), undefined);
  assert.equal(parse('<div class="Race_Data">24:01 芝1600m</div>'), undefined);
});
test('selected-day races sort by time across venues and keep horses in each race together', () => {
  const input = [horse('tokyo02','東京','10:35',8), horse('kyoto02','京都','10:40'), horse('tokyo01','東京','9:05'), horse('tokyo02','東京','10:35',2), horse('kyoto01','京都','10:00')];
  const original = JSON.stringify(input);
  const groups = groupHorsesByStartTime(input);
  assert.deepEqual(groups.map(r => r.startTime), ['09:05','10:00','10:35','10:40']);
  assert.deepEqual(groups[2].horses.map(h => h.horseNumber), [2,8]);
  assert.equal(JSON.stringify(input), original, 'saved input must not mutate');
});
test('same-time ties are deterministic; missing, invalid, and conflicting times sort last', () => {
  const input = [horse('tokyo02','東京',undefined), horse('kyoto02','京都','bad'), horse('tokyo01','東京','10:00'), horse('kyoto01','京都','10:00')];
  const first = groupHorsesByStartTime(input).map(r => r.key);
  assert.deepEqual(groupHorsesByStartTime([...input].reverse()).map(r => r.key), first);
  assert.deepEqual(groupHorsesByStartTime(input).map(r => r.startTime), ['10:00','10:00',undefined,undefined]);
  assert.equal(groupHorsesByStartTime([horse('a01','東京','10:00'), horse('a01','東京','10:05',2)])[0].startTime, undefined);
});
test('matching carries scheduled time into snapshots and retains old snapshots without it', () => {
  const races = [{...horse('a01','東京','10:00'), horses:[{name:'ミスティマウンテン'}]}, {...horse('b01','京都',undefined), horses:[{name:'ピエナオルカ'}]}];
  const matches = matchRacesToMemos(races, [{id:'memo',channelId:'test',channelName:'test',authorName:'test',timestamp:'2026-10-01T00:00:00Z',content:'ミスティマウンテン\n好走\n\nピエナオルカ\n注目'}]);
  assert.equal(matches[0].startTime, '10:00');
  assert.equal(matches[1].startTime, undefined);
});
test('manual race data accepts optional actual scheduled times without inventing missing ones', async () => {
  const source = process.env.RACE_SOURCE, manual = process.env.MANUAL_RACES_JSON;
  try {
    process.env.RACE_SOURCE='manual';
    process.env.MANUAL_RACES_JSON=JSON.stringify([{date:'2026-10-11',startTime:'9:05',horses:['馬A']},{date:'2026-10-11',horses:['馬B']}]);
    const result = await getRaces(['2026-10-11']);
    assert.deepEqual(result.races.map(r => r.startTime), ['09:05',undefined]);
    assert.equal(result.externalRequestCount,0);
  } finally {
    if (source === undefined) delete process.env.RACE_SOURCE; else process.env.RACE_SOURCE=source;
    if (manual === undefined) delete process.env.MANUAL_RACES_JSON; else process.env.MANUAL_RACES_JSON=manual;
  }
});
test('day tabs render chronological labels for only the active date, with honest missing-time fallback', () => {
  const props = {dates:['2026-10-10','2026-10-11'],raceDates:['2026-10-10','2026-10-11'],diagnostics:{errors:[],generatedAt:'2026-10-11T00:00:00Z'},monitorNow:'2026-10-11T00:00:00Z',syncStatus:null};
  const matches = [horse('tokyo02','東京','10:35'),horse('kyoto01','京都','10:00'),horse('unknown03','東京'),{...horse('past01','東京','09:00'),date:'2026-10-10'}];
  for (const active of props.dates) {
    const WeekTabs = load('components/week-tabs.tsx',{react:{...React,useState:()=>[active,()=>{}]}}).default;
    const html = renderToStaticMarkup(React.createElement(WeekTabs,{...props,matches}));
    assert.match(html,/発走時刻順（日本時間）/);
    if (active === '2026-10-11') {
      assert.ok(html.indexOf('10:00') < html.indexOf('10:35'));
      assert.match(html,/時刻未取得/);
      assert.doesNotMatch(html,/馬past01/);
    } else {
      assert.match(html,/09:00/);
      assert.doesNotMatch(html,/馬tokyo02/);
    }
  }
});

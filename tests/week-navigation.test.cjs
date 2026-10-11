const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(relative, overrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  const module = {exports: {}};
  const localRequire = name => {
    if (name in overrides) return overrides[name];
    if (name.startsWith('.')) return load(path.join(path.dirname(relative), `${name}.tsx`), overrides);
    return require(name);
  };
  new Function('exports', 'require', 'module', output)(module.exports, localRequire, module);
  return module.exports;
}
const { WeekLink, ReturnToCurrentWeek } = load('components/week-navigation.tsx');

function withBrowser(run) {
  const original = global.window;
  const entries = ['https://fixture.invalid/?week=last'];
  let index = 0;
  let scrolls = 0;
  global.window = {
    location: {get href() {return entries[index];}},
    history: {pushState(_state, _unused, href) {
      entries.splice(index + 1);
      entries.push(new URL(href, entries[index]).href);
      index++;
    }},
    scrollTo() {scrolls++;},
  };
  const click = (href, options = {}) => {
    let prevented = false;
    WeekLink({href, children:'week'}).props.onClick({button:0, preventDefault() {prevented = true;}, ...options});
    return prevented;
  };
  try { run({entries, click, back: () => index--, forward: () => index++, scrolls: () => scrolls}); }
  finally {global.window = original;}
}

test('return control has an explicit label and real root link for direct visits and no-JS fallback', () => {
  const html = renderToStaticMarkup(React.createElement(ReturnToCurrentWeek));
  assert.match(html, /href="\/"/);
  assert.match(html, /今週のメモ馬に戻る/);
  assert.match(html, /aria-label="週の切り替え"/);
});

test('direct last-week entry returns to current without relying on a prior history entry', () => {
  withBrowser(({click, entries, scrolls}) => {
    assert.equal(click('/'), true);
    assert.equal(window.location.href, 'https://fixture.invalid/');
    assert.equal(entries.length, 2);
    assert.equal(scrolls(), 1);
  });
});

test('repeated return taps do not duplicate history; Back and Forward retain the chosen week', () => {
  withBrowser(({click, entries, back, forward}) => {
    click('/'); click('/');
    assert.equal(entries.length, 2);
    back(); assert.equal(window.location.href, 'https://fixture.invalid/?week=last');
    forward(); assert.equal(window.location.href, 'https://fixture.invalid/');
    click('/?week=last'); click('/?week=last');
    assert.equal(entries.length, 3);
    back(); assert.equal(window.location.href, 'https://fixture.invalid/');
  });
});

test('modified clicks preserve native new-tab behavior', () => {
  withBrowser(({click, entries, scrolls}) => {
    for (const options of [{metaKey:true}, {ctrlKey:true}, {shiftKey:true}, {altKey:true}, {button:1}, {defaultPrevented:true}]) {
      assert.equal(click('/', options), false);
    }
    assert.equal(entries.length, 1);
    assert.equal(scrolls(), 0);
  });
});

test('return control is present while previous-week data loads and after a loading error', () => {
  for (const error of ['', '読み込み失敗']) {
    let state = 0;
    const {default: PublishedPage} = load('components/published-page.tsx', {
      react: {...React, useEffect: () => {}, useState: () => [[null, !error, error, null, 0][state++], () => {}]},
      'next/navigation': {useSearchParams: () => new URLSearchParams('week=last')},
      './week-tabs': {default: () => null},
    });
    const html = renderToStaticMarkup(React.createElement(PublishedPage, {lastWeekStart:'2026-10-03'}));
    assert.match(html, /今週のメモ馬に戻る/);
  }
});

test('loaded previous week includes the return control; current week does not', () => {
  const {PublishedView} = load('components/published-page.tsx', {
    'next/navigation': {}, './week-tabs': {default: () => null},
  });
  const props = {snapshot:{dates:['2026-10-03'], raceDates:[], matches:[]}, monitorNow:'2026-10-11T00:00:00Z'};
  assert.match(renderToStaticMarkup(React.createElement(PublishedView, {...props, isLastWeek:true})), /今週のメモ馬に戻る/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(PublishedView, {...props, isLastWeek:false})), /今週のメモ馬に戻る/);
});

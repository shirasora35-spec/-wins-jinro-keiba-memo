const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Mouten branding uses the recovered local icon through responsive image optimization', () => {
  const page = read('components/published-page.tsx');
  assert.match(page, /src="\/mouten-horse\.jpg"/);
  assert.match(page, /sizes="\(max-width: 480px\) 88px, 156px"/);
  assert.match(page, /alt="盲点の馬のキャラクター"/);
  assert.ok(fs.statSync(path.join(__dirname, '..', 'public/mouten-horse.jpg')).size > 0);
});

test('light design retains keyboard focus, narrow phone wrapping, and sticky current-week return', () => {
  const css = read('app/globals.css');
  assert.match(css, /color-scheme: light/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 359px\)/);
  assert.match(css, /\.current-week-navigation \{[^}]*position: sticky/);
  assert.match(css, /\.memo-body pre \{[^}]*white-space: pre-wrap/);
  assert.match(css, /prefers-reduced-motion/);
});

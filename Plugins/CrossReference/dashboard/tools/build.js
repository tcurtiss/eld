#!/usr/bin/env node
// Assembles dist/image-anatomy.html from src/page.html, src/core.js and src/ui.js.
//
//   node tools/build.js                      -> dist/image-anatomy.html (D3 from cdnjs)
//   node tools/build.js --d3 path/d3.min.js  -> inlines a local D3 copy (offline use and headless tests)
//   node tools/build.js --out some/file.html
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const out = path.resolve(root, opt('--out') || 'dist/image-anatomy.html');
const d3Path = opt('--d3');
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js';

let page = fs.readFileSync(path.join(root, 'src/page.html'), 'utf8');
const core = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8');
const relationships = fs.readFileSync(path.join(root, 'src/relationships.js'), 'utf8');
const explorer = fs.readFileSync(path.join(root, 'src/explorer.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'src/ui.js'), 'utf8');
if (!uiSource.includes('/*EXPLORER*/')) { console.error('src/ui.js is missing the /*EXPLORER*/ marker'); process.exit(1); }
const ui = uiSource.replace('/*EXPLORER*/', () => explorer);

for (const marker of ['/*CORE*/', '/*RELATIONSHIPS*/', '/*UI*/']) {
  if (!page.includes(marker)) { console.error(`src/page.html is missing the ${marker} marker`); process.exit(1); }
}
// Function replacements so "$&"-style patterns in the sources are not interpreted.
page = page.replace('/*CORE*/', () => core).replace('/*RELATIONSHIPS*/', () => relationships).replace('/*UI*/', () => ui);

if (d3Path) {
  const d3 = fs.readFileSync(path.resolve(d3Path), 'utf8');
  const tag = `<script src="${CDN}"></script>`;
  if (!page.includes(tag)) { console.error('Could not find the D3 script tag to replace'); process.exit(1); }
  page = page.replace(tag, () => `<script>${d3}</script>`);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${(page.length / 1024).toFixed(0)} KiB${d3Path ? ', D3 inlined' : ''})`);

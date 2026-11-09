#!/usr/bin/env node
// Builds a draft PowerPoint deck from the output of tools/capture.py.
//
//   node tools/make-deck.js                         -> presentation/image-anatomy-draft.pptx
//   node tools/make-deck.js --in presentation --out deck.pptx
//
// Needs pptxgenjs (a dev dependency: run npm install once). Slide titles are the dashboard's
// own computed takeaways, so rerunning capture.py and this script on a new export updates
// every number. The deck is a starting point: edit the wording and layout in PowerPoint.
'use strict';
const fs = require('fs');
const path = require('path');

let pptxgen;
try { pptxgen = require('pptxgenjs'); } catch {
  console.error('pptxgenjs is not installed. Run npm install once, then try again.');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const inDir = path.resolve(root, opt('--in', 'presentation'));
const out = path.resolve(root, opt('--out', path.join(path.relative(root, inDir), 'image-anatomy-draft.pptx')));

const dataPath = path.join(inDir, 'takeaways.json');
if (!fs.existsSync(dataPath)) { console.error(`${path.relative(process.cwd(), dataPath)} not found. Run python3 tools/capture.py first.`); process.exit(1); }
const D = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const T = D.takeaways, R = D.rows;
const synthetic = D.source === 'synthetic sample';

// ---------- numbers from the takeaway sentences (each falls back to the sentence itself)
const SZ = '([\\d.,]+\\s?(?:[KMG]i)?B)';
const match = (s, re) => (s || '').match(new RegExp(re)) || null;
const firstSentence = s => (s || '').split(/(?<=[.!?])\s+(?=[A-Z0-9])/)[0].replace(/[.]$/, '');
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

const ram = match(T.ram, `^${SZ} stored in RAM of ${SZ} \\((\\d+%)\\), ${SZ} free`);
const input = match(T.input, `^${SZ} of sections in the object files\\. Garbage collection removes ${SZ} \\((\\d+%)\\)`);
const comp = match(T.compression, `Only (\\d+%) of the compressible bytes are compressed today; the rest could save up to ${SZ} more`);
const whatIf = match(T.whatIf, `^Compressing the (\\d+) selected items? saves ${SZ} more: RAM use goes from ${SZ} to ${SZ}`);
const deadWhole = match(T.dead, '(\\d+) subsystems are dropped completely');
const deadFiles = match(T.deadFiles, `^([\\d,]+) object files contribute nothing to the image \\(${SZ}\\)`);
const ret = match(T.retained, `^(\\S+) alone keeps ${SZ} stored in RAM, (\\d+%)`);
const roles = match(T.roles, `^(\\d+) subsystems \\(${SZ}, (\\d+%) of what is stored\\) are shared.*?(\\d+) are isolated`);
const tmShare = match(T.treemap, 'hold (\\d+%)');
const roleCallout = (T.roles.match(/[^.]*(?:feature that became infrastructure|behaves like)[^.]*\./) || [''])[0].trim();
const singleOwner = R.candidates.filter(r => r.detail.startsWith('Reached only through'))
  .map(r => ({ name: r.name, via: r.detail.replace('Reached only through ', ''), value: r.value }));
const droppedWhole = R.dead.filter(r => r.detail === 'Dropped completely');

// ---------- theme and layouts
const THEME = {
  name: 'Image Proctologist', headFontFace: 'Arial', bodyFontFace: 'Arial',
  colors: { dk1: '16202A', lt1: 'FFFFFF', dk2: '4B5967', lt2: 'F1F3F6', accent1: 'C0186A', accent2: '2A8C7E',
    accent3: 'D99A2B', accent4: '8A3412', accent5: '6B7A89', accent6: '3D6FB6', hlink: 'C0186A', folHlink: '8A3412' },
};
const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = 'Image Proctologist';
pres.subject = D.title || 'Firmware image proctology';
const C = pres.SchemeColor;
const SW = 13.333, M = 0.6, CW = SW - 2 * M; // slide width, margin, content width
const TOP = 2.05, BOTTOM = 6.75, CH = BOTTOM - TOP; // content area below the title
const footer = synthetic ? 'Image Proctologist draft. Synthetic data: the numbers are illustrative.' : `Image Proctologist draft. Data: ${D.title || D.source}.`;

pres.defineSlideMaster({
  title: 'Title', background: { color: THEME.colors.dk1 },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: M, y: 2.0, w: CW, h: 1.3, fontSize: 54, bold: true, color: C.background1, align: 'left', valign: 'bottom', margin: 0 }, text: '' } },
    { placeholder: { options: { name: 'subtitle', type: 'body', x: M, y: 3.45, w: CW, h: 1.1, fontSize: 22, color: 'D5DDE5', valign: 'top', margin: 0 }, text: '' } },
    { placeholder: { options: { name: 'meta', type: 'body', x: M, y: 6.1, w: CW, h: 0.7, fontSize: 13, color: '9AA7B4', valign: 'bottom', margin: 0 }, text: '' } },
  ],
});
const contentObjects = (dark) => [
  { placeholder: { options: { name: 'kicker', type: 'body', x: M, y: 0.45, w: CW, h: 0.35, fontSize: 14, bold: true, color: dark ? 'F07AB0' : C.accent1, valign: 'top', margin: 0 }, text: '' } },
  { placeholder: { options: { name: 'title', type: 'title', x: M, y: 0.85, w: CW, h: 1.05, fontSize: 28, bold: true, color: dark ? C.background1 : C.text1, align: 'left', valign: 'top', margin: 0 }, text: '' } },
  { text: { text: footer, options: { x: M, y: 7.0, w: 9, h: 0.3, fontSize: 10, color: dark ? '9AA7B4' : C.text2, margin: 0 } } },
];
pres.defineSlideMaster({ title: 'Content', background: { color: 'FFFFFF' }, objects: contentObjects(false), slideNumber: { x: SW - M - 0.6, y: 7.0, w: 0.6, h: 0.3, fontSize: 10, color: THEME.colors.dk2, align: 'right' } });
pres.defineSlideMaster({ title: 'Closing', background: { color: THEME.colors.dk1 }, objects: contentObjects(true), slideNumber: { x: SW - M - 0.6, y: 7.0, w: 0.6, h: 0.3, fontSize: 10, color: '9AA7B4', align: 'right' } });

// ---------- helpers
const img = name => D.images[name];
// Place a captured view inside a box, keeping its aspect ratio; returns the rectangle used.
function addView(slide, name, box, align = 'left') {
  const im = img(name);
  if (!im) return null;
  const ar = im.width / im.height;
  let w = box.w, h = w / ar;
  if (h > box.h) { h = box.h; w = h * ar; }
  const x = align === 'center' ? box.x + (box.w - w) / 2 : box.x;
  slide.addImage({ path: path.join(inDir, im.png), x, y: box.y, w, h, altText: name.replace(/^\d+\w?-/, '').replace(/-/g, ' '), objectName: name });
  return { x, y: box.y, w, h };
}
function stat(slide, x, y, w, value, label, opts = {}) {
  const h = opts.h || 1.55;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: opts.dark ? '24313D' : C.background2 }, line: { type: 'none' }, objectName: 'stat ' + label });
  slide.addText(value, { x: x + 0.25, y: y + 0.15, w: w - 0.5, h: 0.75, fontSize: opts.size || 40, bold: true, color: opts.dark ? 'F07AB0' : C.accent1, valign: 'middle', margin: 0, isTextBox: true, fit: 'shrink' });
  slide.addText(label, { x: x + 0.25, y: y + 0.9, w: w - 0.5, h: h - 1.0, fontSize: 14, color: opts.dark ? 'D5DDE5' : C.text2, valign: 'top', margin: 0, isTextBox: true });
}
function para(slide, items, box, size = 16) {
  const runs = items.map((it, i) => {
    const o = typeof it === 'string' ? { text: it } : it;
    return { text: o.text, options: { bullet: o.bullet || false, bold: o.bold || false, color: o.color || C.text1, breakLine: i < items.length - 1, paraSpaceAfter: 10 } };
  });
  slide.addText(runs, { ...box, fontSize: size, valign: 'top', margin: 0, isTextBox: true });
}
const content = (kicker, title, notes) => {
  const s = pres.addSlide({ masterName: 'Content' });
  s.addText(kicker, { placeholder: 'kicker' });
  s.addText(title, { placeholder: 'title' });
  if (notes) s.addNotes(notes);
  return s;
};

// ---------- 1. Title
{
  const s = pres.addSlide({ masterName: 'Title' });
  s.addText('Image Proctologist', { placeholder: 'title' });
  s.addText('Where the RAM goes, what the linker throws away, and what we could save', { placeholder: 'subtitle' });
  const when = (D.generated || '').slice(0, 10);
  s.addText(`${D.title || ''}${when ? `. Captured ${when}` : ''}.${synthetic ? ' Synthetic data: the numbers are illustrative.' : ''}`, { placeholder: 'meta' });
  s.addNotes(`Draft deck generated from the Image Proctologist dashboard (${D.source}). ${T.facts}`);
}

// ---------- 2. At a glance
{
  const title = ram && comp ? `RAM is ${ram[3]} full, and compression could still save up to ${comp[2]}` : firstSentence(T.ram);
  const s = content('At a glance', title, [T.ram, T.input, T.facts].join('\n\n'));
  const cards = [
    ram && [ram[1], `stored in RAM of ${ram[2]} (${ram[3]})`],
    input && [input[2], `of linker input thrown away (${input[3]})`],
    comp && [comp[2], 'more could be saved by compression'],
    ret && [ret[2], `kept in the image by ${ret[1]} alone`],
  ].filter(Boolean);
  const gap = 0.3, w = (CW - gap * (cards.length - 1)) / cards.length;
  cards.forEach(([v, l], i) => stat(s, M + i * (w + gap), TOP, w, v, l));
  addView(s, '01-memory', { x: M, y: TOP + 1.95, w: CW, h: CH - 1.95 }, 'center');
}

// ---------- 3. Where the RAM goes
{
  const s = content('Where the RAM goes', cap(firstSentence(T.treemap)), T.treemap);
  const r = addView(s, '02-treemap', { x: M, y: TOP, w: 8.2, h: CH });
  const x = (r ? r.x + r.w : M + 8.2) + 0.45, w = SW - M - x;
  if (tmShare) stat(s, x, TOP, w, tmShare[1], 'of RAM is in the three largest top-level directories');
  para(s, ['Each block is a part of the source tree, sized by the RAM it takes.', 'Color shows the top-level directory; the largest subsystems are labeled.'],
    { x, y: TOP + (tmShare ? 1.9 : 0), w, h: 2.4 });
}

// ---------- 4. What the linker throws away
{
  const s = content('What the linker throws away', firstSentence(T.dead), [T.dead, T.deadFiles].join('\n\n'));
  const r = addView(s, '03-dead', { x: M, y: TOP, w: 6.2, h: CH });
  const x = (r ? r.x + r.w : M + 6.2) + 0.5, w = SW - M - x;
  if (input) stat(s, x, TOP, w, input[2], `of the ${input[1]} the linker is given never reaches the image`);
  const items = [];
  if (droppedWhole.length) {
    items.push({ text: `${deadWhole ? deadWhole[1] : droppedWhole.length} features are compiled but never used, for example:`, bold: true });
    droppedWhole.slice(0, 4).forEach(r => items.push({ text: `${r.name} (${r.value})`, bullet: true }));
  }
  if (deadFiles) items.push({ text: `${deadFiles[1]} object files contribute nothing to the image (${deadFiles[2]}).` });
  items.push({ text: 'This costs build time and maintenance, not memory.', color: C.text2 });
  para(s, items, { x, y: TOP + 1.9, w, h: CH - 1.9 });
}

// ---------- 5. Compression today
{
  const title = comp ? `Only ${comp[1]} of what could be compressed is compressed today` : firstSentence(T.compression);
  const s = content('What compression saves', title, T.compression);
  const r = addView(s, '04-compression', { x: M, y: TOP, w: 6.2, h: CH });
  const x = (r ? r.x + r.w : M + 6.2) + 0.5, w = SW - M - x;
  if (comp) stat(s, x, TOP, w, comp[2], 'more could be saved by compressing the rest');
  para(s, ['Each bar is one subsystem: what it stores in RAM, what compression could still save, and what it already saves.',
    { text: 'Compressed code costs decompression time when it runs, so the best candidates are rarely used features and large data.', color: C.text2 }],
  { x, y: TOP + (comp ? 1.9 : 0), w, h: 2.8 });
}

// ---------- 6. What-if
if (whatIf) {
  const sameUnit = whatIf[3].split(' ')[1] === whatIf[4].split(' ')[1];
  const title = `Compressing ${whatIf[1]} more items would cut RAM from ${sameUnit ? whatIf[3].split(' ')[0] : whatIf[3]} to ${whatIf[4]}`;
  const s = content('What compression could save', title, [T.whatIf, T.ramProjected].join('\n\n'));
  const r = addView(s, '04b-compression-candidates', { x: M, y: TOP, w: 4, h: CH });
  const x = (r ? r.x + r.w : M + 4) + 0.5, w = SW - M - x;
  const half = (w - 0.3) / 2;
  stat(s, x, TOP, half, whatIf[2], `less RAM, from ${whatIf[1]} rarely used features and large data`);
  stat(s, x + half + 0.3, TOP, half, whatIf[4], `RAM use afterwards, down from ${whatIf[3]}`);
  s.addText('RAM after compressing them', { x, y: TOP + 1.95, w, h: 0.35, fontSize: 14, bold: true, color: C.text1, margin: 0, isTextBox: true });
  addView(s, '04c-memory-projected', { x, y: TOP + 2.4, w, h: CH - 2.4 });
}

// ---------- 7. What you could cut
{
  const s = content('What you could cut', firstSentence(T.retained), T.retained);
  const r = addView(s, '05-retained', { x: M, y: TOP, w: 6.6, h: CH });
  const x = (r ? r.x + r.w : M + 6.6) + 0.5, w = SW - M - x;
  const items = [{ text: 'Each bar is everything that is only reachable through one function: what the image would lose if it went away.' }];
  if (singleOwner.length) {
    items.push({ text: 'Large features that hang off a single function:', bold: true });
    singleOwner.slice(0, 3).forEach(o => items.push({ text: `${o.name} (${o.value}), only through ${o.via}`, bullet: true }));
  }
  para(s, items, { x, y: TOP, w, h: CH }, 15);
}

// ---------- 8. Shared versus isolated
{
  const title = roles ? `${roles[1]} subsystems are shared; ${roles[4]} are isolated behind narrow interfaces` : firstSentence(T.roles);
  const s = content('Shared versus isolated', title, [T.roles, T.blobs, T.layers].join('\n\n'));
  const r = addView(s, '06-roles', { x: M, y: TOP, w: 8.9, h: CH });
  const x = (r ? r.x + r.w : M + 8.9) + 0.45, w = SW - M - x;
  para(s, ['Each bubble is a subsystem, sized by its RAM.', 'Left: used by few others. Right: used across the image.', 'Top: a narrow interface, easy to separate.'],
    { x, y: TOP, w, h: 2.6 }, 15);
  if (roleCallout) {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: TOP + 2.75, w, h: 1.9, rectRadius: 0.08, fill: { color: C.background2 }, line: { type: 'none' }, objectName: 'callout' });
    s.addText(roleCallout, { x: x + 0.2, y: TOP + 2.9, w: w - 0.4, h: 1.6, fontSize: 14, color: C.accent1, bold: true, valign: 'top', margin: 0, isTextBox: true });
  }
}

// ---------- 9. Next steps
{
  const s = pres.addSlide({ masterName: 'Closing' });
  s.addText('Next steps', { placeholder: 'kicker' });
  s.addText('Three ways to make the image smaller and easier to change', { placeholder: 'title' });
  const cards = [
    ['Compress rarely used features and large data', whatIf ? `${whatIf[2]} less RAM, from ${whatIf[3]} to ${whatIf[4]}.` : (comp ? `Up to ${comp[2]} could be saved.` : T.compression)],
    ['Remove features nobody calls', [deadWhole && `${deadWhole[1]} subsystems are dropped completely at link time.`, deadFiles && `${deadFiles[1]} object files contribute nothing.`].filter(Boolean).join(' ') || firstSentence(T.dead) + '.'],
    ['Review features that hang off one function', singleOwner.length ? `${singleOwner.slice(0, 2).map(o => o.name).join(' and ')} could be loaded on demand or made optional.` : firstSentence(T.retained) + '.'],
  ];
  if (synthetic) cards.push(['Confirm on the real image', 'These numbers come from synthetic data. Rerun the capture on an export from the ELD plugin.']);
  const gap = 0.3, w = (CW - gap * (cards.length - 1)) / cards.length;
  cards.forEach(([h, b], i) => {
    const x = M + i * (w + gap);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: TOP + 0.2, w, h: 3.6, rectRadius: 0.08, fill: { color: '24313D' }, line: { type: 'none' }, objectName: 'step ' + (i + 1) });
    s.addText(String(i + 1), { x: x + 0.3, y: TOP + 0.45, w: 0.8, h: 0.8, fontSize: 40, bold: true, color: 'F07AB0', margin: 0, isTextBox: true });
    s.addText(h, { x: x + 0.3, y: TOP + 1.35, w: w - 0.6, h: 1.0, fontSize: 18, bold: true, color: C.background1, valign: 'top', margin: 0, isTextBox: true });
    s.addText(b, { x: x + 0.3, y: TOP + 2.4, w: w - 0.6, h: 1.3, fontSize: 14, color: 'D5DDE5', valign: 'top', margin: 0, isTextBox: true });
  });
  s.addNotes('Each step comes from the views in this deck. The dashboard generates the linker-script rules for step 1.');
}

// ---------- 10. Appendix: dependencies
if (img('07-dsm')) {
  const s = content('Appendix: how directories depend on each other', cap(firstSentence(T.dsm).replace(/ and (\d+%) cross a top-level directory/, ', $1 cross directories')), T.dsm);
  const r = addView(s, '07-dsm', { x: M, y: TOP, w: 6.4, h: CH });
  const x = (r ? r.x + r.w : M + 6.4) + 0.5, w = SW - M - x;
  para(s, ['Each row uses the columns. Darker cells mean more references.', 'Weight inside the outlined blocks stays within a directory; weight outside them couples directories together.'],
    { x, y: TOP, w, h: 3 }, 15);
}

// ---------- write, then give the deck its theme colors
async function applyTheme(file) {
  const JSZip = require(require.resolve('jszip', { paths: [require.resolve('pptxgenjs')] }));
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const part = 'ppt/theme/theme1.xml';
  const slots = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  const scheme = `<a:clrScheme name="${THEME.name}">` + slots.map(k => `<a:${k}><a:srgbClr val="${THEME.colors[k]}"/></a:${k}>`).join('') + '</a:clrScheme>';
  const xml = (await zip.file(part).async('string'))
    .replace(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/, () => scheme)
    .replace(/(<a:(?:theme|fontScheme)\b[^>]*?\bname=")[^"]*"/g, (_, head) => `${head}${THEME.name}"`);
  zip.file(part, xml);
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

(async () => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await pres.writeFile({ fileName: out });
  await applyTheme(out);
  console.log(`Wrote ${path.relative(process.cwd(), out)}`);
})();

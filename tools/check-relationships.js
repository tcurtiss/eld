'use strict';
const assert = require('node:assert/strict');
const {analyze, toColumnar} = require('../src/core.js');
const {RelationshipModel} = require('../src/relationships.js');

const data = {nodes: [
  {id: 10, name: 'entry', path: 'app/front/main.o', kind: 'code', size: 32, root: true},
  {id: 20, name: 'helper', path: 'base/engine/helper.o', kind: 'code', size: 24},
  {id: 30, name: 'config', path: 'app/config/config.o', kind: 'data', size: 16},
  {id: 40, name: 'shared', path: 'base/memory/data.o', kind: 'rodata', size: 8},
  {id: 50, name: 'excluded', path: 'hidden/plugin/main.o', kind: 'code', size: 4, out: '.remove'},
], edges: [
  {src: 10, dst: 20, count: 10}, {src: 10, dst: 40, count: 90},
  {src: 20, dst: 10, count: 2}, {src: 20, dst: 30, count: 3},
  {src: 30, dst: 40, count: 4}, {src: 50, dst: 20, count: 9},
], symbolDetails: {version: 1, sourceFiles: ['src/app.cpp'], symbols: [
  {id: 0, section: 10, chunk: 0, name: 'entry', linkageName: '_Z5entryv', offset: 0, size: 32, flags: 4, sourceFile: 0, sourceLine: 12},
  {id: 1, section: 20, chunk: 1, name: 'helper', linkageName: 'helper', offset: 0, size: 24, flags: 4},
  {id: 2, section: 30, chunk: 2, name: 'config', linkageName: 'config', offset: 0, size: 16, flags: 8},
  {id: 3, section: 50, chunk: 3, name: 'excluded', linkageName: 'excluded', offset: 0, size: 4, flags: 4},
], refs: [
  {sourceSection: 10, targetSection: 20, src: 0, dst: 1, count: 10, flags: 0},
  {sourceSection: 10, targetSection: 40, src: 0, dst: -1, count: 90, flags: 0},
  {sourceSection: 20, targetSection: 10, src: 1, dst: 0, count: 2, flags: 8},
  {sourceSection: 20, targetSection: 30, src: 1, dst: 2, count: 3, flags: 0},
  {sourceSection: 30, targetSection: 40, src: 2, dst: -1, count: 4, flags: 0},
  {sourceSection: 50, targetSection: 20, src: 3, dst: 1, count: 9, flags: 0},
  {sourceSection: 10, targetSection: 10, src: 0, dst: 0, count: 7, flags: 0},
]}};

for (const input of [data, toColumnar(data)]) {
  const a = analyze(input, {excludeOutput: out => out === '.remove'}), m = new RelationshipModel(a);
  const key = name => 'm:' + a.mods.findIndex(n => n.name === name), front = key('app/front'), engine = key('base/engine'), config = key('app/config');
  const names = result => result.nodes.map(n => n.name);
  const direct = m.query({level: 'mod', focus: [front], direction: 'out', strongest: 0});
  assert.ok(names(direct).includes('base/engine'));
  assert.ok(!names(direct).includes('app/config'));
  const indirect = m.query({level: 'mod', focus: [front], direction: 'out', hops: 2, strongest: 0});
  assert.ok(names(indirect).includes('app/config'));
  const cc = m.query({level: 'mod', focus: [front], direction: 'out', type: 'cc', metric: 'share'});
  assert.equal(cc.edges.find(e => cc.g.meta(e.source).key === front).share, .1);
  assert.equal(m.query({level: 'mod', focus: [front], shared: false, tau: .1}).g.out[m.position(cc.g, front)], 100);
  const limited = m.query({level: 'mod', maxNodes: 2, maxEdges: 1, strongest: 0});
  assert.equal(limited.nodes.length, 2); assert.equal(limited.edges.length, 1);
  assert.ok(limited.totalEdges > limited.edges.length); assert.ok(limited.shownWeight < limited.totalWeight);
  const pruned = m.query({level: 'mod', maxEdges: 1, strongest: 1});
  const full = m.query({level: 'mod', strongest: 0});
  const ranks = result => m.radial(result).map(n => [n.key, n.dependents, n.rankIncoming, n.targetRadius]);
  assert.deepEqual(ranks(pruned), ranks(full));
  assert.equal(m.radial(full)[0].name, 'base/memory');
  assert.equal(m.radial(full)[0].dependents, 2);
  assert.equal(m.radial(full)[0].rankIncoming, 94);
  const hiddenCallers = m.query({level: 'mod', focus: [config], direction: 'out'});
  assert.ok(!names(hiddenCallers).includes('app/front'));
  assert.equal(hiddenCallers.nodes.find(n => n.name === 'base/memory').dependents, 2);
  const layoutLinks = m.displayedLinks(pruned);
  assert.ok(layoutLinks.length > pruned.edges.length);
  assert.deepEqual(layoutLinks.map(e => e.source + ':' + e.target).sort(), m.displayedLinks(full).map(e => e.source + ':' + e.target).sort());
  for (const e of pruned.edges) assert.ok(layoutLinks.some(l => l.source === e.source && l.target === e.target && l.count === e.count));
  const groups = m.communities(full);
  assert.deepEqual(groups.groups.flatMap(g => g.members).sort((x, y) => x - y), full.nodes.map(n => n.index).sort((x, y) => x - y));
  assert.ok(groups.groups.every((g, i) => !i || g.members.length <= groups.groups[i - 1].members.length));
  assert.deepEqual(m.communities(m.query({level: 'mod', strongest: 0})).groups, groups.groups); // Deterministic.
  const focused = m.query({level: 'mod', focus: [config], direction: 'both'});
  assert.equal(m.radial(focused)[0].key, config); // The focus leads its neighborhood, not the most widely used item.
  const depths = m.depths(pruned), group = index => depths.groups[depths.groupOf.get(index)];
  assert.ok(depths.relationships > pruned.edges.length);
  const fi = m.position(pruned.g, front), ei = m.position(pruned.g, engine), ci = m.position(pruned.g, config);
  assert.equal(group(fi).id, group(ei).id);
  assert.ok(group(fi).cyclic);
  assert.equal(group(fi).depth, group(ci).depth + 1);
  assert.equal(depths.flow.reduce((sum, f) => sum + f.count, 0), 109);
  const codeDepth = m.depths(m.query({level: 'mod', type: 'cc'}));
  assert.equal(codeDepth.groups.filter(g => g.cyclic).length, 1);
  const dataDepth = m.depths(m.query({level: 'mod', type: 'dd'}));
  assert.ok(dataDepth.groups.every(g => !g.cyclic));
  assert.equal(m.depths(m.query({level: 'mod', focus: ['m:999']})).groups.length, 0);
  assert.deepEqual(m.path(direct.g, front, config).map(n => n.key), [front, engine, config]);
  assert.deepEqual(m.path(direct.g, config, front), []);
  const symbols = m.query({level: 'symbol', focus: ['s:0'], direction: 'out', strongest: 0});
  assert.ok(names(symbols).includes('helper')); assert.ok(names(symbols).includes('shared'));
  assert.ok(!names(symbols).includes('excluded'));
  assert.equal(symbols.g.out[0], 100); // Same-symbol relocations do not inflate external shares.
  assert.equal(symbols.nodes.find(n => n.name === 'entry').dependents, 1);
  assert.equal(symbols.nodes.find(n => n.name === 'entry').rankIncoming, 2);
  assert.equal(m.incomingImportance(m.symbols(), m.position(m.symbols(), 'n:3'), 'cc').dependents, 0);
  assert.equal(m.find('_Z5entryv', 'symbol')[0].key, 's:0');
  assert.equal(m.find('src/app.cpp', 'symbol')[0].source, 'src/app.cpp');
  const reverse = m.query({level: 'symbol', focus: ['s:1'], direction: 'out'}).edges.find(e => e.target === 0);
  assert.ok(reverse.flags & 8);
  const ref = m.preview(m.groupMeta(front), m.groupMeta(engine))[0];
  assert.equal(ref.src.sourceLine, 12); assert.equal(ref.dst.name, 'helper');
  assert.equal(m.evidence(m.groupMeta(front), m.groupMeta(engine))[0].count, 10);
  assert.deepEqual(m.path(symbols.g, 's:0', 's:2').map(n => n.key), ['s:0', 's:1', 's:2']);
  assert.ok(m.path(symbols.g,'s:1','s:0')[1].viaFlags&8);
  assert.deepEqual(m.query({level:'symbol',focus:['section:0']}).seeds,[0]);
  assert.equal(m.query({level:'mod',focus:['m:999']}).nodes.length,0);
  const dom = a.mods[+front.split(':')[1]].di, expanded = m.query({expanded: [dom], strongest: 0});
  assert.ok(expanded.nodes.some(n => n.key === front));
  assert.ok(!expanded.nodes.some(n => n.key === 'd:' + dom));
  assert.equal(expanded.nodes.reduce((sum, n) => sum + n.bytes, 0), a.total.live);
}
{
  // A fully eliminated subsystem is left out of an expanded component and reported.
  const {generateSample} = require('../src/core.js');
  const a = analyze(generateSample({symbols: 8000})), m = new RelationshipModel(a), di = a.doms.findIndex(d => d.name === 'drivers');
  const r = m.query({level: 'dom', expanded: [di], focus: ['d:' + di]});
  assert.ok(!r.nodes.some(n => n.name === 'drivers/flexray'));
  assert.ok(r.nodes.some(n => n.name.startsWith('drivers/')));
  assert.deepEqual(r.omitted, ['drivers/flexray']);
  assert.deepEqual(m.query({level: 'dom'}).omitted, []);
}
const plain = JSON.parse(JSON.stringify(data)); delete plain.symbolDetails;
const m = new RelationshipModel(analyze(plain));
// Breadth wins over relocation volume; repeated pairs and self references
// cannot make one caller look like many dependents.
const meta = i => ({index: i, key: 'n:' + i, name: ['caller', 'heavy', 'popular', 'light'][i]});
const rankingGraph = m.graphData(4, [0, 0, 0, 3, 0, 1], [1, 1, 2, 2, 3, 1], [1000, 2000, 1, 1, 5, 9000], [], meta);
const rankingNodes = [0, 1, 2, 3].map(i => ({...meta(i), ...m.incomingImportance(rankingGraph, i)}));
const layout = m.radial({nodes: rankingNodes});
assert.deepEqual(layout.map(n => n.name), ['popular', 'heavy', 'light', 'caller']);
assert.equal(layout[1].dependents, 1); assert.equal(layout[1].rankIncoming, 3000);
assert.deepEqual([layout[0].seedX, layout[0].seedY, layout[0].targetRadius], [0, 0, 0]);
assert.ok(layout.slice(1).every(n => Math.abs(Math.hypot(n.seedX, n.seedY) - n.targetRadius) < 1e-9));
assert.deepEqual(m.radial({nodes: rankingNodes.slice().reverse()}), layout);
assert.deepEqual(m.radial({nodes: []}), []);
assert.equal(m.radial({nodes: [rankingNodes[0]]})[0].targetRadius, 0);
const rings = m.radial({nodes: Array.from({length: 30}, (_, i) => ({key: 'n:' + i, name: String(i), dependents: 30 - i, rankIncoming: 1}))});
assert.ok(rings.every((n, i) => !i || n.targetRadius >= rings[i - 1].targetRadius));
assert.deepEqual([1, 2, 3].map(band => rings.filter(n => n.radialBand === band).length), [6, 12, 11]);
assert.ok(m.query({level: 'symbol', focus: ['n:0']}).nodes.every(n => n.sectionOnly));
assert.ok(m.evidence(m.groupMeta('m:0'), m.groupMeta('m:1')).every(r => !r.src && !r.dst));
const unknownSize = JSON.parse(JSON.stringify(data));
unknownSize.symbolDetails.symbols[1].size = 0;
unknownSize.nodes[4].live = false;
for (const input of [unknownSize, toColumnar(unknownSize)]) {
  const model = new RelationshipModel(analyze(input));
  assert.equal(model.find('helper', 'symbol')[0].key, 's:1');
  assert.ok(model.query({level: 'symbol', focus: ['s:1']}).nodes.some(n => n.name === 'entry'));
  assert.deepEqual(model.find('excluded', 'symbol'), []);
  assert.equal(model.query({level: 'symbol', focus: ['s:3']}).nodes.length, 0);
}
console.log('Relationship exploration: direction, hops, budgets, full-image shares, paths, source attribution and export equivalence passed.');

#!/usr/bin/env node
// Read pairs of actual CrossReference exports (object, columnar), one pair
// each for symbol_details=none, elf, dwarf. See ../test/dashboard_test.py.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const zlib = require('node:zlib');
const {analyze} = require('../src/core.js');
const {RelationshipModel} = require('../src/relationships.js');

const files = process.argv.slice(2, 8);
const expected = JSON.parse(fs.readFileSync(process.argv[8], 'utf8'));
assert.equal(files.length, 6, 'Expected object/columnar export pairs for none, elf and dwarf.');
const read = file => {
  let bytes = fs.readFileSync(file);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = zlib.gunzipSync(bytes);
  return JSON.parse(bytes.toString('utf8'));
};
const summary = a => ({
  nodes: a.nodes.map(n => [n.name, n.path, n.kind, n.size, n.live, n.root, n.out, n.addr, n.align, n.cls]),
  total: a.total, refs: a.refCount, retained: Array.from(a.ret),
  details: a.details ? {symbols: Array.from({length: a.details.symbols.count}, (_, i) => a.details.symbol(i)), refs: a.details.refs,
    sourceFiles: a.details.sourceFiles, fragments: a.details.fragments} : null,
});
let baseline = null;
for (const [pair, details] of ['none', 'elf', 'dwarf'].entries()) {
  const inputs = files.slice(pair * 2, pair * 2 + 2).map(read);
  for (const pathMode of ['object', 'source']) {
    const analyses = inputs.map(input => analyze(input, {pathMode}));
    assert.deepEqual(summary(analyses[0]), summary(analyses[1]), `${details}/${pathMode}: export formats differ`);
    const a = analyses[0];
    for (const input of inputs) {
      assert.equal(input.title, 'Dashboard fixture');
      assert.deepEqual(input.regions, {CODE: {start: 65536, size: 32768}, RAM: {start: 2097152, size: 16384}});
      assert.deepEqual(input.compression, {patterns: '.text', codeRatio: 0.25, dataRatio: 0.5, decompressBufferBytes: 4096});
    }
    assert.equal(inputs[1].version, 1);
    assert.ok(inputs[1].strings.scopes.length > 0);
    for (const key of ['addr', 'align', 'scope']) assert.equal(inputs[1].sections[key].length, inputs[1].sections.count);
    const named = name => a.nodes.find(n => n.name === name);
    for (const [name, kind] of [['main', 'code'], ['target_function', 'code'], ['target_data', 'data'], ['zero_data', 'bss']]) {
      assert.equal(named(name)?.kind, kind, `Missing or misclassified ${name}`);
      assert.equal(named(name)?.live, true, `${name} must survive linking`);
    }
    for (const [name, placement] of Object.entries(expected)) {
      assert.equal(named(name)?.addr, placement.addr, `${name} VMA differs from ELF`);
      assert.equal(named(name)?.align, placement.align, `${name} alignment differs from input ELF`);
    }
    assert.equal(named('main').root, true);
    assert.equal(named('vector_table').root, true);
    assert.equal(named('forced_root').root, true);
    assert.equal(named('unused_function').root, false, 'Explicit roots must not resurrect GC sections');
    assert.equal(named('unused_function').addr, -1);
    assert.equal(named('target_data').align, 64);
    assert.equal(named('demo::operator_helpers::read()')?.cls, 'demo::operator_helpers');
    assert.equal(named('demo::(anonymous namespace)::local_helper()')?.cls, 'demo::(anonymous namespace)');
    assert.equal(named('demo::Box<demo::Tag>::read()')?.cls, 'demo::Box<demo::Tag>');
    assert.equal(named('demo::Receiver::take(demo::Tag)')?.cls, 'demo::Receiver');
    assert.equal(named('demo::Receiver::operator<<(demo::Tag)')?.cls, 'demo::Receiver');
    assert.equal(named('demo::Receiver::operator demo::Box<demo::Tag>()')?.cls, 'demo::Receiver');
    assert.equal(named('unused_function')?.live, false, 'Discarded functions must remain inspectable');
    assert.ok(a.edgeCount > 0 && a.total.live > 0 && a.total.dead > 0);
    if (details === 'none') assert.equal(a.details, null);
    else {
      assert.ok(a.details.symbols.count > 0 && a.details.refs.src.length > 0);
      assert.ok(a.details.logicalFragments.length > 0, 'Unique initializer data must remain attachable');
      if (details === 'dwarf') {
        assert.ok(a.details.mapped > 0, 'DWARF mappings must reach the dashboard');
        if (pathMode === 'source') assert.equal(named('main').path, 'app/front/main.c');
      } else assert.equal(a.details.mapped, 0);
    }
    const model = new RelationshipModel(a), main = a.mods.findIndex(m => m.name === 'app/front');
    const result = model.query({level: 'mod', focus: ['m:' + main], strongest: 0});
    assert.ok(result.nodes.some(n => n.name === 'base/engine'), 'The cross-subsystem dependency is missing');
    const graph = {nodes: a.nodes.map(n => [n.name, n.kind, n.size, n.live]), total: a.total, refs: a.refCount};
    if (baseline) assert.deepEqual(graph, baseline, 'Symbol details changed physical byte/reference accounting');
    else baseline = graph;
  }
}
console.log('CrossReference exports pass dashboard ingestion, format equivalence, ELF placement/alignment, regions, roots, C++ scopes, metadata, DWARF, GC, initializer and relationship checks.');

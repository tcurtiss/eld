#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {analyze,toColumnar}=require('../src/core.js');
const data={nodes:[
  {id:10,name:'entry',path:'build/product/a.o',kind:'code',size:32,root:true},
  {id:20,name:'value',path:'build/product/b.o',kind:'data',size:4,out:'.remove'},
  {id:30,name:'mixed',path:'build/product/c.o',kind:'code',size:16},
  {id:40,name:'.rodata.str1.1',path:'build/product/b.o',kind:'rodata',size:12},
],edges:[{src:10,dst:20,count:2}],symbolDetails:{version:1,sourceFiles:['src/app/a.cpp','src/base/b.c'],symbols:[
  {id:0,section:10,chunk:0,name:'entry',linkageName:'entry',offset:0,size:32,flags:4,sourceFile:0,sourceLine:3},
  {id:1,section:10,chunk:0,name:'entry_alias',linkageName:'entry_alias',offset:0,size:32,flags:6},
  {id:2,section:20,chunk:1,name:'value',linkageName:'value',offset:0,size:4,flags:9,sourceFile:1,sourceLine:7},
  {id:3,section:30,chunk:2,name:'left',linkageName:'left',offset:0,size:8,flags:4,sourceFile:0,sourceLine:9},
  {id:4,section:30,chunk:2,name:'right',linkageName:'right',offset:8,size:8,flags:4,sourceFile:1,sourceLine:12},
],refs:[{sourceSection:10,targetSection:20,src:0,dst:2,count:2,flags:0},{sourceSection:10,targetSection:10,src:-1,dst:1,count:1,flags:10},{sourceSection:10,targetSection:30,src:0,dst:-1,count:3,flags:0}],initializerFragments:{version:1,refs:[{container:2,targetSection:40,class:1,count:1,ownerCount:1}]}}};
const col=toColumnar(data);
for(const input of [data,col]){
  const a=analyze(input),b=analyze(input,{pathMode:'source'});
  assert.equal(a.total.live,64);assert.equal(b.total.live,64);
  assert.equal(a.refCount,b.refCount);assert.equal(a.edgeCount,1);
  assert.equal(b.nodes[0].path,'src/app/a.cpp');assert.equal(b.nodes[0].objectPath,'build/product/a.o');
  assert.equal(b.nodes[2].path,'build/product/c.o');assert.equal(b.details.mixed,1);
  assert.equal(b.details.members(0).length,2);assert.equal(b.details.references(0).length,3);
  assert.deepEqual(b.details.codeTargets,{count:4,exact:0,approximate:1,sectionOnly:3,callerKnown:3});
  assert.equal(b.details.fragmentsForSection(1).length,1);assert.equal(b.details.fragmentsForSection(1)[0].class,1);
  assert.equal(b.details.logicalFragments.length,1);assert.equal(b.details.logicalFragments[0].containerSection,1);
  assert.ok(b.details.references(0).some(r=>r.src===null));
  const filtered=analyze(input,{excludeOutput:o=>o==='.remove',pathMode:'source'});
  assert.equal(filtered.total.live,60);assert.equal(filtered.details.references(0).length,2);
  assert.equal(filtered.details.section[2],-1);
  assert.equal(filtered.details.logicalFragments.length,0);
}
for(const mutate of [
  d=>{d.symbolDetails.version=2;},d=>{d.symbolDetails.symbols[0].section=999;},
  d=>{d.symbolDetails.symbols[0].sourceFile=99;},d=>{d.symbolDetails.symbols[0].sourceLine=-1;},
  d=>{d.symbolDetails.refs[0].src=99;},d=>{d.symbolDetails.refs[0].targetSection=10;},
  d=>{d.symbolDetails.refs[0].count=0;},d=>{d.symbolDetails.symbols[0].offset=-1;},
  d=>{d.symbolDetails.initializerFragments.refs[0].class=0;},
  d=>{d.symbolDetails.initializerFragments.refs[0].class=7;},
  d=>{d.symbolDetails.initializerFragments.refs[0].container=99;},
]){const copy=JSON.parse(JSON.stringify(data));mutate(copy);assert.throws(()=>analyze(copy),/symbolDetails/);}
const truncated=JSON.parse(JSON.stringify(col));truncated.symbolDetails.symbols.size.pop();assert.throws(()=>analyze(truncated),/symbolDetails/);
const plain=JSON.parse(JSON.stringify(data));delete plain.symbolDetails;
assert.equal(analyze(plain,{pathMode:'source'}).details,null);
assert.equal(analyze(plain).total.live,64);
// A producer can omit initializerFragments.  The dashboard must still derive
// a conservative ownership candidate from a data-symbol-to-anonymous-data
// reference, which is the path used by symbol_details=elf exports.
const fallback=JSON.parse(JSON.stringify(data));
delete fallback.symbolDetails.initializerFragments;
fallback.symbolDetails.refs.push({sourceSection:20,targetSection:40,src:2,dst:-1,count:1,flags:0});
const fallbackDetails=analyze(fallback).details;
assert.equal(fallbackDetails.fragmentsForSection(1).length,1);
assert.equal(fallbackDetails.logicalFragments.length,1);
// Producer ownership evidence stays authoritative even if only one owner is
// represented in the current export. Shared data must not become attached.
const shared=JSON.parse(JSON.stringify(data));
shared.symbolDetails.initializerFragments.refs[0].ownerCount=2;
for(const input of [shared,toColumnar(shared)]){
  const details=analyze(input).details;
  assert.equal(details.fragmentsForSection(1)[0].ownerCount,2);
  assert.equal(details.logicalFragments.length,0);
}
// Coverage reports only references whose endpoints survive output filtering.
const filteredSource=JSON.parse(JSON.stringify(data));
filteredSource.symbolDetails.refs.push({sourceSection:20,targetSection:30,src:2,dst:3,count:7,flags:0});
for(const input of [filteredSource,toColumnar(filteredSource)])
  assert.deepEqual(analyze(input,{excludeOutput:o=>o==='.remove'}).details.codeTargets,
    {count:4,exact:0,approximate:1,sectionOnly:3,callerKnown:3});
console.log('Symbol details: formats, aliases, source grouping, filtering and invalid input checks passed.');

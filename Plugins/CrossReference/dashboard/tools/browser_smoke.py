#!/usr/bin/env python3
"""Headless smoke test of the built dashboard: loads it, exercises every view, loads exports.

Requires Python Playwright:   pip install playwright && playwright install chromium

    python3 tools/browser_smoke.py                       # D3 from cdnjs (needs network)
    python3 tools/browser_smoke.py --d3 path/d3.min.js   # offline: inline a local D3 copy
    python3 tools/browser_smoke.py --screenshots out/    # also save full-page screenshots

It builds a temporary copy of the page, generates small sample exports in both formats
(one gzipped), loads each, clicks through the main controls and fails on any page error.
"""
import argparse
import asyncio
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
READY = "document.getElementById('busy').hidden && document.querySelector('#treemap svg')"

# Exercise symbol attribution and both unique and shared anonymous data in the UI.
DETAIL_SAMPLE = {
    "nodes": [
        {"id": 10, "name": "entry", "path": "app/front/main.o", "kind": "code", "size": 32000, "root": True},
        {"id": 20, "name": "config", "path": "app/front/config.o", "kind": "data", "size": 16000, "out": ".data"},
        {"id": 30, "name": "helper", "path": "base/engine/helper.o", "kind": "code", "size": 24000},
        {"id": 40, "name": ".rodata.str1.1.unique", "path": "app/strings/literals.o", "kind": "rodata", "size": 12000, "out": ".rodata"},
        {"id": 50, "name": ".rodata.str1.1.shared", "path": "app/strings/literals.o", "kind": "rodata", "size": 8000},
        {"id": 60, "name": "other", "path": "base/engine/other.o", "kind": "data", "size": 4000},
    ],
    "edges": [{"src": a, "dst": b, "count": c} for a, b, c in
              [(10, 30, 2), (30, 10, 1), (20, 30, 3), (20, 40, 1), (20, 50, 2), (60, 50, 1)]],
    "symbolDetails": {
        "version": 1,
        "sourceFiles": ["src/app.cpp", "src/config.cpp"],
        "symbols": [{"id": i, "section": s, "chunk": i, "name": name, "linkageName": name,
                     "offset": 0, "size": size, "flags": flags} for i, s, name, size, flags in
                    [(0, 10, "entry", 32000, 4), (1, 30, "helper", 24000, 4),
                     (2, 20, "config", 16000, 8), (3, 60, "other", 4000, 8)]],
        "refs": [{"sourceSection": a, "targetSection": b, "src": src, "dst": dst,
                  "count": count, "flags": flags} for a, b, src, dst, count, flags in
                 [(10, 30, 0, 1, 2, 0), (30, 10, 1, 0, 1, 8), (20, 30, 2, -1, 2, 0), (20, 30, 2, 1, 1, 0),
                  (20, 40, 2, -1, 1, 0), (20, 50, 2, -1, 2, 0), (60, 50, 3, -1, 1, 0)]],
        "initializerFragments": {"version": 1, "refs": [
            {"container": 2, "targetSection": 40, "class": 1, "count": 1, "ownerCount": 1},
            {"container": 2, "targetSection": 50, "class": 1, "count": 2, "ownerCount": 2},
            {"container": 3, "targetSection": 50, "class": 1, "count": 1, "ownerCount": 2},
        ]},
    },
}
DETAIL_SAMPLE['symbolDetails']['symbols'][0].update(linkageName='_Z5entryv', sourceFile=0, sourceLine=7)
DETAIL_SAMPLE['symbolDetails']['symbols'][2].update(sourceFile=1, sourceLine=11)


def run(cmd):
    subprocess.run(cmd, cwd=ROOT, check=True)


async def main(args):
    from playwright.async_api import async_playwright

    tmp = tempfile.mkdtemp(prefix="fia-")
    page_path = os.path.join(tmp, "dashboard.html")
    build = ["node", "tools/build.js", "--out", page_path]
    if args.d3:
        build += ["--d3", os.path.abspath(args.d3)]
    run(build)
    col = os.path.join(tmp, "sample.columnar.json.gz")
    obj = os.path.join(tmp, "sample.objects.json")
    run(["node", "tools/gen-sample.js", "--sections", "30000", "--out", col])
    # The columnar sample carries DWARF details; the object-format one is a plain export without them.
    run(["node", "tools/gen-sample.js", "--sections", "30000", "--format", "objects", "--no-gzip", "--no-details", "--out", obj])
    details_obj = os.path.join(tmp, "details.objects.json")
    details_col = os.path.join(tmp, "details.columnar.json")
    with open(details_obj, "w") as f:
        json.dump(DETAIL_SAMPLE, f)
    run(["node", "-e", "const fs=require('fs'),{toColumnar}=require('./src/core.js');"
         "fs.writeFileSync(process.argv[2],JSON.stringify(toColumnar(JSON.parse(fs.readFileSync(process.argv[1])))));",
         details_obj, details_col])

    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for width, scheme in [(1440, "light"), (1440, "dark"), (390, "light"), (390, "dark")]:
            label = f"{width}px {scheme}"
            print(f"Checking {label}", flush=True)
            height = 900
            pg = await browser.new_page(viewport={"width": width, "height": height}, color_scheme=scheme, reduced_motion="reduce")

            async def checked(name):
                return await pg.evaluate('name=>document.querySelector(`#tmTree input[name="${name}"]:checked`)?.value', name)

            async def tree(name, value):
                # Tree structure settings live in the treemap's Tree menu.
                if not await pg.locator('#tmTree').evaluate('el=>el.open'):
                    await pg.locator('#tmTree > summary').click()
                await pg.locator(f'#tmTree input[name="{name}"][value="{value}"]').check()
                await pg.wait_for_timeout(150)
                await pg.wait_for_function("document.getElementById('busy').hidden", timeout=120000)
                if await pg.locator('#tmTree').evaluate('el=>el.open'):
                    await pg.locator('#tmTree > summary').click()
            pg.on("pageerror", lambda e, label=label: errors.append(f"{label}: {e}"))
            previous_url = 'data:text/html,<title>Previous page</title>'
            await pg.goto(previous_url)
            await pg.goto("file://" + page_path)
            await pg.wait_for_function(READY, timeout=120000)
            if await pg.locator('[data-workspace="overview"]').count() or not await pg.locator('#v-treemap').is_visible():
                errors.append(f'{label}: startup did not open Footprint directly without Overview')
            if await checked('pathMode') != 'source':
                errors.append(f'{label}: the sample with DWARF details did not open with source paths')
            if await checked('fragmentView') != 'logical':
                errors.append(f'{label}: unique initializer attachment was not enabled by default')

            async def click(sel):
                await pg.click(sel)
                await pg.wait_for_timeout(150)
                await pg.wait_for_function("document.getElementById('busy').hidden", timeout=120000)

            async def display(action, sel, value=None):
                # Display settings live in a popover inside the graph's header.
                if not await pg.locator('#exSettings').evaluate('el=>el.open'):
                    await pg.locator('#exSettings > summary').click()
                if action == 'select':
                    await pg.select_option(sel, value)
                else:
                    await click(sel)
                if await pg.locator('#exSettings').evaluate('el=>el.open'):
                    await pg.locator('#exSettings > summary').click()

            async def snapshot(name):
                if await pg.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1"):
                    errors.append(f"{label}: {name} scrolls sideways")
                if args.screenshots:
                    os.makedirs(args.screenshots, exist_ok=True)
                    await pg.mouse.move(0, 0)
                    await pg.evaluate("window.scrollTo(0, 0)")
                    await pg.screenshot(path=os.path.join(args.screenshots, f"{width}-{scheme}-{name}.png"), full_page=True)

            await click('[data-workspace="footprint"]')
            for sel in ['[data-set="measure:live"]', '[data-set="measure:dead"]', '[data-set="measure:pre"]', '[data-set="measure:stored"]',
                        '[data-view-workspace="footprint"][data-view="treemap"]']:
                await click(sel)
            # Size and color sit with the legend in the treemap's footer; Size mirrors the page-wide measure.
            for color in ['kind', 'comp', 'dead', 'dom']:
                await pg.select_option('#tmColor', color)
                await pg.wait_for_timeout(100)
            await pg.select_option('#tmMeasure', 'live')
            await pg.wait_for_timeout(150)
            if await pg.locator('[data-set="measure:live"]').get_attribute('aria-pressed') != 'true':
                errors.append(f'{label}: treemap size did not update the page measure')
            await click('[data-set="measure:stored"]')
            if await pg.input_value('#tmMeasure') != 'stored':
                errors.append(f'{label}: page measure did not update the treemap size control')
            if await pg.locator('#tmTree .tm-tree-dot').is_visible():
                errors.append(f'{label}: default tree structure was marked as changed')
            # The kind-first view owns section ids directly at the file level.
            # Drill into one of its visible tiles to ensure the hierarchy keeps
            # those ids and that a tile click changes the breadcrumb path.
            await tree('treeMode', 'kind')
            if not await pg.locator('#tmTree .tm-tree-dot').is_visible():
                errors.append(f'{label}: changed tree structure was not marked')
            await pg.locator('#tmTree > summary').click()
            menu = await pg.locator('#tmTree .ex-pop-body').bounding_box()
            if menu['x'] < 0 or menu['x'] + menu['width'] > width:
                errors.append(f'{label}: Tree menu extends off screen: {menu}')
            await pg.locator('#tmTake').click()
            if await pg.locator('#tmTree').evaluate('el=>el.open'):
                errors.append(f'{label}: Tree menu stayed open after an outside click')
            leaves = pg.locator('#treemap .tm-leaf')
            if not await leaves.count():
                errors.append(f"{width}px: kind-first treemap has no clickable tiles")
            else:
                await leaves.first.click()
                await pg.wait_for_timeout(150)
                if not await pg.locator('#crumbs button').count():
                    errors.append(f"{width}px: kind-first treemap tile did not drill in")
            await tree('treeMode', 'source')
            await snapshot("treemap")
            await click('.tm-head >> nth=0')
            # Address map: the sample is laid out from 0x80000000 in eight output sections.
            await click('[data-view-workspace="footprint"][data-view="addrmap"]')
            amap = await pg.evaluate('''()=>{const c=document.querySelector('#addrMap canvas'),r=c?.getBoundingClientRect();
              return {canvas:!!c&&r.height>200&&r.right<=window.innerWidth,take:document.querySelector('#addrTake').textContent,
                rows:document.querySelectorAll('#addrTable tbody tr').length,scroll:document.documentElement.scrollWidth<=window.innerWidth+1}}''')
            if not amap['canvas'] or '0x80000000' not in amap['take'] or amap['rows'] != 8 or not amap['scroll']:
                errors.append(f'{label}: address map did not render the sample layout: {amap}')
            canvas = pg.locator('#addrMap canvas')
            box = await canvas.bounding_box()
            await canvas.hover(position={'x': 92, 'y': 2})
            tip = await pg.inner_text('#tip')
            if '0x80' not in tip or 'Output section' not in tip:
                errors.append(f'{label}: address map hover did not describe the first addresses')
            await canvas.hover(position={'x': box['width'] - 4, 'y': box['height'] - 4})
            if 'Unused' not in await pg.inner_text('#tip'):
                errors.append(f'{label}: address map hover did not report unused space at the end of the region')
            await pg.mouse.move(0, 0)
            await click('[data-set="addrColor:out"]')
            if '.rodata.z' not in await pg.inner_text('#addrLegend'):
                errors.append(f'{label}: output-section coloring did not list output sections')
            await click('[data-set="addrColor:comp"]')
            await click('[data-set="addrColor:dom"]')
            await snapshot('address-map')
            await click('[data-view-workspace="footprint"][data-view="treemap"]')
            await click('[data-view-workspace="footprint"][data-view="dead"]')
            await click('[data-set="deadSort:share"]')
            await click('[data-view-workspace="footprint"][data-view="comp"]')
            await click('[data-set="compSort:saved"]')
            await pg.locator("#candRare input").first.check()
            await pg.wait_for_timeout(200)
            await pg.click("#rulesBox summary")
            rules = await pg.input_value("#rules")
            if ".text.z" not in rules and ".rodata.z" not in rules:
                errors.append(f"{width}px: linker-script rules were not generated")
            await pg.select_option("#modSelect", "services/telemetry")
            await click('[data-workspace="connectivity"]')
            await click('[data-view-workspace="connectivity"][data-view="roles"]')
            for sel in ['[data-set="roleLevel:dom"]', '[data-set="roleLevel:mod"]']:
                await click(sel)
            await click('[data-view-workspace="connectivity"][data-view="dsm"]')
            for sel in ['[data-set="dsmLevel:dom"]', '[data-set="dsmOrder:cluster"]', '#v-dsm [data-set="hideInfra:hide"]',
                        '#v-dsm [data-set="hideInfra:show"]', '[data-set="dsmLevel:mod"]',
                        '[data-set="dsmMetric:share"]', '[data-set="dsmMetric:mutual"]', '[data-set="dsmMetric:count"]']:
                await click(sel)
            row = pg.locator("#collocBody .colloc-row").first
            await row.focus()
            await row.press("Enter")
            if not await pg.locator("#dsmPair").is_visible():
                errors.append(f"{label}: collocation keyboard selection did not open the pair inspector")
            await snapshot("dependencies")
            await click('[data-clear-pair]')
            if await pg.locator("#dsmPair").is_visible():
                errors.append(f"{label}: clearing the selected pair failed")
            # Hit a real matrix cell rather than only selecting the linked table.
            await click('[data-set="dsmLevel:dom"]')
            # In the 20-directory sample, this point is inside the first row
            # and off the diagonal at both viewport sizes.
            await pg.locator("#dsm canvas").click(position={"x": 169, "y": 129})
            if not await pg.locator("#dsmPair").is_visible():
                errors.append(f"{label}: matrix cell selection did not open the pair inspector")
            await click('[data-explore-pair]')
            if not await pg.locator('#v-explorer').is_visible():
                errors.append(f'{label}: matrix relationship did not open the explorer')
            tools = pg.locator('#exTools')
            if await tools.evaluate('el=>el.open') != (width > 760):
                errors.append(f'{label}: explorer controls did not use the desktop/mobile default')
            chart_box, tools_box = await pg.locator('#exChart').bounding_box(), await tools.bounding_box()
            if width > 760 and tools_box['x'] < chart_box['x'] + chart_box['width']:
                errors.append(f'{label}: explorer controls are not beside the graph')
            if width <= 760 and tools_box['y'] + tools_box['height'] > chart_box['y']:
                errors.append(f'{label}: mobile explorer controls are not adjacent above the graph')
            if await pg.locator('.inspector').is_visible():
                errors.append(f'{label}: the inspector still takes width from the relationship explorer')
            if width > 760 and chart_box['width'] < width * .6:
                errors.append(f'{label}: explorer graph is narrower than expected: {chart_box}')
            if chart_box['height'] < min(440, height - 170):
                errors.append(f'{label}: explorer graph does not follow the window height: {chart_box}')
            # Expanded mode fills the window; Escape away from a node returns.
            await click('#exMax')
            expanded = await pg.evaluate('''()=>{const r=document.querySelector('#exChart').getBoundingClientRect();
              return {max:document.querySelector('.explorer-workbench').classList.contains('is-max'),w:r.width,h:r.height,
                bottom:r.bottom,locked:document.documentElement.style.overflow==='hidden'}}''')
            if not expanded['max'] or not expanded['locked'] or expanded['bottom'] > height + 1 or expanded['h'] < height * .55 or (width > 760 and expanded['w'] < width * .7):
                errors.append(f'{label}: expanded graph did not fill the window: {expanded}')
            await pg.keyboard.press('Escape')
            await pg.wait_for_timeout(200)
            if await pg.evaluate("document.querySelector('.explorer-workbench').classList.contains('is-max')||document.documentElement.style.overflow==='hidden'"):
                errors.append(f'{label}: Escape did not leave the expanded graph')
            # Display settings and the legend open as popovers and close on an outside click.
            await pg.locator('#exSettings > summary').click()
            await pg.locator('#exTake').click()
            if await pg.locator('#exSettings').evaluate('el=>el.open'):
                errors.append(f'{label}: display settings stayed open after an outside click')
            await pg.fill('#exSearch', 'base')
            await pg.wait_for_selector('#exResults button', timeout=3000)
            await pg.keyboard.press('Escape')
            if await pg.locator('#exResults button').count():
                errors.append(f'{label}: Escape did not close search suggestions')
            await pg.fill('#exSearch', '')
            if not await tools.evaluate('el=>el.open'):
                await click('#exTools > summary')
            await display('select', '#exMetric', 'count')
            graph_keys = await pg.locator('#exChart .rel-node').evaluate_all('els=>els.map(el=>el.__data__.key).sort()')
            graph_edges = await pg.locator('#exChart .rel-edge').evaluate_all('els=>els.map(el=>[el.__data__.source,el.__data__.target,el.__data__.count]).sort()')
            await click('[data-ex-view="matrix"]')
            matrix_keys = await pg.locator('#exChart .rel-label').evaluate_all('els=>[...new Set(els.map(el=>el.__data__.key))].sort()')
            matrix_edges = await pg.locator('#exChart .rel-cell').evaluate_all('els=>els.map(el=>[el.__data__.source,el.__data__.target,el.__data__.count]).sort()')
            if graph_keys != matrix_keys or graph_edges != matrix_edges:
                errors.append(f'{label}: explorer graph and matrix show different neighborhoods')
            await snapshot('explorer-matrix')
            await click('[data-ex-view="graph"]')
            await click('#exOverview')
            async def radial_ranking():
                return await pg.locator('#exChart .rel-node').evaluate_all('''els=>els.map(el=>{
                  const n=el.__data__;
                  return [n.key,n.dependents,n.rankIncoming,n.targetRadius];
                }).sort((a,b)=>a[0].localeCompare(b[0]))''')

            async def check_radial_center():
                info = await pg.locator('#exChart svg').evaluate('''svg=>{
                  const center=[svg.viewBox.baseVal.width/2,svg.viewBox.baseVal.height/2];
                  const nodes=Array.from(svg.querySelectorAll('.rel-node'),el=>el.__data__);
                  const hub=nodes.find(n=>n.dependenceRank===0);
                  const sorted=nodes.slice().sort((a,b)=>b.dependents-a.dependents||b.rankIncoming-a.rankIncoming||a.name.localeCompare(b.name)||a.key.localeCompare(b.key));
                  const distance=n=>Math.hypot(n.x-center[0],n.y-center[1]);
                  return {ranked:hub.key===sorted[0].key,nearCenter:distance(hub)<45,
                    nearest:nodes.every(n=>n===hub||distance(n)>distance(hub)),
                    fixed:nodes.some(n=>n.fx!=null),bands:nodes.every(n=>Number.isFinite(n.targetRadius))};
                }''')
                if info != {"ranked": True, "nearCenter": True, "nearest": True, "fixed": False, "bands": True}:
                    errors.append(f'{label}: radial layout failed to center the most widely used item: {info}')

            async def check_connection_layout():
                info = await pg.locator('#exChart svg').evaluate('''svg=>{
                  const center=[svg.viewBox.baseVal.width/2,svg.viewBox.baseVal.height/2];
                  const nodes=Array.from(svg.querySelectorAll('.rel-node'),el=>el.__data__), hub=nodes.find(n=>n.dependenceRank===0);
                  return {nearCenter:Math.hypot(hub.x-center[0],hub.y-center[1])<60,
                    allLinks:Number(svg.dataset.layoutLinks)>svg.querySelectorAll('.rel-edge').length,
                    finite:nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y))};
                }''')
                if info != {"nearCenter": True, "allLinks": True, "finite": True}:
                    errors.append(f'{label}: connection layout failed to use all displayed relationships or keep the leading item centered: {info}')

            await display('select', '#exArrange', 'rings')
            await display('click', '#exRearrange')
            await check_radial_center()
            initial_ranking = await radial_ranking()
            await pg.locator('#exLimits > summary').click()
            await pg.select_option('#exStrongest', '0')
            if initial_ranking != await radial_ranking():
                errors.append(f'{label}: arrow pruning changed dependence ranking or radial targets')
            await pg.select_option('#exStrongest', '1')
            await pg.locator('#exLimits > summary').click()
            await display('select', '#exArrange', 'links')
            await check_connection_layout()
            await pg.select_option('#exLevel', 'mod')

            async def label_state():
                return await pg.locator('#exChart svg').evaluate('''svg=>{
                  const k=+(svg.querySelector(':scope > g').getAttribute('transform')||'scale(1)').match(/scale\\(([^)]+)\\)/)?.[1]||1;
                  const shown=Array.from(svg.querySelectorAll('.rel-name')).filter(t=>t.getAttribute('display')!=='none');
                  const boxes=shown.map(t=>t.getBoundingClientRect());
                  const overlap=boxes.some((a,i)=>boxes.some((b,j)=>j>i&&a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1));
                  const size=shown.map(t=>parseFloat(t.style.fontSize)*k);
                  return {shown:shown.length,total:svg.querySelectorAll('.rel-name').length,overlap,
                    constant:size.every(v=>Math.abs(v-11)<.05),k};
                }''')
            fitted_labels = await label_state()
            if fitted_labels['overlap'] or not fitted_labels['constant'] or not fitted_labels['shown']:
                errors.append(f'{label}: graph labels overlap or do not keep a constant screen size: {fitted_labels}')
            for _ in range(3):
                await click('#exZoomIn')
            zoomed_labels = await label_state()
            if zoomed_labels['overlap'] or zoomed_labels['shown'] < fitted_labels['shown']:
                errors.append(f'{label}: zooming in did not reveal labels without overlap: {fitted_labels} -> {zoomed_labels}')
            await click('#exFit')
            colors = await pg.locator('#exChart .rel-node').evaluate_all('''els=>{
              const fill=new Map();let same=true;
              for(const el of els){const n=el.__data__,c=el.querySelector('.rel-shape').getAttribute('fill');
                if(n.groupSize>1){if(fill.has(n.group)&&fill.get(n.group)!==c)same=false;fill.set(n.group,c);}}
              return {same,groups:new Set(fill.values()).size};
            }''')
            if not colors['same'] or colors['groups'] < 2 or not await pg.locator('#exGroups').is_visible():
                errors.append(f'{label}: connected groups were not colored consistently or lacked a legend: {colors}')
            await display('select', '#exColor', 'dir')
            if await pg.locator('#exGroups').is_visible():
                errors.append(f'{label}: group legend stayed visible when coloring by directory')
            await display('select', '#exColor', 'group')
            await pg.select_option('#exLevel', 'dom')
            overview_keys = await pg.locator('#exChart .rel-node').evaluate_all('els=>els.map(el=>el.__data__.key).sort()')
            node = pg.locator('#exChart .rel-node').first
            component_key = await node.get_attribute('data-key')
            await node.focus()
            await node.press('Enter')
            if await node.get_attribute('aria-pressed') != 'true':
                errors.append(f'{label}: keyboard activation did not highlight the node')
            hidden_ok = await pg.locator('#exChart svg').evaluate('''(svg,key)=>{
              const index=Array.from(svg.querySelectorAll('.rel-node'),el=>el.__data__).find(n=>n.key===key).graphIndex;
              const drawn=new Set(Array.from(svg.querySelectorAll('.rel-edge'),el=>el.__data__.source+':'+el.__data__.target));
              return Array.from(svg.querySelectorAll('.rel-edge-extra'),el=>el.__data__).every(e=>
                (e.source===index||e.target===index)&&!drawn.has(e.source+':'+e.target));
            }''', component_key)
            pinned_label = await node.evaluate("el=>el.querySelector('.rel-name').getAttribute('display')!=='none'")
            if not pinned_label:
                errors.append(f'{label}: highlighted node label was hidden')
            if not hidden_ok:
                errors.append(f'{label}: hidden relationships shown for a highlight do not belong to the highlighted item')
            await node.press('Enter')
            if await pg.locator('#exChart .rel-edge-extra').count():
                errors.append(f'{label}: hidden relationships stayed visible after clearing the highlight')
            if await node.get_attribute('aria-pressed') != 'false':
                errors.append(f'{label}: keyboard activation did not toggle the highlight off')
            await node.locator('.rel-shape').dblclick()
            if not await pg.locator('#exChart .rel-node').evaluate_all("els=>els.some(el=>el.__data__.level==='m')"):
                errors.append(f'{label}: component double-click did not expose subsystems')
            # Shape tells directories, subsystems, functions, data and bare sections apart, with a key for the types present.
            shapes = await pg.evaluate('''()=>{const nodes=[...document.querySelectorAll('#exChart .rel-node')];
              const of=type=>nodes.filter(el=>el.dataset.type===type).map(el=>el.querySelector('.rel-shape').getAttribute('d').match(/[MLHVAZ]/g).length);
              return {levels:nodes.every(el=>({d:'Directory',m:'Subsystem'})[el.__data__.level]===el.dataset.type),
                hex:of('Directory').every(n=>n===7),diamond:of('Subsystem').every(n=>n===5),
                key:[...document.querySelectorAll('#exShapes [role=listitem]')].map(el=>el.textContent).sort().join(',')}}''')
            if shapes != {'levels': True, 'hex': True, 'diamond': True, 'key': 'Directory,Subsystem'}:
                errors.append(f'{label}: directories and subsystems are not drawn as distinct shapes with a key: {shapes}')
            if await pg.locator(f'#exChart .rel-node[data-key="{component_key}"]').count():
                errors.append(f'{label}: expanded component was not replaced by its contents')
            subsystem = pg.locator('#exChart .rel-node[data-key^="m:"]').first
            subsystem_key = await subsystem.get_attribute('data-key')
            await subsystem.locator('.rel-shape').dblclick()
            if await pg.input_value('#exLevel') != 'symbol' or not await pg.locator('#exChart .rel-node').evaluate_all(
                    '(els, key)=>els.some(el=>el.__data__.anchor && el.__data__.mods.includes(Number(key.split(":")[1])))', subsystem_key):
                errors.append(f'{label}: subsystem double-click did not expose its symbols or sections')
            crumbs = await pg.locator('#exCrumbTrail').evaluate('el=>({steps:[...el.querySelectorAll("button")].map(b=>b.textContent),current:el.querySelector("[aria-current]")?.textContent})')
            if len(crumbs['steps']) != 1 or not crumbs['current']:
                errors.append(f'{label}: breadcrumb did not show the component and subsystem steps: {crumbs}')
            await click('#exCrumbTrail [data-trail]')
            if not await pg.locator(f'#exChart .rel-node[data-key="{subsystem_key}"]').count():
                errors.append(f'{label}: back navigation lost the parent subsystem')
            await click('#exBack')
            if overview_keys != await pg.locator('#exChart .rel-node').evaluate_all('els=>els.map(el=>el.__data__.key).sort()'):
                errors.append(f'{label}: back navigation did not restore the component overview')
            node = pg.locator(f'#exChart .rel-node[data-key="{component_key}"]')
            await node.focus()
            await node.press('Shift+Enter')
            if not await pg.locator('#exChart .rel-node[data-key^="m:"]').count():
                errors.append(f'{label}: keyboard expansion did not expose subsystems')
            if await pg.locator('#exLayout').count():
                errors.append(f'{label}: obsolete graph layouts are still present')
            await snapshot('explorer-graph')
            if await pg.locator('#exChart .rel-node').count() > (30 if width == 390 else 50):
                errors.append(f'{label}: explorer exceeded its node budget')
            if await pg.locator('#exChart .rel-edge').count() > 150:
                errors.append(f'{label}: explorer exceeded its edge budget')
            geometry_ok = await pg.locator('#exChart .rel-node').evaluate_all('els=>els.every(el=>Number.isFinite(el.__data__.x)&&Number.isFinite(el.__data__.y))')
            if not geometry_ok:
                errors.append(f'{label}: explorer generated invalid node positions')
            await click('#exZoomIn')
            zoomed = await pg.locator('#exChart svg > g').get_attribute('transform')
            await click('#exFit')
            fitted = await pg.locator('#exChart svg > g').get_attribute('transform')
            if zoomed == fitted or not fitted or 'NaN' in fitted:
                errors.append(f'{label}: explorer zoom or fit controls did not change the viewport')
            # Moving a node must hold its position without selecting it; the
            # graph must preserve it across matrix and detail inspections.
            node = pg.locator('#exChart .rel-node').first
            before = await node.evaluate('el=>({key:el.__data__.key,x:el.__data__.x,y:el.__data__.y})')
            node = pg.locator(f'#exChart .rel-node[data-key="{before["key"]}"]')
            shape = node.locator('.rel-shape')
            await shape.scroll_into_view_if_needed()
            box = await shape.bounding_box()
            await pg.mouse.move(box['x'] + box['width']/2, box['y'] + box['height']/2)
            await pg.mouse.down()
            await pg.mouse.move(box['x'] + box['width']/2 + 35, box['y'] + box['height']/2 + 25, steps=8)
            await pg.mouse.up()
            moved = await node.evaluate('el=>({x:el.__data__.x,y:el.__data__.y,fixed:el.__data__.fx!=null})')
            if not moved['fixed'] or (moved['x'] == before['x'] and moved['y'] == before['y']):
                errors.append(f'{label}: dragging did not move and hold the node')
            if await pg.locator('#exDetail').is_visible():
                errors.append(f'{label}: dragging unexpectedly selected a node')
            await click('[data-ex-view="matrix"]')
            await click('[data-ex-view="graph"]')
            node = pg.locator(f'#exChart .rel-node[data-key="{before["key"]}"]')
            restored = await node.evaluate('el=>({x:el.__data__.x,y:el.__data__.y,fixed:el.__data__.fx!=null})')
            if abs(restored['x']-moved['x']) > .01 or abs(restored['y']-moved['y']) > .01 or not restored['fixed']:
                errors.append(f'{label}: graph lost a held position across display changes')
            await click('#exFit')
            await node.focus()
            await node.press('Escape')
            if await node.evaluate('el=>el.__data__.fx!=null'):
                errors.append(f'{label}: Escape did not release the held node')
            await node.locator('.rel-shape').click()
            if await node.evaluate('el=>el.__data__.fx!=null'):
                errors.append(f'{label}: clicking details unexpectedly held the node position')
            await pg.mouse.move(0, 0)
            if await node.get_attribute('aria-pressed') != 'true':
                errors.append(f'{label}: click highlight did not survive pointer exit')
            await node.locator('.rel-shape').click()
            if await node.get_attribute('aria-pressed') != 'false' or await pg.locator('#exDetail').is_visible():
                errors.append(f'{label}: repeated click did not clear the node highlight and details')
            await node.focus()
            await node.press('ArrowRight')
            await node.press('Escape')
            if await node.evaluate('el=>el.__data__.fx!=null'):
                errors.append(f'{label}: keyboard release did not free the node')
            await display('click', '#exMotion')
            moving = await pg.locator('#exChart .rel-node').evaluate_all('els=>els.map(el=>[el.__data__.x,el.__data__.y])')
            await pg.wait_for_timeout(120)
            animated = await pg.locator('#exChart .rel-node').evaluate_all('els=>els.map(el=>[el.__data__.x,el.__data__.y])')
            await display('click', '#exMotion')
            stopped = await pg.locator('#exChart .rel-node').evaluate_all('els=>els.map(el=>[el.__data__.x,el.__data__.y])')
            await pg.wait_for_timeout(120)
            paused = await pg.locator('#exChart .rel-node').evaluate_all('els=>els.map(el=>[el.__data__.x,el.__data__.y])')
            if moving == animated or stopped != paused:
                errors.append(f'{label}: force simulation resume/pause controls did not work')
            await display('click', '#exRearrange')
            await check_connection_layout()
            await click('[data-ex-view="depth"]')
            depth_keys = await pg.locator('#exChart .depth-node').evaluate_all('els=>els.map(el=>el.__data__.key).sort()')
            await snapshot('explorer-depth')
            await click('[data-ex-view="graph"]')
            if depth_keys != await pg.locator('#exChart .rel-node').evaluate_all('els=>els.map(el=>el.__data__.key).sort()'):
                errors.append(f'{label}: dependency depth did not use the displayed graph items')
            await click('[data-view-workspace="connectivity"][data-view="dsm"]')
            for f in (col, obj):
                await pg.set_input_files("#fileIn", f)
                await pg.wait_for_timeout(300)
                await pg.wait_for_function(READY, timeout=120000)
                msg = await pg.inner_text("#loadMsg")
                if msg.strip():
                    errors.append(f"{width}px: loading {os.path.basename(f)} reported: {msg}")
                expected = 'source' if f == col else 'object'
                if await checked('pathMode') != expected:
                    errors.append(f'{label}: loading {os.path.basename(f)} selected {await checked("pathMode")} paths, expected {expected}')
            await click('[data-workspace="footprint"]')
            await click('[data-view-workspace="footprint"][data-view="treemap"]')
            for f in (details_obj, details_col):
                await pg.set_input_files("#fileIn", f)
                await pg.wait_for_timeout(300)
                await pg.wait_for_function(READY, timeout=120000)
                if (await pg.inner_text("#loadMsg")).strip():
                    errors.append(f"{label}: loading {os.path.basename(f)} failed")
                await click('[data-view-workspace="footprint"][data-view="addrmap"]')
                if 'no section addresses' not in await pg.inner_text('#addrMap'):
                    errors.append(f'{label}: an export without addresses did not explain the empty address map')
                await click('[data-view-workspace="footprint"][data-view="treemap"]')
                if await checked('pathMode') != 'source':
                    errors.append(f'{label}: DWARF ownership was not selected by default')
                if await checked('fragmentView') != 'logical':
                    errors.append(f'{label}: loading an export did not default to unique initializer attachment')
                coverage = await pg.text_content("#sourceCoverage")
                if "3 exact, 1 nearest-function, and 2 section-only" not in coverage:
                    errors.append(f"{label}: code target attribution counts are incorrect")
                totals_js = """() => {
                  const root=document.querySelector('#treemap .tm-leaf').__data__.ancestors().at(-1).data.ref;
                  return {bytes:Array.from(root.k),stored:root.st,refs:document.querySelector('#heroFacts').textContent};
                }"""
                default_totals = await pg.evaluate(totals_js)
                await tree('fragmentView', 'physical')
                physical = await pg.evaluate(totals_js)
                if default_totals != physical:
                    errors.append(f'{label}: default initializer attachment changed total bytes or references')
                for path_mode in ('object', 'source'):
                    await tree('pathMode', path_mode)
                    await pg.wait_for_function(READY, timeout=120000)
                    if await checked('pathMode') != path_mode:
                        errors.append(f'{label}: manual ownership-path choice was overwritten')
                    if await checked('fragmentView') != 'physical':
                        errors.append(f'{label}: ownership-path reanalysis reset initializer preference')
                await tree('fragmentView', 'logical')
                logical = await pg.evaluate(totals_js)
                if physical != logical:
                    errors.append(f"{label}: logical ownership changed byte or reference totals")
                ownership = await pg.evaluate("""() => {
                  const root=document.querySelector('#treemap .tm-leaf').__data__.ancestors().at(-1).data.ref;
                  const attached=[];
                  const walk=n=>{if(n.level==='container')attached.push(...n._nodes);for(const c of n.children||[])walk(c);};
                  walk(root);
                  return {unique:attached.includes(3),shared:attached.includes(4)};
                }""")
                if ownership != {"unique": True, "shared": False}:
                    errors.append(f"{label}: unique/shared initializer ownership is incorrect")
                for hierarchy in ("source", "kind"):
                    await tree('treeMode', hierarchy)
                    await pg.fill("#tmSearch", "config")
                    await pg.locator("#tmSearch").press("Enter")
                    if not await pg.locator("#symbolPanel").is_visible():
                        errors.append(f"{label}: {hierarchy} initializer container search failed")
                    tiles = await pg.evaluate("""() => Array.from(document.querySelectorAll('#treemap .tm-leaf'),
                      el=>({name:el.__data__.data.ref.name,bytes:el.__data__.value})).sort((a,b)=>a.name.localeCompare(b.name))""")
                    if tiles != [{"name": ".rodata.str1.1.unique", "bytes": 12000}, {"name": "config", "bytes": 16000}]:
                        errors.append(f"{label}: {hierarchy} initializer tiles lost or duplicated section bytes")
                    for name, section in (("config", ".data"), (".rodata.str1.1.unique", ".rodata")):
                        symbols = pg.locator('#treemap .tm-leaf')
                        index = await symbols.evaluate_all('(els,name)=>els.findIndex(el=>el.__data__.data.ref.name===name)', name)
                        if index < 0:
                            errors.append(f'{label}: {hierarchy} symbol tooltip target is missing')
                            continue
                        await symbols.nth(index).hover()
                        if f'Output section: {section}' not in await pg.inner_text('#tip'):
                            errors.append(f'{label}: {hierarchy} symbol hover omitted the section name')
                    await snapshot(f"initializers-{hierarchy}")
                    await pg.locator('#symbolPanel [data-section]').first.click()
                    if ".rodata.str1.1.unique" not in await pg.inner_text("#symbolDetailBody"):
                        errors.append(f"{label}: {hierarchy} initializer endpoint navigation failed")
                await tree('fragmentView', 'physical')
                await pg.fill('#tmSearch', 'entry')
                await pg.locator('#tmSearch').press('Enter')
                await click('[data-explore-section]')
                await pg.select_option('#exType', 'all')
                await click('[data-ex-view="graph"]')
                entry = pg.locator('#exChart .rel-node[data-name="entry"]')
                symbol_types = await pg.locator('#exChart .rel-node').evaluate_all('els=>[...new Set(els.map(el=>el.dataset.type))].sort()')
                if not set(symbol_types) <= {'Function', 'Data', 'Section without symbol', 'Data section without symbol'} or 'Function' not in symbol_types:
                    errors.append(f'{label}: symbol-level graph did not use function, data and section shapes: {symbol_types}')
                if await entry.get_attribute('aria-label') != 'entry, function':
                    errors.append(f'{label}: graph node accessible name omitted its type')
                await entry.locator('.rel-shape').hover()
                tooltip = await pg.inner_text('#tip')
                if not all(stat in tooltip for stat in ('Type: Function', 'Symbol range:', 'External refs in: 1', 'External refs out: 2')):
                    errors.append(f'{label}: graph node hover omitted basic properties, size or reference counts')
                if any(extra in tooltip for extra in ('_Z5entryv', 'src/app.cpp', 'main.o', 'Chunk', 'offset')):
                    errors.append(f'{label}: graph node hover included detailed attribution')
                await entry.locator('.rel-shape').click()
                await pg.mouse.move(0, 0)
                markers = await pg.locator('#exChart .rel-edge').evaluate_all('els=>els.map(el=>el.getAttribute("marker-end"))')
                if 'url(#exArrowOut)' not in markers or 'url(#exArrowIn)' not in markers:
                    errors.append(f'{label}: click highlight did not persistently distinguish dependencies and dependents')
                await entry.locator('.rel-shape').click()
                if not await pg.locator('#exChart .rel-edge').evaluate_all('els=>els.every(el=>el.getAttribute("marker-end")==="url(#exArrow)")'):
                    errors.append(f'{label}: repeated node click did not clear arrow highlights')
                symbol_keys = await pg.locator('#exChart .rel-node').evaluate_all('els=>els.map(el=>el.__data__.key).sort()')
                await entry.locator('.rel-shape').dblclick()
                if symbol_keys != await pg.locator('#exChart .rel-node').evaluate_all('els=>els.map(el=>el.__data__.key).sort()'):
                    errors.append(f'{label}: terminal symbol double-click changed graph contents')
                if await entry.get_attribute('aria-pressed') != 'true':
                    await entry.focus()
                    await entry.press('Enter')
                await pg.fill('#exPathTarget', 'helper')
                await pg.locator('#exPathTarget').press('Enter')
                if '1 directed hop' not in await pg.inner_text('#exPath'):
                    errors.append(f'{label}: directed symbol path was not found')
                edge = pg.locator('#exChart .rel-edge[aria-label^="helper uses entry"]')
                await edge.focus()
                if 'src/app.cpp' in await pg.inner_text('#tip'):
                    errors.append(f'{label}: graph edge hover included source evidence')
                await edge.press('Enter')
                detail = await pg.inner_text('#exDetail')
                if 'target approximate' not in detail or 'src/app.cpp:7' not in detail:
                    errors.append(f'{label}: pinned reference evidence omitted attribution')
                await snapshot('explorer-symbols')
                await click('[data-ex-view="depth"]')
                if '1 cycle group' not in await pg.inner_text('#exChart .depth-take'):
                    errors.append(f'{label}: symbol depth did not keep the reciprocal functions in a cycle')
                await snapshot('explorer-symbol-depth')
                await click('[data-ex-view="matrix"]')
                await snapshot('explorer-symbol-matrix')
                await pg.fill('#exSearch', 'config')
                await pg.locator('#exSearch').press('Enter')
                await click('#exResults button >> nth=0')
                await pg.select_option('#exType', 'dd')
                if not await pg.locator('#exChart .rel-label').evaluate_all("els=>els.some(el=>el.__data__.name==='.rodata.str1.1.unique')"):
                    errors.append(f'{label}: data-reference filtering lost initializer fragments')
                await pg.select_option('#exType', 'all')
                await pg.fill('#exPathTarget', 'entry')
                await pg.locator('#exPathTarget').press('Enter')
                if '2 directed hops' not in await pg.inner_text('#exPath'):
                    errors.append(f'{label}: indirect symbol path was not found')
                await click('[data-workspace="footprint"]')
            overflow = await pg.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
            if overflow:
                errors.append(f"{width}px: page scrolls sideways")
            # Exercise real history navigation: cancelling must preserve the loaded context.
            loaded_url = pg.url
            selected = await pg.input_value('#modSelect')
            async with pg.expect_event('dialog', timeout=10000) as warning:
                await pg.evaluate('history.back()')
            dialog = await warning.value
            if dialog.type != 'beforeunload':
                errors.append(f'{label}: leaving a loaded export did not show the browser warning')
            await dialog.dismiss()
            if pg.url != loaded_url or await pg.input_value('#modSelect') != selected:
                errors.append(f'{label}: cancelling browser Back lost the loaded context')
            await click('#restore')
            await pg.evaluate('history.back()')
            await pg.wait_for_url(previous_url, timeout=10000)
            await pg.close()
        await browser.close()

    if errors:
        print("FAILED")
        for e in errors:
            print("  " + e)
        sys.exit(1)
    print("Browser smoke test passed")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--d3", help="path to a local d3.min.js (v7) to inline, for offline runs")
    ap.add_argument("--screenshots", help="directory for screenshots")
    asyncio.run(main(ap.parse_args()))

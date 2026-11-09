#!/usr/bin/env python3
"""Capture the dashboard's key views as presentation-ready images.

Requires Python Playwright:   pip install playwright && playwright install chromium

    python3 tools/capture.py                              # synthetic sample, D3 from cdnjs
    python3 tools/capture.py --export my-image.columnar.json.gz
    python3 tools/capture.py --d3 path/d3.min.js --out presentation --scale 3

It builds a temporary copy of the page, loads the export (or the synthetic sample),
sets each view up the same way every time and writes to the output directory:

    images/NN-name.png    high-resolution PNG of each view (light theme)
    images/NN-name.svg    vector copy with styles inlined, for the views drawn in SVG
    takeaways.json        each view's computed takeaway sentence and its top rows

tools/make-deck.js turns that directory into a draft PowerPoint deck.
"""
import argparse
import asyncio
import datetime
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
READY = "document.getElementById('busy').hidden && document.querySelector('#treemap svg')"

# Union of the bounding boxes of every element matched by the selectors, in page coordinates.
BOX_JS = """(sels) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of sels) for (const el of document.querySelectorAll(s)) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
  }
  if (x0 === Infinity) return null;
  return {x: x0 + scrollX, y: y0 + scrollY, width: x1 - x0, height: y1 - y0};
}"""

# Serialize an <svg> with its computed styles written inline, so it renders the same outside the page.
SVG_JS = """(sel) => {
  const svg = document.querySelector(sel);
  if (!svg) return null;
  const props = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'opacity',
    'font-family', 'font-size', 'font-weight', 'font-stretch', 'font-variant-numeric', 'text-anchor',
    'dominant-baseline', 'paint-order', 'visibility', 'display'];
  const clone = svg.cloneNode(true);
  const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    dst[i].setAttribute('style', props.map(p => `${p}:${cs.getPropertyValue(p)}`).join(';'));
  });
  const r = svg.getBoundingClientRect();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', r.width);
  clone.setAttribute('height', r.height);
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
  return new XMLSerializer().serializeToString(clone);
}"""

# Name, detail and value of the first rows of a ranked list.
ROWS_JS = """([sel, n]) => [...document.querySelectorAll(sel)].slice(0, n).map(li => {
  const t = q => (li.querySelector(q)?.textContent || '').trim();
  return {name: t('.r-sym'), detail: t('.r-mod'), value: t('.r-val')};
})"""


def run(cmd):
    subprocess.run(cmd, cwd=ROOT, check=True)


async def main(args):
    from playwright.async_api import async_playwright

    out = os.path.abspath(args.out)
    img_dir = os.path.join(out, "images")
    os.makedirs(img_dir, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="fia-capture-")
    page_path = os.path.join(tmp, "dashboard.html")
    build = ["node", "tools/build.js", "--out", page_path]
    if args.d3:
        build += ["--d3", os.path.abspath(args.d3)]
    run(build)

    images = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        pg = await browser.new_page(viewport={"width": args.width, "height": 900},
                                    device_scale_factor=args.scale, color_scheme="light")
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto("file://" + page_path)
        await pg.wait_for_function(READY, timeout=180000)
        if args.export:
            await pg.set_input_files("#fileIn", os.path.abspath(args.export))
            await pg.wait_for_timeout(300)
            await pg.wait_for_function(READY, timeout=600000)
            msg = (await pg.inner_text("#loadMsg")).strip()
            if msg:
                sys.exit(f"Loading {args.export} reported: {msg}")

        async def settle():
            await pg.wait_for_timeout(250)
            await pg.wait_for_function("document.getElementById('busy').hidden", timeout=180000)

        async def click(sel):
            loc = pg.locator(sel).first
            if await loc.count():
                await loc.click()
                await settle()

        async def select(name):
            if name and await pg.locator(f'#modSelect option[value="{name}"]').count():
                await pg.select_option("#modSelect", name)
                await settle()
                return True
            return False

        async def text(sel):
            loc = pg.locator(sel).first
            return (await loc.inner_text()).strip() if await loc.count() else ""

        async def shot(name, sels, svg=None, pad=12, hide=()):
            await pg.mouse.move(0, 0)  # no hover tooltips
            # Hide controls and anything the padding would catch, without moving the layout.
            style = await pg.add_style_tag(content=", ".join((".seg", ".linkbtn") + tuple(hide)) + " { visibility: hidden !important; }")
            await pg.wait_for_timeout(150)
            box = await pg.evaluate(BOX_JS, sels)
            if not box:
                await style.evaluate("el => el.remove()")
                print(f"  skipped {name}: nothing to capture")
                return
            clip = {"x": max(0, box["x"] - pad), "y": max(0, box["y"] - pad),
                    "width": box["width"] + 2 * pad, "height": box["height"] + 2 * pad}
            png = os.path.join(img_dir, name + ".png")
            await pg.screenshot(path=png, clip=clip, full_page=True)
            entry = {"png": os.path.relpath(png, out), "width": round(clip["width"]), "height": round(clip["height"])}
            if svg:
                markup = await pg.evaluate(SVG_JS, svg)
                if markup:
                    path = os.path.join(img_dir, name + ".svg")
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(markup)
                    entry["svg"] = os.path.relpath(path, out)
            await style.evaluate("el => el.remove()")
            images[name] = entry
            print(f"  {name}")

        await click('[data-workspace="footprint"]')
        for sel in ['[data-set="measure:stored"]', '[data-view-workspace="footprint"][data-view="treemap"]']:
            await click(sel)
        await pg.select_option('#tmColor', 'dom')
        await click('[data-view-workspace="footprint"][data-view="dead"]')
        await click('[data-set="deadSort:bytes"]')
        await click('[data-view-workspace="footprint"][data-view="comp"]')
        await click('[data-set="compSort:untap"]')
        await click('[data-view-workspace="footprint"][data-view="treemap"]')
        # Start the treemap at the top level.
        await click("#crumbs button")

        print("Capturing views")
        await shot("01-memory", ["#memmap"])
        await shot("02-treemap", ["#treemap", "#tmLegend"], svg="#treemap svg")

        await click('[data-view-workspace="footprint"][data-view="dead"]')
        await click("#deadMods .drow")
        await shot("03-dead", ["#v-dead .dead-grid > div:first-child .key", "#deadMods > li:nth-child(-n+10)"], hide=["#deadMods > li:nth-child(n+11)"])
        await shot("03b-dead-islands", ["#deadIsl > li:nth-child(-n+6)"], hide=["#deadIsl > li:nth-child(n+7)", "#v-dead .subq"])

        await click('[data-view-workspace="footprint"][data-view="comp"]')
        await click("#compMods .crow")
        await shot("04-compression", ["#v-comp .dead-grid > div:first-child .key", "#compMods > li:nth-child(-n+10)"], hide=["#compMods > li:nth-child(n+11)"])
        # Tick every candidate; each tick re-renders the lists, so look them up again each time.
        unticked = pg.locator("#candRare input:not([disabled]):not(:checked), #candData input:not([disabled]):not(:checked)")
        for _ in range(40):
            if not await unticked.count():
                break
            await unticked.first.click()  # not check(): the box is replaced before Playwright can verify it
            await settle()
        await shot("04b-compression-candidates", ["#v-comp h4.cand-h:nth-of-type(1)", "#candRare", "#candData"], hide=["#v-comp .subq", "#candPoor"])
        await shot("04c-memory-projected", ["#memmap"])
        what_if = (await text("#whatIf")).replace("Clear selection", "").strip()
        ram_projected = await text("#memmap .mem-meta")
        await click("#wiClear")

        await click('[data-view-workspace="footprint"][data-view="retained"]')
        await click("#retList .rrow")
        await shot("05-retained", ["#v-retained .ret-grid > div:first-child .key", "#retList > li:nth-child(-n+8)"], hide=["#retList > li:nth-child(n+9)"])

        await click('[data-workspace="connectivity"]')
        await click('[data-view-workspace="connectivity"][data-view="roles"]')
        for sel in ['[data-set="roleLevel:mod"]', '[data-set="dsmLevel:dom"]',
                    '[data-set="dsmOrder:tree"]', '#v-dsm [data-set="hideInfra:show"]']:
            await click(sel)
        if not await select(args.highlight):
            await click("#roleMap .rb")
        await shot("06-roles", ["#roleMap"], svg="#roleMap svg")
        await click('[data-view-workspace="connectivity"][data-view="dsm"]')
        await shot("07-dsm", ["#dsm canvas"], hide=[".dsm-note"])

        rows = lambda sel, n: pg.evaluate(ROWS_JS, [sel, n])
        meta = await pg.locator("#memmap .mem-meta").all_inner_texts()
        data = {
            "generated": datetime.datetime.now().isoformat(timespec="seconds"),
            "source": os.path.basename(args.export) if args.export else "synthetic sample",
            "title": await text("#datasetName"),
            "highlight": await pg.input_value("#modSelect"),
            "takeaways": {
                "ram": meta[0].strip() if meta else "",
                "input": meta[1].strip() if len(meta) > 1 else "",
                "facts": await text("#heroFacts"),
                "treemap": await text("#tmTake"),
                "compression": await text("#compTake"),
                "whatIf": what_if,
                "ramProjected": ram_projected,
                "dead": await text("#deadTake"),
                "deadFiles": await text("#deadFilesTake"),
                "retained": await text("#retTake"),
                "roles": await text("#roleTake"),
                "blobs": await text("#blobTake"),
                "layers": await text("#layerTake"),
                "dsm": await text("#dsmTake"),
            },
            "rows": {
                "dead": await rows("#deadMods > li", 10),
                "islands": await rows("#deadIsl > li", 6),
                "compression": await rows("#compMods > li", 10),
                "candidates": await rows("#candRare > li, #candData > li", 16),
                "retained": await rows("#retList > li", 8),
            },
            "images": images,
        }
        await browser.close()

    with open(os.path.join(out, "takeaways.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    if errors:
        print("Page errors:\n  " + "\n  ".join(errors))
        sys.exit(1)
    print(f"Wrote {len(images)} views and takeaways.json to {os.path.relpath(out)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--export", help="linker export to load (.json or .json.gz); default is the synthetic sample")
    ap.add_argument("--out", default=os.path.join(ROOT, "presentation"), help="output directory (default presentation/)")
    ap.add_argument("--d3", help="path to a local d3.min.js (v7) to inline, for offline runs")
    ap.add_argument("--width", type=int, default=1440, help="page width in CSS pixels (default 1440)")
    ap.add_argument("--scale", type=float, default=2, help="pixel density of the PNGs (default 2)")
    ap.add_argument("--highlight", default="services/telemetry",
                    help="subsystem to highlight in the shared-versus-isolated map (default services/telemetry)")
    asyncio.run(main(ap.parse_args()))

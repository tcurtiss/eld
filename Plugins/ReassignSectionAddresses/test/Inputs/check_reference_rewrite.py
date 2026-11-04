#!/usr/bin/env python3
"""Check plugin relocation ownership independently of compiler optimizations."""

import argparse
import csv
import gzip
import json
from pathlib import Path
import re
import shlex
import subprocess

from check_address_patterns import inspect, run, sections, symbols


parser = argparse.ArgumentParser()
parser.add_argument("--compiler", required=True)
parser.add_argument("--compiler-flags", default="")
parser.add_argument("--link", required=True)
parser.add_argument("--readelf", required=True)
parser.add_argument("--objdump", required=True)
parser.add_argument("--work", type=Path, required=True)
args = parser.parse_args()
work = args.work.resolve()
work.mkdir(parents=True, exist_ok=True)
config = work / "plugin.yaml"
config.write_text('''GlobalPlugins:
  - Type: OutputSectionIterator
    Name: ReassignSectionAddresses
    Library: ReassignSectionAddresses
    Options: section=.dedup:hash=seq:seq_start=0xfedcba98
''')
script = work / "layout.t"
script.write_text('''SECTIONS {
  .text 0x10000 : { *(.text*) }
  .data : { *(.data*) *(.sdata*) }
  .dynamic : { *(.dynamic) }
  .got : { *(.got) }
  .got.plt : { *(.got.plt) }
  .dynsym : { *(.dynsym) }
  .dynstr : { *(.dynstr) }
  .hash : { *(.hash) }
  .rela.dyn : { *(.rela.dyn) }
  .rela.plt : { *(.rela.plt) }
  .dedup 0 (DSECT) : { *(.dedup) }
  .dedup_other 0 (DSECT) : { *(.dedup_other) }
}''')

targets = '''
.section .dedup,"a",@progbits
.local fmt
.type fmt,@object
fmt: .asciz "format"
.size fmt, .-fmt
.local second
.type second,@object
second: .asciz "second"
.size second, .-second
'''
pair = '''
.text
.globl entry
.hidden entry
.type entry,@function
entry:
.Lhigh: .word 0x00004000
.Llow: .word 0x6a49c000
.reloc .Lhigh, R_HEX_B32_PCREL_X, .dedup + 7
.reloc .Llow, R_HEX_6_PCREL_X, .dedup + 11
'''


def link_case(name, source, error=None, extra=(), options=(), input_error=True,
              emit_relocs=True, selected=".dedup"):
    asm, obj, image = (work / (name + suffix) for suffix in (".s", ".o", ".so"))
    asm.write_text(source)
    run([args.compiler, *shlex.split(args.compiler_flags), "-c", asm, "-o", obj], work)
    case_config = config
    if options or selected != ".dedup":
        case_config = work / (name + ".yaml")
        case_config.write_text(config.read_text().replace(
            "section=.dedup", "section=" + selected).replace(
            "seq_start=0xfedcba98", "seq_start=0xfedcba98:" + ":".join(options)))
    command = [*shlex.split(args.link), "--shared",
               *(["--emit-relocs"] if emit_relocs else []),
               "--thread-count", "4", "--plugin-config", case_config, "-T", script, *extra,
               obj, "-o", image]
    result = subprocess.run([str(a) for a in command], text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if error:
        assert result.returncode > 0, (name, result.returncode, result.stderr)
        assert error in result.stderr, (name, error, result.stderr)
        if input_error:
            assert obj.name in result.stderr, (name, result.stderr)
    else:
        assert result.returncode == 0, (name, result.stdout, result.stderr)
    return image


def immediate(text, register):
    match = re.search(register + r" = ##(-?(?:0x[0-9a-f]+|[0-9]+))\b", text)
    assert match, text
    return int(match[1], 0) & 0xffffffff


image = link_case("section-offset", pair + targets)
info = inspect(args, image)
syms = {s["Name"]["Name"]: s for s in symbols(info)}
text = run([args.objdump, "-d", image], work)
assert immediate(text, "r0") == 0xfedcba99, text
assert syms["second"]["Value"] == 0xfedcba99, syms

got_source = '''
.text
.globl entry
.hidden entry
.type entry,@function
entry:
{ r0 = memw(r1 + ##fmt@GOT) }
{ r2 = memw(r1 + ##pointers@GOT) }
{ r3 = memw(r1 + ##external@GOT) }
{ jumpr r31 }
.data
.globl pointers
.type pointers,@object
pointers:
.word fmt
.word fmt + 3
.word second
.word external + 7
.size pointers, .-pointers
.globl external
.type external,@object
external: .word 456
.size external, .-external
'''
image = link_case("got", got_source + targets)
info = inspect(args, image)
sects = sections(info)
syms = {s["Name"]["Name"]: s for s in symbols(info)}
text = run([args.objdump, "-d", image], work)
assert immediate(text, "r0") == 0xfedcba98, text
assert "r2 = memw(" in text and "r3 = memw(" in text, text
pointer = syms["pointers"]
section = sects[pointer["Section"]["Value"]]
pos = section["Offset"] + pointer["Value"] - section["Address"]
data = image.read_bytes()[pos:pos + 12]
assert [int.from_bytes(data[i:i + 4], "little") for i in range(0, 12, 4)] == [
    0xfedcba98, 0xfedcba9b, 0xfedcba99], data.hex()
dyn = [r["Relocation"] for group in info.get("Relocations", [])
       if sects[group["SectionIndex"]]["Name"]["Name"] == ".rela.dyn"
       for r in group["Relocs"]]
assert not any(r["Offset"] in (pointer["Value"], pointer["Value"] + 4,
                               pointer["Value"] + 8) for r in dyn), dyn
assert any(r["Offset"] == pointer["Value"] + 12 and
           r["Symbol"]["Name"] == "external" for r in dyn), dyn
assert any(r["Type"]["Name"] == "R_HEX_GLOB_DAT" and
           r["Symbol"]["Name"] == "pointers" for r in dyn), dyn
assert any(r["Type"]["Name"] == "R_HEX_GLOB_DAT" and
           r["Symbol"]["Name"] == "external" for r in dyn), dyn
assert not any(r["Symbol"]["Name"] in ("fmt", "second") for r in dyn), dyn
got = next(s for s in sects.values() if s["Name"]["Name"] == ".got")
assert got["Size"] == 8, got

errors = (
    ("missing", pair.replace(".reloc .Llow, R_HEX_6_PCREL_X, .dedup + 11", ""),
     "missing or conflicting paired relocation"),
    ("duplicate", pair + ".reloc .Llow, R_HEX_6_PCREL_X, .dedup + 11\n",
     "missing or conflicting paired relocation"),
    ("duplicate-pointer", ".data\n.Lptr: .word fmt\n.reloc .Lptr, R_HEX_32, fmt\n",
     "duplicate relocation"),
    ("overlap", pair + ".reloc .Llow + 1, R_HEX_8, .dedup + 7\n",
     "overlapping relocation"),
    ("addend", pair.replace(".dedup + 11", ".dedup + 12"),
     "inconsistent paired relocation addends"),
    ("opcode", pair.replace("0x6a49c000", "0x7800c000"),
     "unsupported immediate-pair instruction"),
    ("packet", pair.replace("0x00004000", "0x0000c000"),
     "invalid or truncated immediate-extender packet"),
    ("truncated", pair.replace("0x6a49c000", "0x6a494000"),
     "invalid or truncated immediate-extender packet"),
    ("unsupported", ".data\n.Lptr: .word 0\n.reloc .Lptr, R_HEX_16, fmt\n",
     "unsupported selected-target relocation R_HEX_16"),
    ("no-owner", pair.replace(".dedup + 7", ".dedup + 99")
     .replace(".dedup + 11", ".dedup + 103"),
     "section-relative offset has no containing string symbol"),
    ("overflow", ".data\n.word fmt + 0x12345678\n",
     "assigned address plus interior offset exceeds 32 bits"),
)
for name, source, error in errors:
    case_targets = targets
    if name == "overflow":
        case_targets = targets.replace(".local fmt", ".globl fmt\n.hidden fmt")
    link_case(name, source + case_targets, error)

link_case("ambiguous", pair + targets + '''
.local alias
.type alias,@object
.set alias, fmt + 1
.size alias, 2
''', "ambiguous overlapping string symbols")
link_case("no-symbols", pair + '.section .dedup,"a",@progbits\n.asciz "format"\n',
          "selected target has no object symbols")
link_case("interposition", got_source + targets.replace(".local fmt", ".globl fmt"),
          "selected string target is interposable")
link_case("invalid-extent", '.text\n.globl entry\nentry: { jumpr r31 }\n' +
          targets.replace(".size fmt, .-fmt", ".size fmt, 100"),
          "invalid symbol extent")


def sidecar(image, compressed=False):
    return Path(str(image) + ".reassign.debug.json" + (".gz" if compressed else ""))


def check_sidecar(image, count, compressed=False):
    path = sidecar(image, compressed)
    document = json.loads(gzip.decompress(path.read_bytes()) if compressed
                          else path.read_text())
    assert document["schema_version"] == 3, document
    assert document["plugin"] == "ReassignSectionAddresses", document
    assert document["output_file"] == str(image), document
    assert len(document["sections"]) == 1, document
    group = document["sections"][0]
    assert group["section"] == ".dedup", group
    debug_symbols = group["symbols"]
    assert {s["symbol"] for s in debug_symbols} == {"fmt", "second"}, debug_symbols
    records = [r for s in debug_symbols for r in s["relocations"]]
    assert len(records) == count, records
    obj = image.with_suffix(".o")
    original = inspect(args, obj)
    original_sections = sections(original)
    original_relocs = {
        (original_sections[original_sections[group["SectionIndex"]]["Info"]]
         ["Name"]["Name"], r["Relocation"]["Offset"]): r["Relocation"]
        for group in original.get("Relocations", []) for r in group["Relocs"]
    }
    output_sections = {s["Name"]["Name"]: s for s in sections(inspect(args, image)).values()}
    input_bytes, output_bytes = obj.read_bytes(), image.read_bytes()
    object_symbols = {s["Name"]["Name"]: s for s in symbols(original)}
    dedup = next(s for s in original_sections.values()
                 if s["Name"]["Name"] == ".dedup")
    for symbol in debug_symbols:
        original_symbol = object_symbols[symbol["symbol"]]
        pos = dedup["Offset"] + original_symbol["Value"]
        assert symbol["original_address"] == original_symbol["Value"], symbol
        assert bytes.fromhex(symbol["raw_bytes"]) == input_bytes[
            pos:pos + original_symbol["Size"]], symbol
        assert symbol["input_file"].endswith(obj.name), symbol
        assert symbol["input_section"] == ".dedup", symbol
        assert symbol["assigned_address"] == (0xfedcba98 if symbol["symbol"] == "fmt"
                                              else 0xfedcba99), symbol
        order = []
        for record in symbol["relocations"]:
            assert record["target"]["symbol"] == symbol["symbol"], record
            assert record["target"]["assigned_address"] == symbol["assigned_address"], record
            source = record["source"]
            order.append((source["file"], source["section"], source["offset"],
                          source["address"]))
        assert order == sorted(order), order
    for record in records:
        source, before, target = (record[k] for k in ("source", "original", "target"))
        assert source["file"].endswith(obj.name), source
        assert target["file"].endswith(obj.name), target
        assert target["section"] == target["output_section"] == ".dedup", target
        key = (source["section"], source["offset"])
        reloc = original_relocs[key]
        assert before["type"] == reloc["Type"]["Name"], (before, reloc)
        assert before["type_id"] == reloc["Type"]["Value"], (before, reloc)
        assert before["symbol"] == reloc["Symbol"]["Name"], (before, reloc)
        assert before["addend"] == reloc["Addend"], (before, reloc)
        section = next(s for s in original_sections.values()
                       if s["Name"]["Name"] == source["section"])
        pos = section["Offset"] + source["offset"]
        assert before["data"] == int.from_bytes(input_bytes[pos:pos + 4], "little"), record
        section = output_sections[source["output_section"]]
        pos = section["Offset"] + source["address"] - section["Address"]
        assert record["replacement_data"] == int.from_bytes(output_bytes[pos:pos + 4], "little"), record
        assert record["value"] == target["assigned_address"] + target["interior_offset"], record
    return records


# Validate the original object records and replacement image bytes, not just
# JSON existence. Neither linker tracing nor output_format= enables provenance.
disabled = link_case("debug-disabled", pair + targets, options=("debug=no",))
assert not sidecar(disabled).exists(), disabled
sidecar(disabled).write_text("existing sidecar\n")
link_case("debug-disabled", pair + targets, extra=("--trace=plugin",), options=("debug=no",))
assert sidecar(disabled).read_text() == "existing sidecar\n", disabled
sidecar(disabled).unlink()
assert not sidecar(image).exists(), image

debug_image = link_case('debug-"quoted"\\path', pair + targets, options=("debug=yes",))
records = check_sidecar(debug_image, 2)
assert {r["transformation"] for r in records} == {"pc-relative-to-absolute"}, records
assert {r["target"]["symbol"] for r in records} == {"second"}, records
assert {r["value"] for r in records} == {0xfedcba99}, records
parallel = sidecar(debug_image).read_bytes()
link_case('debug-"quoted"\\path', pair + targets, options=("debug=yes",), extra=("--no-threads",))
assert sidecar(debug_image).read_bytes() == parallel, debug_image
records = check_sidecar(link_case("debug-no-emit", pair + targets,
                                 options=("debug=yes",), emit_relocs=False), 2)
assert {r["transformation"] for r in records} == {"pc-relative-to-absolute"}, records

debug_got = link_case("debug-got", got_source + targets, options=("debug=yes",))
records = check_sidecar(debug_got, 5)
assert {r["transformation"] for r in records} == {
    "got-load-to-absolute", "absolute-pointer-initializer"}, records
assert not any(r["target"]["symbol"] in ("external", "pointers") for r in records), records
offset_pointer = next(r for r in records if r["source"]["section"] == ".data" and
                      r["source"]["offset"] == 4)
assert offset_pointer["original"]["addend"] == offset_pointer["target"]["interior_offset"] == 3
assert offset_pointer["value"] == 0xfedcba9b, offset_pointer

absolute = '.text\n.globl entry\nentry: { r0 = ##fmt }\n{ jumpr r31 }\n'
records = check_sidecar(link_case("debug-absolute", absolute + targets, options=("debug=yes",)), 2)
assert {r["transformation"] for r in records} == {"absolute-immediate-update"}, records
records = check_sidecar(link_case("debug-unaligned", '.data\n.byte 0\n.word fmt\n' + targets,
                                 options=("debug=yes",)), 1)
assert records[0]["source"]["offset"] == 1, records

debug_image = link_case("debug-with-compressed-outputs", pair + targets,
                       options=("debug=yes", "output_format=csv,json", "gzip=yes",
                                "clean_strings=yes"))
check_sidecar(debug_image, 2, compressed=True)
dump = Path(str(debug_image) + ".reassign.csv")
assert Path(str(dump) + ".gz").exists(), dump
assert not dump.exists(), dump
with gzip.open(str(dump) + ".gz", "rt", newline="") as stream:
    assert list(csv.reader(stream)) == [["section", "address", "string"],
                                       [".dedup", "0xFEDCBA98", "format"],
                                       [".dedup", "0xFEDCBA99", "second"]]
with gzip.open(str(debug_image) + ".reassign.json.gz", "rt") as stream:
    document = json.load(stream)
    assert document["sections"] == [{"section": ".dedup", "entries": [
        {"address": 0xfedcba98, "string": "format"},
        {"address": 0xfedcba99, "string": "second"}]}], document
assert not sidecar(debug_image).exists(), debug_image
assert not Path(str(debug_image) + ".reassign.json").exists(), debug_image
compressed_only = link_case("debug-compressed-only", pair + targets,
                            options=("debug=yes", "gzip=yes"))
check_sidecar(compressed_only, 2, compressed=True)
assert not sidecar(compressed_only).exists(), compressed_only

# References to different selected sections stay with their owning symbol.
split_targets = targets.replace(".local second", '.section .dedup_other,"a",@progbits\n.local second')
multi = link_case("debug-multiple-sections", '.data\n.word fmt\n.word second\n' + split_targets,
                  options=("debug=yes", "output_format=csv"), selected=".dedup,.dedup_other")
for section, name, address, raw in ((".dedup", "fmt", 0xfedcba98, b"format\0"),
                                  (".dedup_other", "second", 0xfedcba99, b"second\0")):
    document = json.loads(sidecar(multi).read_text())
    assert [g["section"] for g in document["sections"]] == [".dedup", ".dedup_other"], document
    group = next(g for g in document["sections"] if g["section"] == section)
    assert len(group["symbols"]) == 1, group
    symbol = group["symbols"][0]
    assert symbol["symbol"] == name and symbol["original_address"] == 0, symbol
    assert symbol["assigned_address"] == address, symbol
    assert bytes.fromhex(symbol["raw_bytes"]) == raw, symbol
    assert len(symbol["relocations"]) == 1, symbol
    reloc = symbol["relocations"][0]
    assert reloc["target"]["symbol"] == name, reloc
    assert reloc["target"]["output_section"] == section, reloc
    assert reloc["value"] == address, reloc

# Same-named local symbols in two inputs have distinct provenance groups,
# even when their identical contents receive the same assigned address.
local_images = [link_case("debug-local-" + str(i), '.data\n.word fmt\n' + targets,
                         options=("debug=yes",)) for i in range(2)]
local_output = work / "debug-local-combined.so"
local_config = work / "debug-local-0.yaml"
run([*shlex.split(args.link), "--shared", "--plugin-config", local_config,
     "-T", script, *(image.with_suffix(".o") for image in local_images),
     "-o", local_output], work)
document = json.loads(sidecar(local_output).read_text())
assert len(document["sections"]) == 1, document
local_symbols = document["sections"][0]["symbols"]
assert len(local_symbols) == 4, document
for symbol in local_symbols:
    if symbol["symbol"] == "fmt":
        assert len(symbol["relocations"]) == 1, symbol
        assert symbol["relocations"][0]["source"]["file"] == symbol["input_file"], symbol
        assert symbol["assigned_address"] == 0xfedcba98, symbol
    else:
        assert symbol["symbol"] == "second" and symbol["relocations"] == [], symbol

failed = link_case("debug-invalid-pair", pair.replace("0x6a49c000", "0x7800c000") + targets,
                   "unsupported immediate-pair instruction", options=("debug=yes",))
assert not sidecar(failed).exists(), failed
link_case("debug-invalid-option", pair + targets, "debug= must be 'yes' or 'no'",
          options=("debug=invalid",), input_error=False)
blocked = sidecar(work / "debug-blocked.so")
blocked.mkdir(exist_ok=True)
link_case("debug-blocked", pair + targets, "failed to write debug JSON",
          options=("debug=yes",), input_error=False)
if Path("/dev/full").exists():
    full = sidecar(work / "debug-write-failure.so")
    full.symlink_to("/dev/full")
    link_case("debug-write-failure", pair + targets, "failed to write debug JSON",
              options=("debug=yes",), input_error=False)
    full.unlink()
    full = sidecar(work / "debug-gzip-write-failure.so", compressed=True)
    full.symlink_to("/dev/full")
    try:
        link_case("debug-gzip-write-failure", pair + targets,
                  "failed to write debug JSON",
                  options=("debug=yes", "gzip=yes"), input_error=False)
    finally:
        full.unlink()
    for format_name in ("csv", "json"):
        for compressed in (False, True):
            name = format_name + "-write-failure" + ("-gzip" if compressed else "")
            full = Path(str(work / (name + ".so")) + ".reassign." + format_name +
                        (".gz" if compressed else ""))
            full.symlink_to("/dev/full")
            try:
                link_case(name, pair + targets, "failed to write mapping output",
                          options=("output_format=" + format_name,
                                   "gzip=" + ("yes" if compressed else "no")),
                          input_error=False)
            finally:
                full.unlink()
print("Relocation provenance sidecar checks passed")

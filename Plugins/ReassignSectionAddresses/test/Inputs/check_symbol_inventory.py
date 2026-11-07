#!/usr/bin/env python3
"""Check live symbol membership with a cooperating public-API plugin."""

import argparse
import json
from pathlib import Path
import shlex
import subprocess

from check_address_patterns import inspect, run, symbols


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

source = work / "symbols.s"
source.write_text('''
.text
.globl entry
.hidden entry
.type entry,@function
entry:
.Lhigh: .word 0x00004000
.Llow: .word 0x6a49c000
.reloc .Lhigh, R_HEX_B32_PCREL_X, .dedup + 7
.reloc .Llow, R_HEX_6_PCREL_X, .dedup + 11
.section .dedup,"a",@progbits
.local fmt
.type fmt,@object
fmt: .asciz "format"
.size fmt, .-fmt
.local second
.type second,@object
second: .asciz "second"
.size second, .-second
.section .dedup_other,"a",@progbits
empty_chunk:
.asciz "unused"
.globl late_object
.hidden late_object
.type late_object,@object
.size late_object, 7
''')
obj = work / "symbols.o"
run([args.compiler, *shlex.split(args.compiler_flags), "-c", source, "-o", obj], work)
script = work / "layout.t"
script.write_text('''SECTIONS {
  .text 0x10000 : { *(.text*) }
  .dynamic : { *(.dynamic) }
  .dedup 0 (DSECT) : { *(.dedup) }
  .dedup_other 0 (DSECT) : { *(.dedup_other) }
}''')

for mode in ("early", "late", "late-empty"):
    config = work / (mode + ".yaml")
    config.write_text('''GlobalPlugins:
  - Type: OutputSectionIterator
    Name: ReassignSectionAddresses
    Library: ReassignSectionAddresses
    Options: section=.dedup,.dedup_other:hash=seq:seq_start=0xfedcba98:output_format=csv,json:debug=yes
  - Type: LinkerPlugin
    Name: ReassignSymbolMutation
    Library: ReassignSymbolMutation
    Options: ''' + mode + '\n')
    image = work / (mode + ".so")
    command = [*shlex.split(args.link), "--shared", "--plugin-config", config,
               "-T", script, obj, "-o", image]
    result = subprocess.run([str(a) for a in command], text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if mode != "early":
        assert result.returncode > 0, (mode, result.stdout, result.stderr)
        assert "selected symbol was not indexed before relocation scanning" in result.stderr, result.stderr
        assert obj.name in result.stderr, result.stderr
        expected_chunk = ".dedup_other" if mode == "late-empty" else ".dedup"
        assert "section " + expected_chunk + " at offset 0" in result.stderr, result.stderr
        for suffix in (".csv", ".json", ".debug.json"):
            assert not Path(str(image) + ".reassign" + suffix).exists(), image
        continue
    assert result.returncode == 0, (result.stdout, result.stderr)
    output_symbols = {s["Name"]["Name"]: s for s in symbols(inspect(args, image))}
    for name, value in (("fmt", 0xfedcba98), ("second", 0xfedcba99),
                        ("late_object", 0xfedcba98)):
        symbol = output_symbols[name]
        assert symbol["Section"]["Name"] == "Absolute", symbol
        assert symbol["Value"] == value, symbol
    document = json.loads(Path(str(image) + ".reassign.debug.json").read_text())
    debug_symbols = document["sections"][0]["symbols"]
    assert [s["symbol"] for s in debug_symbols] == ["fmt", "second", "late_object"], debug_symbols
    assert sum(len(s["relocations"]) for s in debug_symbols) == 2, debug_symbols
    text = run([args.objdump, "-d", image], work)
    assert "add(pc," not in text, text

print("Symbol inventory mutation checks passed")

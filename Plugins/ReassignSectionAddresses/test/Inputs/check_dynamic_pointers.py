"""Validate reassigned local-string pointers across compile/link modes."""

import argparse
from pathlib import Path
import shlex

from check_address_patterns import inspect, run, sections, symbols


parser = argparse.ArgumentParser()
parser.add_argument("--compiler", required=True)
parser.add_argument("--compiler-flags", default="")
parser.add_argument("--language", choices=("c", "c++"), required=True)
parser.add_argument("--link", required=True)
parser.add_argument("--readelf", required=True)
parser.add_argument("--work", type=Path, required=True)
args = parser.parse_args()
work = args.work.resolve()
work.mkdir(parents=True, exist_ok=True)
source = work / ("pointers.c" if args.language == "c" else "pointers.cpp")
source.write_text('''
static const char fmt[] __attribute__((section(".dedup"))) = "format";
static const char other[] __attribute__((section(".dedup"))) = "second";
const char *pointers[] = {fmt, fmt + 3, other, fmt};
int entry(void) { return (unsigned)pointers[0]; }
''')
script = work / "layout.t"
script.write_text('''SECTIONS {
  .text 0x10000 : { *(.text*) }
  .data : { *(.data*) *(.sdata*) }
  .dedup 0 (DSECT) : { *(.dedup) }
}''')
config = work / "plugin.yaml"
config.write_text('''GlobalPlugins:
  - Type: OutputSectionIterator
    Name: ReassignSectionAddresses
    Library: ReassignSectionAddresses
    Options: section=.dedup:hash=sequential:start=0x12345678
''')

for mode, flags in (
    ("static", ("-fno-pic",)),
    ("shared", ("-fpic", "-fPIC")),
    ("pie", ("-fpie", "-fPIE", "-fpic", "-fPIC")),
):
    for flag in flags:
        obj = work / (flag[1:] + ".o")
        run([args.compiler, *shlex.split(args.compiler_flags), "-O2", flag,
             "-G0", "-ffunction-sections", "-fdata-sections",
             "-Wa,--reloc-section-sym=none", "-c", source, "-o", obj], work)
        original = inspect(args, obj)
        original_sections = sections(original)
        original_symbols = {s["Name"]["Name"]: s for s in symbols(original)}
        pointer = original_symbols["pointers"]
        refs = []
        for group in original["Relocations"]:
            target = original_sections[original_sections[group["SectionIndex"]]["Info"]]
            if target["Index"] != pointer["Section"]["Value"]:
                continue
            for item in group["Relocs"]:
                r = item["Relocation"]
                if pointer["Value"] <= r["Offset"] < pointer["Value"] + pointer["Size"]:
                    assert r["Type"]["Name"] == "R_HEX_32", r
                    assert original_symbols[r["Symbol"]["Name"]]["Section"]["Name"] == ".dedup", r
                    refs.append((r["Offset"] - pointer["Value"],
                                 r["Symbol"]["Name"], r["Addend"]))
        assert len(refs) == 4 and any(addend == 3 for _, _, addend in refs), refs
        image = work / (mode + "-" + flag[1:] + ".elf")
        # The C++ entry point is mangled; its name is derived from the object.
        entry = next(s["Name"]["Name"] for s in symbols(original)
                     if s["Type"]["Name"] == "Function")
        run([*shlex.split(args.link), "--" + mode, "-e", entry,
             "--emit-relocs", "--plugin-config", config,
             "-T", script, obj, "-o", image], work)
        info = inspect(args, image)
        final_symbols = {s["Name"]["Name"]: s for s in symbols(info)}
        final_sections = sections(info)
        final_pointer = final_symbols["pointers"]
        section = final_sections[final_pointer["Section"]["Value"]]
        expected = {}
        contents = image.read_bytes()
        for offset, name, addend in refs:
            sym = final_symbols[name]
            assert sym["Section"]["Name"] == "Absolute", sym
            assert sym["Value"] in (0x12345678, 0x12345679), sym
            address = final_pointer["Value"] + offset
            pos = section["Offset"] + address - section["Address"]
            value = int.from_bytes(contents[pos:pos + 4], "little")
            expected[address] = (sym["Value"] + addend) & 0xffffffff
            assert value == expected[address], (image, name, value, expected)
        dynrelocs = [r["Relocation"] for group in info.get("Relocations", [])
                     if final_sections[group["SectionIndex"]]["Name"]["Name"] == ".rela.dyn"
                     for r in group["Relocs"]]
        assert not any(r["Offset"] in expected for r in dynrelocs), (image, dynrelocs)
        dynamic = {d["Type"]: d["Value"] for d in info.get("DynamicSection", [])}
        if "RELASZ" in dynamic:
            assert dynamic["RELASZ"] == len(dynrelocs) * 12, (image, dynamic)
            count = sum(r["Type"]["Name"] == "R_HEX_RELATIVE" for r in dynrelocs)
            assert dynamic["RELACOUNT"] == count, (image, dynamic)
        for bias in (0, 0x1000, 0x40000000):
            memory = expected.copy()
            for r in dynrelocs:
                if r["Type"]["Name"] == "R_HEX_RELATIVE":
                    memory[r["Offset"]] = (bias + r["Addend"]) & 0xffffffff
            assert all(memory[a] == v for a, v in expected.items()), (image, bias, memory)

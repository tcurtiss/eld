#!/usr/bin/env python3
"""Compile/link local-string patterns and inspect their actual address operands.

Uses only Python's standard library and the tools supplied by plugin-local lit.
No target execution, SDK headers, C/C++ runtime, or LLVM source tree is needed.
Each invocation leaves its objects, plugin configs, and images under --work.
"""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import shlex
import subprocess


MASK32 = 0xffffffff
TARGET_SECTIONS = (".dedup", ".dedup_aux")
ABSOLUTE_LOW = ("R_HEX_16_X", "R_HEX_8_X", "R_HEX_6_X")


def run(command, cwd):
    result = subprocess.run([str(arg) for arg in command], cwd=cwd, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError("{}\n{}\n{}".format(
            shlex.join(str(arg) for arg in command), result.stdout, result.stderr))
    return result.stdout


def inspect(args, path):
    return json.loads(run([
        args.readelf, "--elf-output-style=JSON", "--symbols", "--relocations",
        "--sections", "--program-headers", "--file-headers", "--dynamic-table", path
    ], path.parent))[0]


def sections(info):
    return {item["Section"]["Index"]: item["Section"]
            for item in info["Sections"]}


def symbols(info):
    return [item["Symbol"] for item in info["Symbols"]]


def relocations(info, executable_only=False):
    for group in info.get("Relocations", []):
        if executable_only:
            sects = sections(info)
            target = sects[sects[group["SectionIndex"]]["Info"]]
            if not target["Flags"]["Value"] & 4:
                continue
        for item in group["Relocs"]:
            yield item["Relocation"]


def input_strings(args, objects):
    """Read original symbol bytes, independently of the plugin's debug dump."""
    strings = {}
    references = []
    for obj in objects:
        info = inspect(args, obj)
        sects = sections(info)
        data = obj.read_bytes()
        for sym in symbols(info):
            if (sym["Type"]["Name"] != "Object" or
                    sym["Section"]["Name"] not in TARGET_SECTIONS):
                continue
            name = sym["Name"]["Name"]
            assert name not in strings, ("ambiguous fixture symbol", name)
            assert sym["Binding"]["Name"] == "Local", name
            sec = sects[sym["Section"]["Value"]]
            offset = sec["Offset"] + sym["Value"]
            strings[name] = data[offset:offset + sym["Size"]]

        for group in info.get("Relocations", []):
            sec = sects[sects[group["SectionIndex"]]["Info"]]
            # DWARF may also refer to the strings; it is not executable code.
            if not sec["Flags"]["Value"] & 4:
                continue
            functions = [s for s in symbols(info)
                         if s["Type"]["Name"] == "Function" and
                         s["Section"]["Value"] == sec["Index"]]
            for item in group["Relocs"]:
                reloc = item["Relocation"]
                name = reloc["Symbol"]["Name"]
                if name not in strings:
                    continue
                offset = reloc["Offset"]
                owners = [s for s in functions
                          if s["Value"] <= offset < s["Value"] + s["Size"]]
                assert len(owners) == 1, (obj, reloc, owners)
                function = owners[0]
                kind = reloc["Type"]["Name"]
                addend = reloc["Addend"]
                if kind in ("R_HEX_B32_PCREL_X", "R_HEX_6_PCREL_X"):
                    # ELF PC-relative addends include the instruction's offset
                    # within its packet. Recover the actual symbol offset from
                    # the original object, not from the linker's output.
                    packet = offset
                    while packet >= 4:
                        pos = sec["Offset"] + packet - 4
                        previous = int.from_bytes(data[pos:pos + 4], "little")
                        if (previous >> 14) & 3 in (0, 3):
                            break
                        packet -= 4
                    addend = (addend - (offset - packet)) & MASK32
                    kind = {"R_HEX_B32_PCREL_X": "R_HEX_32_6_X",
                            "R_HEX_6_PCREL_X": "R_HEX_16_X"}[kind]
                references.append({"function": function["Name"]["Name"],
                                   "offset": offset - function["Value"],
                                   "symbol": name, "kind": kind, "addend": addend})

    expected = {
        b"return", b"pointer", b"array", b"element", b"interior",
        b"integer argument", b"pointer argument", b"first argument",
        b"second argument", b"reuse", b"store", b"macro first", b"macro second",
        b"duplicate", b"expression first", b"expression second", b"nested first",
        b"nested second", b"", b"A\0B", b"inline",
        b"variadic", b"stack argument", b"indirect",
    }
    if args.language == "c++":
        expected |= {b"template", b"lambda"}
    assert set(strings.values()) == {s + b"\0" for s in expected}, strings
    assert Counter(strings.values())[b"duplicate\0"] == 3
    assert {r["symbol"] for r in references} == set(strings), (
        "missing symbol references")
    return strings, references


def check_image(args, image, strings, references, algorithm, start, pic):
    info = inspect(args, image)
    dynamic = args.mode in ("shared", "pie")
    elf_type = "SharedObject" if dynamic else "Executable"
    assert elf_type in info["ElfHeader"]["Type"], info["ElfHeader"]
    flags1 = 0
    for entry in info.get("DynamicSection", []):
        if entry["Type"] == "FLAGS_1":
            flags1 |= entry["Value"]
    # Both shared libraries and PIEs have ET_DYN. Require DF_1_PIE as well,
    # so accidentally using --shared cannot masquerade as PIE coverage.
    assert bool(flags1 & 0x08000000) == (args.mode == "pie"), flags1
    sects = sections(info)
    by_name = {s["Name"]["Name"]: s for s in sects.values()}
    syms = {s["Name"]["Name"]: s for s in symbols(info)}
    if args.mode == "pie":
        assert info["ElfHeader"]["Entry"] == syms["return_address"]["Value"] != 0
        assert any(p["ProgramHeader"]["Type"]["Name"] == "PT_DYNAMIC"
                   for p in info["ProgramHeaders"])
    values = {}
    by_content = {}
    for name, content in strings.items():
        sym = syms[name]
        assert sym["Section"]["Name"] == "Absolute", (name, sym)
        assert sym["Binding"]["Name"] == "Local", (name, sym)
        assert sym["Size"] == len(content), (name, sym)
        value = sym["Value"]
        if algorithm == "md5":
            assert value == int.from_bytes(hashlib.md5(content).digest()[:4], "little")
        elif algorithm == "sha1":
            assert value == int.from_bytes(hashlib.sha1(content).digest()[-4:], "big")
        assert by_content.setdefault(content, value) == value, name
        values[name] = value
    if algorithm == "sequential":
        assert set(by_content.values()) == {
            (start + i) & MASK32 for i in range(len(by_content))}

    # DSECT data is retained in the file for bookkeeping, not in loaded memory.
    for name in TARGET_SECTIONS:
        sec = by_name[name]
        assert not sec["Flags"]["Value"] & 2, (name, "SHF_ALLOC is set")
        assert sec["Size"] > 0, name
        for item in info["ProgramHeaders"]:
            phdr = item["ProgramHeader"]
            if phdr["Type"]["Name"] == "PT_LOAD":
                assert (sec["Offset"] >= phdr["Offset"] + phdr["FileSize"] or
                        sec["Offset"] + sec["Size"] <= phdr["Offset"]), name

    # --emit-relocs keeps static relocation records, but none may be needed
    # by the runtime loader (including in shared-library and PIE modes).
    for sec in sects.values():
        if sec["Type"]["Name"] in ("SHT_REL", "SHT_RELA"):
            assert not sec["Flags"]["Value"] & 2 or sec["Size"] == 0, sec

    disassembly = run([args.objdump, "-d", image], image.parent)
    instructions = {}
    for line in disassembly.splitlines():
        match = re.match(r"\s*([0-9a-f]+):\s+(.*)", line)
        if match:
            instructions[int(match[1], 16)] = match[2]
    # ELD does not retain static relocation records for --shared or --pie.
    # Locate each operand using its original input function and
    # instruction offset. This also avoids trusting the rewritten addends as
    # the sole oracle for the expected immediate value.
    at = {syms[r["function"]]["Value"] + r["offset"]: r for r in references}
    assert len(at) == len(references), "overlapping fixture relocations"
    for address, reloc in at.items():
        name, kind = reloc["symbol"], reloc["kind"]
        assert kind in ("R_HEX_32_6_X", *ABSOLUTE_LOW), (name, reloc)
        if kind == "R_HEX_32_6_X":
            low = at[address + 4]
            assert low["kind"] in ABSOLUTE_LOW, low
            assert low["symbol"] == name, (reloc, low)
            assert low["addend"] == reloc["addend"], (reloc, low)
            assert "immext(" in instructions[address], reloc
            continue
        high = at[address - 4]
        assert high["kind"] == "R_HEX_32_6_X", high
        instruction = instructions[address]
        assert "add(pc," not in instruction, (name, instruction)
        # Non-PIC code can use an immediate store, combine, or duplex
        # instruction. Each has exactly one extended immediate operand.
        immediates = re.findall(r"##(-?(?:0x[0-9a-f]+|[0-9]+))\b", instruction)
        assert len(immediates) == 1, (name, instruction)
        actual = int(immediates[0], 0) & MASK32
        expected = (values[name] + reloc["addend"]) & MASK32
        assert actual == expected, (name, hex(actual), hex(expected), instruction)

    if not dynamic:
        retained = {r["Offset"]: r for r in relocations(info, executable_only=True)
                    if r["Symbol"]["Name"] in strings}
        assert retained.keys() == at.keys(), "missing retained relocations"
        for address, original in at.items():
            actual = retained[address]
            assert actual["Type"]["Name"] == original["kind"], (original, actual)
            assert actual["Symbol"]["Name"] == original["symbol"], (original, actual)
            assert actual["Addend"] & MASK32 == original["addend"] & MASK32, (
                original, actual)

    # The ordinary string is a negative control: it must not become an ID.
    ordinary = [s for s in symbols(info) if "ordinary_address" in s["Name"]["Name"]
                and s["Type"]["Name"] == "Object"]
    assert len(ordinary) == 1 and ordinary[0]["Section"]["Name"] == ".rodata"
    function = syms["ordinary_address"]
    begin, end = function["Value"], function["Value"] + function["Size"]
    body = "\n".join(text for addr, text in instructions.items()
                     if begin <= addr < end)
    assert ("add(pc," in body) == pic, body
    return info


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ("compiler", "link", "readelf", "objdump", "work"):
        parser.add_argument("--" + option, required=True)
    parser.add_argument("--compiler-flags", default="")
    parser.add_argument("--language", choices=("c", "c++"), required=True)
    parser.add_argument("--mode", choices=("static", "shared", "pie"), required=True)
    args = parser.parse_args()
    inputs = Path(__file__).resolve().parent
    work = Path(args.work).resolve()
    work.mkdir(parents=True, exist_ok=True)
    count = 0
    # Distinct directory names also work on case-insensitive filesystems.
    # Keep each flag explicit: -fPIC is not a substitute for -fpic testing.
    models = {
        "static": (("nonpic", "-fno-pic", 0, 0),
                   ("small-pic", "-fpic", 1, 0),
                   ("large-pic", "-fPIC", 2, 0)),
        "shared": (("small-pic", "-fpic", 1, 0),
                   ("large-pic", "-fPIC", 2, 0)),
        "pie": (("small-pie", "-fpie", 1, 1),
                ("large-pie", "-fPIE", 2, 2)),
    }[args.mode]
    for model, flag, pic_level, pie_level in models:
        for opt, start in (("O0", 0), ("O2", 0x7fffffff), ("Oz", MASK32)):
            variant = work / (opt + "-" + model)
            variant.mkdir(exist_ok=True)
            standard = "gnu++17" if args.language == "c++" else "gnu11"
            common = [args.compiler, *shlex.split(args.compiler_flags),
                      "-x", args.language, "-std=" + standard,
                      "-" + opt, flag,
                      "-DEXPECT_PIC_LEVEL=" + str(pic_level),
                      "-DEXPECT_PIE_LEVEL=" + str(pie_level),
                      "-ffunction-sections", "-fdata-sections",
                      "-Wa,--reloc-section-sym=none"]
            if args.language == "c++":
                common += ["-fno-exceptions", "-fno-rtti"]
            objects = [variant / "callers.o", variant / "callees.o"]
            for index, obj in enumerate(objects):
                run(common + (["-DSECOND_OBJECT"] if index else []) +
                    ["-c", inputs / "address_patterns.c", "-o", obj], variant)
            support = variant / "support.o"
            run([args.compiler, *shlex.split(args.compiler_flags), "-x", "assembler",
                 "-c", inputs / "address_patterns_support.s", "-o", support], variant)
            objects.append(support)
            strings, references = input_strings(args, objects)
            link = [args.link, "--" + args.mode,
                    "-e", "return_address",
                    *objects, "-T", inputs / "address_patterns.t"]
            if args.mode == "static":
                link.append("--emit-relocs")

            # The rewrite must be size-preserving, including every function.
            baseline = variant / "baseline.elf"
            run(link + ["-o", baseline], variant)
            original = inspect(args, baseline)
            original_sizes = {s["Name"]["Name"]: s["Size"] for s in symbols(original)
                              if s["Type"]["Name"] == "Function"}
            for algorithm in ("sequential", "md5", "sha1"):
                config = variant / (algorithm + ".yaml")
                config.write_text(
                    "GlobalPlugins:\n"
                    "  - Type: OutputSectionIterator\n"
                    "    Name: ReassignSectionAddresses\n"
                    "    Library: ReassignSectionAddresses\n"
                    "    Options: section=.dedup,.dedup_aux:hash={}:start={}\n".format(
                        algorithm, hex(start)))
                for base in (0x10000, 0x42000000):
                    images = []
                    for threaded in (False, True):
                        image = variant / "{}-{:x}-{}.elf".format(
                            algorithm, base, threaded)
                        threads = (["--threads", "--thread-count", "4"]
                                   if threaded else ["--no-threads"])
                        run(link + threads + ["--defsym", "TEXT_BASE=" + hex(base),
                            "--plugin-config", config, "-o", image], variant)
                        try:
                            info = check_image(args, image, strings, references,
                                               algorithm, start, bool(pic_level))
                        except AssertionError as error:
                            message = "{}: {}".format(image, error)
                            raise AssertionError(message) from error
                        sizes = {s["Name"]["Name"]: s["Size"] for s in symbols(info)
                                 if s["Type"]["Name"] == "Function"}
                        assert sizes == original_sizes, ("function size changed", image)
                        images.append(image)
                        count += 1
                    assert images[0].read_bytes() == images[1].read_bytes(), images
    print("Validated {} {} {} links".format(count, args.language, args.mode))


if __name__ == "__main__":
    main()

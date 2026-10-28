#!/usr/bin/env python3
"""Focused Hexagon compiler/linker permutations; shares the operand checker."""

import argparse
import hashlib
from pathlib import Path
import re
import shlex

from check_address_patterns import (check_image, input_strings, inspect,
                                    relocations, run, sections, symbols)


def compile_patterns(args, work, extra=(), mixed=False):
    inputs = Path(__file__).resolve().parent
    compiler = [args.compiler, *shlex.split(args.compiler_flags)]
    common = [*compiler, "-x", args.language, "-O2", "-fPIC",
              "-ffunction-sections", "-fdata-sections",
              "-Wa,--reloc-section-sym=none"]
    if args.language == "c++":
        common += ["-std=gnu++17", "-fno-exceptions", "-fno-rtti"]
    objects = [work / "callers.o", work / "callees.o"]
    for index, obj in enumerate(objects):
        flags = (["-DSECOND_OBJECT"] if index else []) + list(extra)
        if mixed:
            flags += ["-fpie" if index else "-fPIC"]
        run(common + flags + ["-c", inputs / "address_patterns.c", "-o", obj], work)
    support = work / "support.o"
    run(compiler + ["-x", "assembler", "-c", inputs / "address_patterns_support.s",
                    "-o", support], work)
    return objects + [support]


def plugin_config(work, algorithm="md5"):
    config = work / (algorithm + ".yaml")
    config.write_text(
        "GlobalPlugins:\n"
        "  - Type: OutputSectionIterator\n"
        "    Name: ReassignSectionAddresses\n"
        "    Library: ReassignSectionAddresses\n"
        "    Options: section=.dedup,.dedup_aux:hash={}:start=0xffffffff\n".format(
            algorithm))
    return config


def text_bytes(args, image):
    info = inspect(args, image)
    text = next(s for s in sections(info).values() if s["Name"]["Name"] == ".text")
    return text["Address"], image.read_bytes()[text["Offset"]:text["Offset"] + text["Size"]]


def check_returns(args, image, expected):
    """Small fixtures survive LTO without depending on generated local names."""
    info = inspect(args, image)
    syms = {s["Name"]["Name"]: s for s in symbols(info)}
    disassembly = run([args.objdump, "-d", image], image.parent)
    instructions = {}
    for line in disassembly.splitlines():
        match = re.match(r"\s*([0-9a-f]+):\s+(.*)", line)
        if match:
            instructions[int(match[1], 16)] = match[2]
    for function, content in expected.items():
        value = int.from_bytes(hashlib.md5(content + b"\0").digest()[:4], "little")
        assigned = [s["Value"] for s in symbols(info)
                    if s["Type"]["Name"] == "Object" and
                    s["Section"]["Name"] == "Absolute"]
        assert value in assigned, (function, "incorrect content hash", hex(value),
                                   [hex(v) for v in assigned])
        symbol = syms[function]
        body = "\n".join(text for addr, text in instructions.items()
                         if symbol["Value"] <= addr < symbol["Value"] + symbol["Size"])
        assert "add(pc," not in body, (function, body)
        immediates = re.findall(r"##(-?(?:0x[0-9a-f]+|[0-9]+))\b", body)
        assert [int(s, 0) & 0xffffffff for s in immediates] == [value], (function, body)
    for sec in sections(info).values():
        if sec["Name"]["Name"].startswith(".dedup"):
            assert not sec["Flags"]["Value"] & 2, sec
            for entry in info["ProgramHeaders"]:
                ph = entry["ProgramHeader"]
                if ph["Type"]["Name"] == "PT_LOAD":
                    assert (sec["Offset"] >= ph["Offset"] + ph["FileSize"] or
                            sec["Offset"] + sec["Size"] <= ph["Offset"]), sec
        if sec["Type"]["Name"] in ("SHT_REL", "SHT_RELA"):
            assert not sec["Flags"]["Value"] & 2 or not sec["Size"], sec
    return info


def lto_case(args, work, case):
    inputs = Path(__file__).resolve().parent
    compiler = [args.compiler, *shlex.split(args.compiler_flags), "-x", args.language,
                "-O2", "-fPIC", "-Wa,--reloc-section-sym=none",
                "-flto=thin" if case == "thin-lto" else "-flto"]
    objects = [work / "first.bc", work / "second.bc"]
    for index, obj in enumerate(objects):
        run(compiler + (["-DSECOND_OBJECT"] if index else []) +
            ["-c", inputs / "lto_strings.c", "-o", obj], work)
    outputs = []
    for threaded in (False, True):
        image = work / ("threaded.elf" if threaded else "serial.elf")
        threads = (["--threads", "--thread-count", "4", "--thinlto-jobs=2"]
                   if threaded else ["--no-threads", "--thinlto-jobs=1"])
        assembler = (["--flto-options=asmopts=--reloc-section-sym=none"]
                     if case == "lto-asm" else [])
        run([args.link, "--shared", *objects, *threads, *assembler,
             "--flto-options=codegen=-reloc-section-sym=none",
             "-T", inputs / "address_patterns.t", "--plugin-config", plugin_config(work),
             "-o", image], work)
        check_returns(args, image, {"test_a": b"alpha", "test_b": b"beta",
                                    "test_duplicate": b"alpha"})
        outputs.append(image)
    assert text_bytes(args, outputs[0]) == text_bytes(args, outputs[1])
    return 2


def relaxation_case(args, work):
    inputs = Path(__file__).resolve().parent
    obj = work / "relax.o"
    run([args.compiler, *shlex.split(args.compiler_flags), "-x", "assembler",
         "-Wa,--reloc-section-sym=none", "-c", inputs / "relax_strings.s", "-o", obj], work)
    command = [args.link, "--shared", obj, "-T", inputs / "address_patterns.t",
               "--plugin-config", plugin_config(work)]
    baseline = work / "baseline.elf"
    run(command + ["-o", baseline], work)
    check_returns(args, baseline, {"relaxed_id": b"relax"})
    for option in ("--relax", "--relax=.text.aaa"):
        image = work / ("all.elf" if option == "--relax" else "selected.elf")
        run(command + [option, "-o", image], work)
        check_returns(args, image, {"relaxed_id": b"relax"})
        # A real instruction must have been deleted: accepting --relax alone
        # is not sufficient to exercise RegionFragmentEx and relaxed fixups.
        assert len(text_bytes(args, image)[1]) == len(text_bytes(args, baseline)[1]) - 4
    return 3


def binding_case(args, work, case):
    inputs = Path(__file__).resolve().parent
    source = "comdat_strings.cpp" if case == "comdat" else "weak_strings.c"
    compiler = [args.compiler, *shlex.split(args.compiler_flags), "-x", args.language,
                "-O2", "-fPIC", "-ffunction-sections", "-fdata-sections",
                "-Wa,--reloc-section-sym=none"]
    objects = [work / "first.o", work / "second.o"]
    for index, obj in enumerate(objects):
        run(compiler + (["-DSECOND_OBJECT"] if index else []) +
            ["-c", inputs / source, "-o", obj], work)
    if case == "comdat":
        # Verify that the fixture really emitted COMDATs, rather than two
        # unrelated internal-linkage copies of an inline function.
        for obj in objects:
            assert any(s["Flags"]["Value"] & 0x200
                       for s in sections(inspect(args, obj)).values())
    count = 0
    orders = (objects, list(reversed(objects))) if case == "comdat" else (
        [objects[0]], objects, list(reversed(objects)))
    for index, order in enumerate(orders):
        for symbolic in (False, True):
            image = work / "{}-{}.elf".format(index, symbolic)
            run([args.link, "--shared", *order,
                 *(["-Bsymbolic"] if symbolic else []),
                 "-T", inputs / "address_patterns.t", "--plugin-config", plugin_config(work),
                 "-o", image], work)
            expected = ({"_Z9common_idv": b"comdat"} if case == "comdat" else {
                "use_weak": b"weak" if len(order) == 1 else b"strong",
                "use_alias": b"alias"})
            info = check_returns(args, image, expected)
            if case == "comdat":
                definitions = [s for s in symbols(info)
                               if s["Type"]["Name"] == "Object" and
                               s["Section"]["Name"] == "Absolute"]
                assert len(definitions) == 1, definitions
                assert definitions[0]["Binding"]["Name"] == "Weak", definitions
            else:
                by_name = {s["Name"]["Name"]: s for s in symbols(info)}
                assert by_name["weak_id"]["Binding"]["Name"] == (
                    "Weak" if len(order) == 1 else "Global")
                assert by_name["own_id"]["Value"] == by_name["alias_id"]["Value"]
            count += 1
    return count


def preservation_case(args, work, case):
    """Negative controls: section-relative references are NOT repaired."""
    inputs = Path(__file__).resolve().parent
    compiler = [args.compiler, *shlex.split(args.compiler_flags), "-x", args.language,
                "-O2", "-fPIC"]
    objects = [work / "first.o", work / "second.o"]
    for index, obj in enumerate(objects):
        flags = ["-DSECOND_OBJECT"] if index else []
        if case == "lto-preservation":
            flags += ["-flto", "-Wa,--reloc-section-sym=none"]
        elif index == 0:
            flags += ["-Wa,--reloc-section-sym=none"]
        run(compiler + flags + ["-c", inputs / "lto_strings.c", "-o", obj], work)
    if case == "legacy-archive":
        assert any(r["Symbol"]["Name"] == ".dedup"
                   for r in relocations(inspect(args, objects[1])))
        archive = work / "legacy.a"
        run([args.ar, "rcs", archive, objects[1]], work)
        objects = [objects[0], "--whole-archive", archive, "--no-whole-archive"]
    image = work / "unsupported.elf"
    run([args.link, "--shared", *objects, "-T", inputs / "address_patterns.t",
         "--plugin-config", plugin_config(work), "-o", image], work)
    # Do not use a broad expected-failure marker: assert the specific known
    # limitation, and (for the mixed archive) prove the new object still works.
    if case == "legacy-archive":
        check_returns(args, image, {"test_a": b"alpha"})
    target = "test_b" if case == "legacy-archive" else "test_a"
    info = inspect(args, image)
    sym = next(s for s in symbols(info) if s["Name"]["Name"] == target)
    disassembly = run([args.objdump, "-d", image], work)
    body = []
    for line in disassembly.splitlines():
        match = re.match(r"\s*([0-9a-f]+):\s+(.*)", line)
        if match and sym["Value"] <= int(match[1], 16) < sym["Value"] + sym["Size"]:
            body.append(match[2])
    assert "add(pc," in "\n".join(body), (case, body)
    print("Confirmed unsupported section-relative path:", case)
    return 1


def merge_case(args, work, case):
    inputs = Path(__file__).resolve().parent
    objects = [work / "first.o", work / "second.o"]
    for index, obj in enumerate(objects):
        run([args.compiler, *shlex.split(args.compiler_flags), "-x", "assembler",
             "-Wa,--reloc-section-sym=none",
             *(["-Wa,-defsym,SECOND_OBJECT=1"] if index else []),
             "-c", inputs / "merge_strings.s", "-o", obj], work)
        assert any(s["Flags"]["Value"] & 0x30 == 0x30
                   for s in sections(inspect(args, obj)).values())
    image = work / "image.elf"
    run([args.link, "--shared", *objects,
         *(["--no-merge-strings"] if case == "no-merge-strings" else []),
         "-T", inputs / "address_patterns.t", "--plugin-config", plugin_config(work),
         "-o", image], work)
    check_returns(args, image, {"merge_a": b"merge", "merge_b": b"merge"})
    return 1


def native_case(args, work, case):
    inputs = Path(__file__).resolve().parent
    variants = {
        "unsplit": ["-fno-function-sections", "-fno-data-sections"],
        "O3": ["-O3"], "Os": ["-Os"], "debug": ["-g", "-gdwarf-5"],
        "G0": ["-G0"], "G8": ["-G8"],
        "v68": ["-mcpu=hexagonv68"], "v73": ["-mcpu=hexagonv73"],
        "v79": ["-mcpu=hexagonv79"], "long-calls": ["-mlong-calls"],
        "hidden": ["-fvisibility=hidden"],
        "merge-constants": ["-fmerge-all-constants"],
    }
    objects = compile_patterns(args, work, variants.get(case, ()),
                               mixed=case == "mixed-pie")
    args.mode = "pie" if case in ("static-pie", "mixed-pie") else "shared"
    if case in ("gc", "gc-keep", "strip", "discard"):
        args.mode = "static"
    strings, references = input_strings(args, objects)
    script = inputs / "address_patterns.t"
    flags = []
    if args.mode == "static":
        flags.append("--emit-relocs")
    if case == "static-pie":
        flags += ["--static", "--no-dynamic-linker"]
    if case == "partial":
        combined = work / "combined.o"
        run([args.link, "-r", *objects, "-o", combined], work)
        # Use the intermediate object's own symbols/offsets as the oracle.
        objects = [combined]
        strings, references = input_strings(args, objects)
    if case in ("archive", "whole-archive"):
        archive = work / "callees.a"
        run([args.ar, "rcs", archive, objects[1]], work)
        if case == "whole-archive":
            objects = [objects[0], "--whole-archive", archive,
                       "--no-whole-archive", objects[2]]
        else:
            objects = [objects[0], archive, objects[2]]
    if case in ("reverse", "sequential-reverse"):
        objects.reverse()
    if case == "sort":
        script = work / "sort.t"
        script.write_text((inputs / "address_patterns.t").read_text().replace(
            "*(.text*)", "*(SORT_BY_NAME(.text*))"))
    if case in ("gc", "gc-keep"):
        flags += ["--gc-sections", "--undefined=ordinary_address",
                  "--undefined=other_section"]
        if case == "gc-keep":
            script = work / "keep.t"
            script.write_text((inputs / "address_patterns.t").read_text().replace(
                "*(.text*)", "KEEP(*(.text.repeated_macro)) *(.text*)"))
    if case == "phdrs":
        script = inputs / "address_patterns_phdrs.t"
    algorithm = "sequential" if case == "sequential-reverse" else "md5"
    config = plugin_config(work, algorithm)
    command = [args.link, "--" + args.mode, *flags, *objects, "-T", script,
               "-e", "return_address", "--plugin-config", config]
    outputs = []
    for threaded in (False, True):
        image = work / ("threaded.elf" if threaded else "serial.elf")
        threads = ["--threads", "--thread-count", "4"] if threaded else ["--no-threads"]
        run(command + threads + ["-o", image], work)
        actual = inspect(args, image)
        if case in ("gc", "gc-keep"):
            names = {s["Name"]["Name"] for s in symbols(actual)}
            assert "call_pointer" not in names, "GC did not remove an unused caller"
            assert ("repeated_macro" in names) == (case == "gc-keep")
            references = [r for r in references if r["function"] in names]
            strings = {n: data for n, data in strings.items() if n in names}
        check_image(args, image, strings, references, algorithm, 0xffffffff, True)
        if case == "static-pie":
            assert all(p["ProgramHeader"]["Type"]["Name"] != "PT_INTERP"
                       for p in actual["ProgramHeaders"])
        outputs.append(image)
    assert outputs[0].read_bytes() == outputs[1].read_bytes(), case
    if case == "sequential-reverse":
        forward = work / "forward.elf"
        run([args.link, "--shared", *reversed(objects), "-T", script,
             "--plugin-config", config, "-o", forward], work)
        check_image(args, forward, strings, references, algorithm, 0xffffffff, True)
        name = next(n for n, data in strings.items() if data == b"return\0")
        values = [{s["Name"]["Name"]: s["Value"] for s in symbols(inspect(args, f))}
                  for f in (forward, outputs[0])]
        assert values[0][name] == 0xffffffff and values[1][name] != values[0][name]
    if case in ("strip", "discard"):
        stripped = work / "filtered.elf"
        # Do not ask a stripped image to retain symbol-bearing relocations.
        command.remove("--emit-relocs")
        option = "--strip-all" if case == "strip" else "--discard-all"
        run(command + [option, "-o", stripped], work)
        assert text_bytes(args, stripped) == text_bytes(args, outputs[0])
        final = inspect(args, stripped)
        assert not any(s["Name"]["Name"] in strings for s in symbols(final))
    return 2 + (case in ("strip", "discard", "sequential-reverse"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ("compiler", "link", "readelf", "objdump", "work"):
        parser.add_argument("--" + option, required=True)
    parser.add_argument("--compiler-flags", default="")
    parser.add_argument("--ar", default="llvm-ar")
    parser.add_argument("--language", choices=("c", "c++"), required=True)
    parser.add_argument("--case", required=True)
    args = parser.parse_args()
    root = Path(args.work).resolve()
    root.mkdir(parents=True, exist_ok=True)
    groups = {
        "compiler": ("unsplit", "O3", "Os", "debug", "G0", "G8", "v68", "v73",
                     "v79", "long-calls", "hidden", "merge-constants"),
        "layout": ("reverse", "sequential-reverse", "sort", "phdrs", "gc", "gc-keep",
                   "strip", "discard", "static-pie", "mixed-pie"),
        "objects": ("archive", "whole-archive", "partial"),
        "lto": ("full-lto", "thin-lto"),
    }
    supported = set(groups) | {case for group in groups.values() for case in group}
    supported |= {"relaxation", "comdat", "weak", "lto-asm", "legacy-archive",
                  "lto-preservation", "merge-strings", "no-merge-strings"}
    if args.case not in supported:
        parser.error("unknown permutation: " + args.case)
    cases = groups.get(args.case, (args.case,))
    count = 0
    for case in cases:
        work = root / case
        work.mkdir(exist_ok=True)
        print("Checking", args.language, case, flush=True)
        if case in ("full-lto", "thin-lto", "lto-asm"):
            count += lto_case(args, work, case)
        elif case == "relaxation":
            count += relaxation_case(args, work)
        elif case in ("comdat", "weak"):
            count += binding_case(args, work, case)
        elif case in ("legacy-archive", "lto-preservation"):
            count += preservation_case(args, work, case)
        elif case in ("merge-strings", "no-merge-strings"):
            count += merge_case(args, work, case)
        else:
            count += native_case(args, work, case)
    print("Validated {} {} focused links".format(count, args.language))


if __name__ == "__main__":
    main()

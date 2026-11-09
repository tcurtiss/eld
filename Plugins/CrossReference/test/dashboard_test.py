#!/usr/bin/env python3
"""Compile, export and analyze a real fixture without a browser or npm packages."""

import gzip
import json
import struct
import subprocess
from pathlib import Path
import tempfile

from standalone_test import argument_parser, run, runtime_environment


def elf_records(path):
    """Read ELF placement independently of the producer (32/64 bit, either endian)."""
    data = path.read_bytes()
    assert data[:4] == b"\x7fELF"
    wide = data[4] == 2
    endian = "<" if data[5] == 1 else ">"
    header = struct.unpack_from(endian + ("HHIQQQIHHHHHH" if wide else "HHIIIIIHHHHHH"), data, 16)
    offset, stride, count, names_index = header[5], header[10], header[11], header[12]
    form = endian + ("IIQQQQIIQQ" if wide else "IIIIIIIIII")
    rows = [struct.unpack_from(form, data, offset + i * stride) for i in range(count)]
    names = rows[names_index]
    strings = data[names[4]:names[4] + names[5]]
    def name(table, index):
        return table[index:table.index(b"\0", index)].decode()
    sections = {name(strings, row[0]): row for row in rows}
    symbols = {}
    for row in rows:
        if row[1] != 2:
            continue
        table = rows[row[6]]
        strings = data[table[4]:table[4] + table[5]]
        for position in range(row[4], row[4] + row[5], row[9]):
            record = struct.unpack_from(endian + ("IBBHQQ" if wide else "IIIBBH"), data, position)
            symbols[name(strings, record[0])] = record[4] if wide else record[1]
    return sections, symbols


def main():
    parser = argument_parser(__doc__)
    parser.add_argument("--node", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--automatic-metadata", action="store_true")
    args = parser.parse_args()
    env = runtime_environment(args)
    exports = Path(args.output_dir).resolve()
    exports.mkdir(parents=True, exist_ok=True)
    checker = Path(__file__).resolve().parent.parent / "dashboard/tools/check-export.js"

    with tempfile.TemporaryDirectory(prefix="eld-dashboard-") as temp:
        work = Path(temp)
        sources = {
            "app/front/main.c": """
const char *greeting = "hello dashboard";
volatile int zero_data = 0;
int unused_data = 99;
const int vector_table __attribute__((section(".vectors"))) = 42;
int forced_root(void) { return 5; }
int alternate_entry(void) { return 6; }
extern int target_function(void);
int unused_function(void) { return unused_data; }
int main(void) { return target_function() + greeting[0] + zero_data; }
""",
            "base/engine/helper.cpp": """
namespace demo {
namespace operator_helpers { int read() { return 1; } }
namespace { int local_helper() { return 1; } }
struct Tag {};
template<class T> struct Box { static int read(); };
template<class T> int Box<T>::read() { return 2; }
struct Receiver {
  static int take(Tag);
  int operator<<(Tag);
  operator Box<Tag>();
};
int Receiver::take(Tag) { return 3; }
int Receiver::operator<<(Tag) { return 4; }
Receiver::operator Box<Tag>() { return {}; }
}
extern "C" {
int target_data __attribute__((aligned(64))) = 7;
int target_function(void) { return target_data + demo::operator_helpers::read() + demo::local_helper() + demo::Box<demo::Tag>::read() + demo::Receiver::take({}); }
}
""",
        }
        objects = []
        for name, text in sources.items():
            source = work / name
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text(text)
            obj = source.with_suffix(".o")
            command = [args.target_cxx if source.suffix == ".cpp" else args.target_cc or args.target_cxx]
            if args.target_triple:
                command.append("--target=" + args.target_triple)
            command += args.target_cxx_args + args.target_cxx_arg
            command += ["-g", "-O0", "-ffunction-sections", "-fdata-sections",
                        "-c", str(source), "-o", str(obj)]
            run(command, env, work)
            objects.append(str(obj))

        script = work / "image.ld"
        script.write_text("""
ENTRY(main)
MEMORY {
  CODE (rx) : ORIGIN = 0x10000, LENGTH = 32K
  RAM (rw) : ORIGIN = ORIGIN(CODE) + 0x1f0000, LENGTH = LENGTH(CODE) / 2
}
SECTIONS {
  .vectors : { KEEP(*(.vectors)) } > CODE
  .text : { *(.text .text.*) } > CODE
  .rodata : { *(.rodata .rodata.*) } > RAM
  .data : { *(.data .data.*) } > RAM
  .bss : { *(.bss .bss.*) } > RAM
}
""")
        files = []
        for details in ("none", "elf", "dwarf"):
            for fmt in ("json", "json_columnar"):
                output = exports / (details + "." + fmt + ".json")
                options = ("file={}:format={}:symbol_details={}:gzip=yes:"
                           "source_root={}:exclude_local=no:cpp_demangle=yes:"
                           "title=Dashboard fixture:compression_patterns=.text:"
                           "compression_code_ratio=0.25:compression_data_ratio=0.5:"
                           "compression_buffer_bytes=4096:root_symbols=unused_*").format(output, fmt, details, work)
                if not args.automatic_metadata:
                    options += ":region=CODE,65536,32768:region=RAM,2097152,16384:root_symbols=main,forced_root"
                if details != "none":
                    options += ":fragment_details=data"
                config = work / "plugins.yaml"
                config.write_text("GlobalPlugins:\n  - Type: LinkerPlugin\n"
                                  "    Name: CrossReference\n    Library: CrossReference\n"
                                  "    Options: " + json.dumps(options) + "\n")
                command = [args.target_ld] + args.target_ld_args + args.target_ld_arg
                command += objects + ["--gc-sections", "-u", "forced_root", "-T", str(script), "-o", str(work / "image.out"),
                                      "--plugin-config", str(config)]
                run(command, env, work)
                files.append(str(output) + ".gz")
        _, symbols = elf_records(work / "image.out")
        expected = {}
        for obj in objects:
            sections, _ = elf_records(Path(obj))
            for name in ("main", "target_function", "target_data", "zero_data", "vector_table", "forced_root"):
                row = next((row for section, row in sections.items() if section.endswith("." + name) or section == ".vectors" and name == "vector_table"), None)
                if row:
                    expected[name] = {"addr": symbols[name], "align": row[8]}
        assert len(expected) == 6, "Fixture must check all six ELF section addresses"
        expectation = work / "expected.json"
        expectation.write_text(json.dumps(expected))
        print(run([args.node, str(checker)] + files + [str(expectation)], env, work), end="")

        # Omission and invalid settings are part of the producer contract.
        def export(extra, succeeds=True, entry="main", link_script=script,
                   fmt="json", configuration=None):
            output = work / "optional.json"
            output.unlink(missing_ok=True)
            compressed_output = Path(str(output) + ".gz")
            compressed_output.unlink(missing_ok=True)
            options = "file={}".format(output)
            if fmt:
                options += ":format=" + fmt
            options += extra
            config.write_text(configuration or
                              ("GlobalPlugins:\n  - Type: LinkerPlugin\n"
                               "    Name: CrossReference\n    Library: CrossReference\n"
                               "    Options: " + json.dumps(options) + "\n"))
            command = [args.target_ld] + args.target_ld_args + args.target_ld_arg + objects
            command += ["--gc-sections", "-T", str(link_script), "-e", entry,
                        "-o", str(work / "image.out"), "--plugin-config", str(config)]
            result = subprocess.run(command, cwd=work, env=env, text=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            if succeeds:
                assert result.returncode == 0, result.stdout
                if fmt == "text":
                    return output.read_text()
                if compressed_output.exists():
                    with gzip.open(compressed_output, "rt") as stream:
                        return json.load(stream)
                return json.loads(output.read_text())
            assert result.returncode != 0 and "CrossReference" in result.stdout, result.stdout
            assert not output.exists(), "Invalid settings must not produce an export"
            assert not compressed_output.exists(), "Invalid settings must not produce a gzip export"

        def check_defaults(document):
            assert document["format"] == "fia-columnar" and document["version"] == 1
            assert document["coalesce_dirs"] == "unary"
            assert any("⟫" in d[1] for d in document["strings"]["dirs"])
            assert any("Box<demo::Tag>" == s[1] for s in document["strings"]["scopes"])
            details = document["symbolDetails"]
            assert details["sourceFiles"] and any(line > 0 for line in details["symbols"]["sourceLine"])
            assert 1 in details["initializerFragments"]["refs"]["class"]

        defaults = export("", fmt=None)
        check_defaults(defaults)
        template = Path(__file__).resolve().parent.parent / "CrossReference.template.yaml"
        # Load the actual YAML through ELD, exercising its folded scalar parser.
        configuration = template.read_text().replace("file=crossreference.json:",
                                                     "file=" + str(work / "optional.json") + ":")
        folded = export("", fmt=None, configuration=configuration)
        check_defaults(folded)
        assert folded == defaults
        literal = export("", fmt=None, configuration=configuration.replace("Options: >-", "Options: |-"))
        assert literal == defaults
        plain = export(":cpp_demangle=no:symbol_details=none:coalesce_dirs=none")
        assert "symbolDetails" not in plain
        assert "coalesce_dirs" not in plain
        assert export(":symbol_details=none")["nodes"]
        assert "# Symbols:" in export(":symbol_details=none", fmt="text")
        without_fragments = export(":fragment_details=none", fmt=None)
        assert "initializerFragments" not in without_fragments["symbolDetails"]
        export(":fragment_details=data", fmt="text", succeeds=False)
        export(":symbol_details=none:fragment_details=data", succeeds=False)
        assert "title" not in plain and "compression" not in plain
        assert all("class" not in n for n in plain["nodes"])
        assert ("regions" in plain) == args.automatic_metadata
        if args.automatic_metadata:
            alternate = export("", entry="alternate_entry")
            assert next(n for n in alternate["nodes"] if n["name"] == "alternate_entry").get("root")
            assert not next(n for n in alternate["nodes"] if n["name"] == "main").get("root", False)
            absent = work / "absent.ld"
            absent.write_text("SECTIONS { . = 0x10000; .text : { *(.text*) } .rodata : { *(.rodata*) } .data : { *(.data*) } .bss : { *(.bss*) } }")
            assert "regions" not in export("", link_script=absent)
            if "aarch64" in args.target_triple:
                unsafe = work / "unsafe.ld"
                unsafe.write_text(absent.read_text().replace("0x10000", "0x20000000000000"))
                export("", succeeds=False, link_script=unsafe)
        override = export(":region=CODE,65536,4096:compression_code_ratio=0:compression_buffer_bytes=0")
        assert override["regions"]["CODE"]["size"] == 4096
        assert override["compression"] == {"codeRatio": 0, "decompressBufferBytes": 0}
        for invalid in (":compression_code_ratio=nan", ":compression_code_ratio=1.1",
                        ":compression_data_ratio=-0.1", ":compression_buffer_bytes=+1", ":compression_buffer_bytes= 1", ":compression_data_ratio=0.3junk",
                        ":compression_buffer_bytes=9007199254740992",
                        ":region=RAM,9007199254740991,1", ":region=RAM,-1,100",
                        ":region=RAM,0,100:region=RAM,0,100"):
            export(invalid, succeeds=False)
        print("Dashboard test exports: " + str(exports))


if __name__ == "__main__":
    main()

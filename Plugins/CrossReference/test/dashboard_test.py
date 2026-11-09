#!/usr/bin/env python3
"""Compile, export and analyze a real fixture without a browser or npm packages."""

import json
from pathlib import Path
import tempfile

from standalone_test import argument_parser, run, runtime_environment


def main():
    parser = argument_parser(__doc__)
    parser.add_argument("--node", required=True)
    parser.add_argument("--output-dir", required=True)
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
extern int target_function(void);
int unused_function(void) { return unused_data; }
int main(void) { return target_function() + greeting[0] + zero_data; }
""",
            "base/engine/helper.c": """
int target_data = 7;
int target_function(void) { return target_data; }
""",
        }
        objects = []
        for name, text in sources.items():
            source = work / name
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text(text)
            obj = source.with_suffix(".o")
            command = [args.target_cc or args.target_cxx]
            if args.target_triple:
                command.append("--target=" + args.target_triple)
            command += args.target_cxx_args + args.target_cxx_arg
            command += ["-g", "-O0", "-ffunction-sections", "-fdata-sections",
                        "-c", str(source), "-o", str(obj)]
            run(command, env, work)
            objects.append(str(obj))

        files = []
        for details in ("none", "elf", "dwarf"):
            for fmt in ("json", "json_columnar"):
                output = exports / (details + "." + fmt + ".json")
                options = ("file={}:format={}:symbol_details={}:gzip=yes:"
                           "source_root={}:exclude_local=no").format(output, fmt, details, work)
                if details != "none":
                    options += ":fragment_details=data"
                config = work / "plugins.yaml"
                config.write_text("GlobalPlugins:\n  - Type: LinkerPlugin\n"
                                  "    Name: CrossReference\n    Library: CrossReference\n"
                                  "    Options: " + json.dumps(options) + "\n")
                command = [args.target_ld] + args.target_ld_args + args.target_ld_arg
                command += objects + ["--gc-sections", "-e", "main", "-o", str(work / "image.out"),
                                      "--plugin-config", str(config)]
                run(command, env, work)
                files.append(str(output) + ".gz")
        print(run([args.node, str(checker)] + files, env, work), end="")
        print("Dashboard test exports: " + str(exports))


if __name__ == "__main__":
    main()

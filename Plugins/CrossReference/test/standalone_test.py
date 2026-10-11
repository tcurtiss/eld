#!/usr/bin/env python3
"""Package-only smoke test for the standalone CrossReference plugin."""

import argparse
import gzip
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile


def run(command, env, cwd):
    result = subprocess.run(command, cwd=cwd, env=env, text=True,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError("command failed ({}):\n{}\n{}".format(
            result.returncode, " ".join(command), result.stdout))
    return result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plugin-dir", required=True)
    parser.add_argument("--tools-dir", required=True)
    parser.add_argument("--target-cc", default="")
    parser.add_argument("--target-cxx", required=True)
    parser.add_argument("--target-ld", required=True)
    parser.add_argument("--target-triple", default="")
    parser.add_argument("--target-cxx-flags", default="")
    parser.add_argument("--target-ld-flags", default="")
    args = parser.parse_args()

    plugin_dir = Path(args.plugin_dir).resolve()
    tools_dir = Path(args.tools_dir).resolve()
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = os.pathsep.join(
        [str(plugin_dir), str(tools_dir / "lib"), env.get("LD_LIBRARY_PATH", "")])

    with tempfile.TemporaryDirectory(prefix="eld-crossreference-") as temp:
        work = Path(temp)
        source = work / "input.c"
        obj = work / "input.o"
        output = work / "image.out"
        dump = work / "xref.json"
        source.write_text("""
            extern int target;
            int target_data = 7;
            int target_function(void) { return target_data; }
            int main(void) { return target_function() + target; }
            int target = 1;
        """)
        compile_command = [args.target_cc or args.target_cxx]
        if args.target_triple:
            compile_command.append("--target=" + args.target_triple)
        compile_command += shlex.split(args.target_cxx_flags)
        compile_command += ["-c", str(source), "-o", str(obj),
                            "-ffunction-sections", "-fdata-sections"]
        run(compile_command, env, work)

        config = ("GlobalPlugins:\n"
                  "  - Type: LinkerPlugin\n"
                  "    Name: CrossReference\n"
                  "    Library: CrossReference\n"
                  "    Options: file={}:format=json:gzip=yes\n").format(dump)
        config_path = work / "plugins.yaml"
        config_path.write_text(config)
        link_command = [args.target_ld]
        link_command += shlex.split(args.target_ld_flags)
        link_command += [str(obj), "-e", "main", "-o", str(output),
                         "--plugin-config", str(config_path)]
        run(link_command, env, work)

        with gzip.open(Path(str(dump) + ".gz"), "rt") as stream:
            document = json.load(stream)
        names = {node["name"] for node in document["nodes"]}
        if not {"main", "target_function", "target_data"}.issubset(names):
            raise RuntimeError("CrossReference JSON did not contain expected symbols")
        if not document["edges"]:
            raise RuntimeError("CrossReference JSON did not contain edges")


if __name__ == "__main__":
    main()

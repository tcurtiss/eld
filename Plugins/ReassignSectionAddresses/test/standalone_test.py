#!/usr/bin/env python3
"""Package-only smoke test for ReassignSectionAddresses."""

import argparse
import os
from pathlib import Path
import shlex
import subprocess
import sys
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
    parser.add_argument("--library-dir", default="")
    parser.add_argument("--runtime-dir", default="")
    parser.add_argument("--target-cc", default="")
    parser.add_argument("--target-cxx", required=True)
    parser.add_argument("--target-ld", required=True)
    parser.add_argument("--target-triple", default="")
    parser.add_argument("--target-cxx-flags", default="")
    parser.add_argument("--target-ld-flags", default="")
    args = parser.parse_args()

    plugin_dir = Path(args.plugin_dir).resolve()
    tools_dir = Path(args.tools_dir).resolve()
    inputs = Path(__file__).resolve().parent / "Inputs"
    env = os.environ.copy()
    runtime_var = ("PATH" if os.name == "nt" else
                   "DYLD_LIBRARY_PATH" if sys.platform == "darwin" else
                   "LD_LIBRARY_PATH")
    runtime_dirs = [str(plugin_dir),
                    args.library_dir or str(tools_dir / "lib"),
                    args.runtime_dir or str(tools_dir / "bin"),
                    env.get(runtime_var, "")]
    env[runtime_var] = os.pathsep.join(path for path in runtime_dirs if path)

    with tempfile.TemporaryDirectory(prefix="eld-reassign-") as temp:
        work = Path(temp)
        obj = work / "data.o"
        output = work / "image.out"
        dump = work / "reassign.dump"
        source = inputs / "data.c"
        linker_script = inputs / "script.t"

        compile_command = [args.target_cc or args.target_cxx]
        if args.target_triple:
            compile_command.append("--target=" + args.target_triple)
        compile_command += shlex.split(args.target_cxx_flags)
        compile_command += ["-c", str(source), "-o", str(obj), "-fdata-sections"]
        run(compile_command, env, work)

        config = ("GlobalPlugins:\n"
                  "  - Type: OutputSectionIterator\n"
                  "    Name: ReassignSectionAddresses\n"
                  "    Library: ReassignSectionAddresses\n"
                  "    Options: section=.reassign_a:hash=sequential:"
                  "start=0x100:dump={}\n").format(dump)
        config_path = work / "plugins.yaml"
        config_path.write_text(config)
        link_command = [args.target_ld]
        link_command += shlex.split(args.target_ld_flags)
        link_command += [str(obj), "-T", str(linker_script), "-e", "main",
                         "-o", str(output), "--plugin-config", str(config_path),
                         "--trace=plugin"]
        log = run(link_command, env, work)

        dump_lines = dump.read_text().splitlines()
        if not any(line.startswith("00000100:same") for line in dump_lines):
            raise RuntimeError("ReassignSectionAddresses dump lacked expected symbol:\n" +
                               "\n".join(dump_lines))
        if "ReassignSectionAddresses" not in log:
            raise RuntimeError("ReassignSectionAddresses trace was not observed:\n" + log)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Package-only smoke test for ReassignSectionAddresses."""

import argparse
import csv
import gzip
import hashlib
import json
import os
from pathlib import Path
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


def argument_list(value):
    try:
        arguments = json.loads(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("invalid JSON argument list: " + str(error))
    if not isinstance(arguments, list) or not all(
            isinstance(argument, str) for argument in arguments):
        raise argparse.ArgumentTypeError("expected a JSON array of strings")
    return arguments


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
    parser.add_argument("--target-cxx-args", type=argument_list, default=[])
    parser.add_argument("--target-ld-args", type=argument_list, default=[])
    parser.add_argument("--target-cxx-arg", action="append", default=[])
    parser.add_argument("--target-ld-arg", action="append", default=[])
    args = parser.parse_args()

    plugin_dir = Path(args.plugin_dir).resolve()
    tools_dir = Path(args.tools_dir).resolve()
    inputs = Path(__file__).resolve().parent / "Inputs"
    example_config = plugin_dir / "ReassignSectionAddresses.yaml"
    source_config = inputs.parent.parent / "ReassignSectionAddresses.yaml"
    if example_config.read_bytes() != source_config.read_bytes():
        raise RuntimeError("Built plugin configuration differs from its source: " +
                           str(example_config))
    env = os.environ.copy()
    runtime_var = ("PATH" if os.name == "nt" else
                   "DYLD_LIBRARY_PATH" if sys.platform == "darwin" else
                   "LD_LIBRARY_PATH")
    runtime_dirs = [str(plugin_dir),
                    args.runtime_dir or str(tools_dir / "bin"),
                    args.library_dir or str(tools_dir / "lib"),
                    env.get(runtime_var, "")]
    env[runtime_var] = os.pathsep.join(path for path in runtime_dirs if path)

    with tempfile.TemporaryDirectory(prefix="eld-reassign-") as temp:
        work = Path(temp)
        obj = work / "data.o"
        output = work / "image.out"
        dump = Path(str(output) + ".reassign.csv")
        source = inputs / "data.c"
        linker_script = inputs / "script.t"

        compile_command = [args.target_cc or args.target_cxx]
        if args.target_triple:
            compile_command.append("--target=" + args.target_triple)
        compile_command += args.target_cxx_args + args.target_cxx_arg
        compile_command += ["-c", str(source), "-o", str(obj), "-fdata-sections"]
        run(compile_command, env, work)

        # Load the exact example shipped beside the plugin, including comments.
        example_script = work / "example.t"
        example_script.write_text(linker_script.read_text().replace(
            ".reassign_a (DSECT)", ".dedup (DSECT)"))
        example_output = work / "example.out"
        run([args.target_ld, *args.target_ld_args, *args.target_ld_arg,
             str(obj), "-T", str(example_script), "-e", "main",
             "-o", str(example_output), "--plugin-config", str(example_config)],
            env, work)
        example_mapping = json.loads(
            Path(str(example_output) + ".reassign.json").read_text())
        expected_entries = [
            {"address": int.from_bytes(hashlib.md5(value.encode() + b"\0").digest()[:4],
                                       "little"), "string": value}
            for value in ("same", "other")]
        if example_mapping["sections"] != [
                {"section": ".dedup", "entries": expected_entries}]:
            raise RuntimeError("Example configuration mapping mismatch:\n" +
                               repr(example_mapping))
        if not Path(str(example_output) + ".reassign.csv").is_file():
            raise RuntimeError("Example configuration CSV mapping missing")

        config = ("GlobalPlugins:\n"
                  "  - Type: OutputSectionIterator\n"
                  "    Name: ReassignSectionAddresses\n"
                  "    Library: ReassignSectionAddresses\n"
                  "    Options: section=.reassign_a:hash=seq:"
                  "seq_start=0x100:output_format=csv:debug=yes\n")
        config_path = work / "plugins.yaml"
        config_path.write_text(config)
        link_command = [args.target_ld]
        link_command += args.target_ld_args + args.target_ld_arg
        link_command += [str(obj), "-T", str(linker_script), "-e", "main",
                         "-o", str(output), "--plugin-config", str(config_path),
                         "--trace=plugin"]
        log = run(link_command, env, work)

        with dump.open(newline="") as stream:
            dump_rows = list(csv.reader(stream))
        if dump_rows != [["section", "address", "string"],
                         [".reassign_a", "0x00000100", "same"],
                         [".reassign_a", "0x00000101", "other"]]:
            raise RuntimeError("ReassignSectionAddresses dump lacked expected symbol:\n" +
                               repr(dump_rows))
        debug_path = Path(str(output) + ".reassign.debug.json")
        debug = json.loads(debug_path.read_text())
        if (debug["schema_version"] != 3 or len(debug["sections"]) != 1 or
                debug["sections"][0]["section"] != ".reassign_a" or
                len(debug["sections"][0]["symbols"]) != 3):
            raise RuntimeError("ReassignSectionAddresses debug symbols missing:\n" +
                               repr(debug))
        if "ReassignSectionAddresses" not in log:
            raise RuntimeError("ReassignSectionAddresses trace was not observed:\n" + log)

        # Exercise both mapping formats against the same compiled input.
        config_path.write_text(config.replace("output_format=csv", "output_format=json"))
        run(link_command, env, work)
        mapping_path = Path(str(output) + ".reassign.json")
        mapping = json.loads(mapping_path.read_text())
        expected = {"schema_version": 1, "plugin": "ReassignSectionAddresses",
                    "output_file": str(output), "sections": [
                        {"section": ".reassign_a", "entries": [
                            {"address": 256, "string": "same"},
                            {"address": 257, "string": "other"}]}]}
        if mapping != expected:
            raise RuntimeError("ReassignSectionAddresses JSON mapping mismatch:\n" +
                               repr(mapping))

        # Both formats with a custom suffix; gzip also applies to debug JSON.
        config_path.write_text(config.replace("output_format=csv",
                                              "output_format=csv,json:gzip=yes:"
                                              "output_suffix=custom-map"))
        run(link_command, env, work)
        for path in (dump, mapping_path, debug_path):
            custom = Path(str(path).replace(".reassign.", ".custom-map."))
            if custom.exists():
                raise RuntimeError("Unexpected uncompressed output: " + str(custom))
            compressed = gzip.decompress(Path(str(custom) + ".gz").read_bytes())
            if compressed != path.read_bytes():
                raise RuntimeError("Compressed output mismatch: " + str(path))


if __name__ == "__main__":
    main()

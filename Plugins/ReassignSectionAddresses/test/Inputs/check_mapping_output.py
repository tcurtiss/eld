#!/usr/bin/env python3
"""Check CSV/JSON mapping equivalence, section grouping and deduplication."""

import argparse
import gzip
import json
from pathlib import Path

from mapping_csv import check_mapping_csv


parser = argparse.ArgumentParser()
parser.add_argument("image")
parser.add_argument("--format", choices=("csv", "json"), required=True)
parser.add_argument("--suffix", default="reassign")
parser.add_argument("--sections", nargs="+", required=True)
parser.add_argument("--start", type=lambda value: int(value, 0), default=0x100)
parser.add_argument("--clean", action="store_true")
parser.add_argument("--gzip", action="store_true")
args = parser.parse_args()

contents = {
    ".reassign_a": ["same", "other", "same"],
    ".reassign_b": ["same", "third"],
    ".reassign_clean": ["A\t\tB\nC\rD\x01\x80"],
    ".reassign_csv": ['comma, "quote"\r\nnext'],
    ".reassign/a": ["same", "other", "same"],
    "reassign_a": ["same", "third"],
    ".reassign_bytes": [bytes(range(256)).decode("latin1")],
    ".reassign_empty": ["", ""],
    ".reassign_trim": [" \t \r\n", "\t  leading\t\tmiddle\t tail \t\r\n",
                       "text \t\x01\x80", "inside\r\nnewlines", "", "plain"],
}


def clean(value):
    return "".join(char for char in value
                   if char == "\t" or " " <= char <= "~").rstrip(" \t")


assigned = {}
expected = []
for section in args.sections:
    entries = []
    seen = set()
    for value in contents.get(section, []):
        address = assigned.setdefault(value, args.start + len(assigned))
        if address in seen:
            continue
        seen.add(address)
        entries.append({"address": address,
                        "string": clean(value) if args.clean else value})
    if entries:
        expected.append({"section": section, "entries": entries})

path = Path(args.image + "." + args.suffix + "." + args.format)
if args.gzip:
    assert not path.exists(), path
    path = Path(str(path) + ".gz")
    payload = gzip.decompress(path.read_bytes())
else:
    payload = path.read_bytes()

if args.format == "json":
    # Strict UTF-8 parsing must also accept arbitrary symbol bytes represented
    # as U+00xx escapes. The decoded strings match the CSV's Latin-1 view.
    document = json.loads(payload.decode("utf-8"))
    assert all(type(entry["address"]) is int
               for section in document["sections"]
               for entry in section["entries"]), document
    assert document == {"schema_version": 1, "plugin": "ReassignSectionAddresses",
                        "output_file": args.image, "sections": expected}, document
else:
    expected_rows = [["section", "address", "string"]]
    for section in expected:
        expected_rows.extend([[section["section"], "0x{:08X}".format(entry["address"]),
                               entry["string"]]
                              for entry in section["entries"]])
    check_mapping_csv(payload, expected_rows)

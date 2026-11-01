#!/usr/bin/env python3
"""Validate combined debug sections, including unreferenced duplicates."""

import argparse
import gzip
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("image")
parser.add_argument("sections", nargs="+")
parser.add_argument("--gzip", action="store_true")
parser.add_argument("--suffix", default="reassign")
args = parser.parse_args()

path = Path(args.image + "." + args.suffix + ".debug.json")
if args.gzip:
    assert not path.exists(), path
    path = Path(str(path) + ".gz")
    document = json.loads(gzip.decompress(path.read_bytes()))
else:
    document = json.loads(path.read_text())


def check(image, section):
    expected = {
        "reassign_a": [("same_a", 0, 0x100, b"same\0"),
                       ("other_a", 5, 0x101, b"other\0"),
                       ("same_a_duplicate", 11, 0x100, b"same\0")],
        "reassign_b": [("same_b", 0, 0x100, b"same\0"),
                       ("third_b", 5, 0x102, b"third\0")],
        "reassign_clean": [("messy_string", 0, 0x100,
                            b"A\t\tB\nC\rD\x01\x80\0")],
        "reassign_csv": [("csv_string", 0, 0x100,
                          b'comma, "quote"\r\nnext\0')],
        "reassign_trim": [],
    }[section]
    if section == "reassign_trim":
        offset = 0
        for index, (name, raw) in enumerate([
                ("trim_whitespace", b" \t \r\n\0"),
                ("trim_tabs", b"\t  leading\t\tmiddle\t tail \t\r\n\0"),
                ("trim_filtered", b"text \t\x01\x80\0"),
                ("trim_newlines", b"inside\r\nnewlines\0"),
                ("trim_empty", b"\0"), ("trim_plain", b"plain\0")]):
            expected.append((name, offset, 0x100 + index, raw))
            offset += len(raw)
    assert document["schema_version"] == 3, document
    assert document["plugin"] == "ReassignSectionAddresses", document
    assert document["output_file"] == image, document
    group = next(s for s in document["sections"] if s["section"] == "." + section)
    records = group["symbols"]
    assert len(records) == len(expected), records
    for record, (name, original, assigned, raw) in zip(records, expected):
        assert record["symbol"] == name, record
        assert record["original_address"] == original, record
        assert record["assigned_address"] == assigned, record
        assert bytes.fromhex(record["raw_bytes"]) == raw, record
        assert record["input_file"].endswith(".o"), record
        assert record["input_section"] == "." + section, record
        assert record["relocations"] == [], record


for section in args.sections:
    check(args.image, section)

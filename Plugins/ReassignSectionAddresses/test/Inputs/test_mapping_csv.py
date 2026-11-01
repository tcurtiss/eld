"""Regression checks for binary-safe mapping CSV validation."""

import unittest

from mapping_csv import check_mapping_csv


class MappingCSVTest(unittest.TestCase):
    def test_binary(self):
        value = bytes(range(256))
        payload = (b'section,address,string\r\n".strings",0xFFFFFFFF,"' +
                   value.replace(b'"', b'""') + b'"\r\n')
        rows = [["section", "address", "string"],
                [".strings", "0xFFFFFFFF", value.decode("latin1")]]
        check_mapping_csv(payload, rows)
        # Removing or altering NUL is not a valid compatibility workaround.
        for changed in (payload.replace(b"\0", b""),
                        payload.replace(b"\0", b"?"),
                        payload.replace(b'""', b'"'),
                        payload[:-2] + b"\n"):
            with self.assertRaises(AssertionError):
                check_mapping_csv(changed, rows)

    def test_empty_and_quoted_fields(self):
        check_mapping_csv(
            b'section,address,string\r\n".a,""b",0x00000000,""\r\n'
            b'".c",0x00000001,"x,\r\ny""z"\r\n',
            [["section", "address", "string"],
             ['.a,"b', "0x00000000", ""],
             [".c", "0x00000001", 'x,\r\ny"z']])

    def test_header_only(self):
        check_mapping_csv(b"section,address,string\r\n",
                          [["section", "address", "string"]])


if __name__ == "__main__":
    unittest.main()

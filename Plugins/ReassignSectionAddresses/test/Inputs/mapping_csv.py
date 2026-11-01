"""Check mapping CSV bytes without older Python CSV readers rejecting NULs."""


def check_mapping_csv(payload, rows):
    assert rows[0] == ["section", "address", "string"], rows[0]

    def quoted(value):
        # Latin-1 preserves every symbol byte. Only CSV quotes are escaped;
        # NUL, CR/LF and non-ASCII bytes must remain unchanged inside fields.
        return b'"' + value.encode("latin1").replace(b'"', b'""') + b'"'

    expected = b"section,address,string\r\n" + b"".join(
        quoted(section) + b"," + address.encode("ascii") + b"," +
        quoted(value) + b"\r\n" for section, address, value in rows[1:])
    assert payload == expected, "mapping CSV bytes differ from expected records"

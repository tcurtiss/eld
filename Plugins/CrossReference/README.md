# CrossReference Linker Plugin

CrossReference builds a reference graph while ELD is linking and writes it to
an output file. Unlike the linker's traditional `--cref` table, which records
referencing input files, this plugin attempts to identify the symbol containing
each individual reference.

The plugin runs from `ActBeforeWritingOutput`, after garbage collection and
linker-generated stubs/trampolines have been created. It reads ELF input files;
bitcode/LTO inputs are not inspected.

## Configuration

The plugin is configured through a colon-delimited `key=value` option string.
The `file` option is required.

```yaml
GlobalPlugins:
  - Type: LinkerPlugin
    Name: CrossReference
    Library: CrossReference
    Options: file=xref.txt:format=text:cpp_demangle=yes
```

The supported options are:

| Option | Default | Description |
| --- | --- | --- |
| `file=<path>` | required | Output file. Existing contents are replaced. |
| `format=text\|json\|json_columnar` | `text` | Selects the output format. |
| `source_root=<path>` | unset | Removes this complete path prefix from object-file paths, DWARF paths, and dashboard paths. |
| `strip_prefix=<glob>` | unset | Removes the longest complete path prefix matching an LLVM glob. Mutually exclusive with `source_root`. |
| `show_gc=yes\|no` | `no` | Includes garbage-collected symbols and edges in text output. |
| `cpp_demangle=yes\|no` | `no` | Demangles C++ names in output and name-pattern matching. |
| `usedwarf=yes\|no` | `no` | Looks up function and variable declaration locations in DWARF. |
| `exclude_symbols=<globs>` | unset | Comma-delimited name patterns. Matching symbols and their edges are omitted. |
| `exclude_files=<globs>` | unset | Comma-delimited patterns matched against resolved object-file paths. |
| `include_symbols=<globs>` | unset | If present, only symbols matching at least one pattern are retained. |
| `exclude_local=yes\|no` | `yes` | Omits local symbols, including static functions/data and generated labels. |
| `exclude_functions=yes\|no` | `no` | Omits `STT_FUNC` symbols and their edges. |
| `exclude_data=yes\|no` | `no` | Omits `STT_OBJECT` symbols and their edges. |
| `min_size=<bytes>` | `0` | Omits symbols smaller than this size and their edges. |
| `min_refs=<n>` | `0` | Omits symbols with fewer than this many incoming references and their edges. |
| `exclude_intra_file=yes\|no` | `no` | Omits edges whose caller and target have the same resolved input-file path. |

`yes`/`no` values are case-sensitive. Unknown options, duplicate `file`
options, malformed numbers or globs, missing `file`, and simultaneous
`source_root`/`strip_prefix` options are errors.

### Path cleanup

`source_root` removes only a complete path component. For example,
`source_root=/build` removes `/build/` from `/build/project/a.o`, but does not
alter `/builder/project/a.o`. `source_root=/` removes a leading slash.

`strip_prefix` treats the value as an LLVM glob and tries path-component
prefixes, retaining the longest matching prefix. For example,
`strip_prefix=*/build/*` can remove a variable build-root prefix. The cleanup
is applied consistently to object paths, DWARF source paths, dashboard paths,
file-filter matching, and intra-file comparisons.

### Filtering

Name patterns match the demangled name when `cpp_demangle=yes`, otherwise the
raw symbol-table name. A symbol is retained only if it passes all applicable
filters: it must satisfy `include_symbols` when specified, match no exclusion
pattern, not be excluded by its file, binding, type, size, or reference count.
Filtered symbols are also removed from text edges.

`min_refs` counts individual recorded relocations targeting a symbol, not the
number of distinct callers. The count is computed from the complete graph
before the other text filters are applied.

`exclude_intra_file` affects only text edges; both symbols remain in the symbol
catalog. An unattributed edge has no caller and is not considered intra-file.

The dashboard JSON formats are section-oriented and intentionally do not apply
the symbol filters, `show_gc`, or `exclude_intra_file`. They contain the
section graph independently of the text dump filters. `cpp_demangle` and path
cleanup still affect dashboard names and paths.

## Reference graph construction

For every usable relocation/`Use`, the plugin identifies the source chunk and
the target symbol. The source reference is attributed as follows:

1. If the relocation offset is within a symbol's
   `[symbol_offset, symbol_offset + symbol_size)` range, the attribution is
   exact.
2. Otherwise, the nearest preceding symbol in the same chunk is selected and
   marked approximate. This handles symbols with missing or unreliable size
   information, such as hand-written assembly without `.size` directives.
3. If no preceding symbol exists, the reference is unattributed.

Every relocation contributes one reference. Repeated references between the
same endpoints are aggregated and reported with a count.

References through linker-generated branch-island/stub symbols are rewritten to
the real target and receive the `trampoline` flag. The synthetic stub itself is
not reported as an intermediate edge.

The plugin does not require `-ffunction-sections` or `-fdata-sections` for the
symbol-level text graph. Those options are useful when the dashboard's
input-section nodes should correspond closely to individual function and data
symbols.

Garbage-collected sections are still scanned so the pre-GC connectivity graph
can be recovered. In text output, they are omitted by default. With
`show_gc=yes`, they are included and their address is printed as `?` because
they never received a final address. Dashboard JSON always retains dead input
sections and marks them as not live.

## Text output schema

The text format is tab-delimited and contains a symbol catalog followed by an
edge table. The header comments are also a legend:

```text
# Symbols: <id>\t<name>\t<file>\t0x<size>\t<address>\t<output-section>
#   '?' address means garbage-collected; section is the linked output section.
#   with usedwarf=yes, source appears after the name as (file:line).
<id>\t<name>\t<object-file>\t0x<size>\t<address>\t<output-section>

# Edges: <src-id>\t<dst-id>\t<count>\t<flags>
#   '-' source means unattributed; '-' flags means none; flags: approx, unattributed, trampoline.
<src-id>\t<dst-id>\t<count>\t<flags>
```

Symbol IDs are local to the dump. The symbol name may be followed by
`(source-file:line)` when DWARF lookup succeeds. A `-` source ID denotes an
unattributed reference. Multiple flags are comma-delimited; flags are combined
when references aggregate into the same edge.

Example:

```text
# Symbols: <id>\t<name>\t<file>\t0x<size>\t<address>\t<output-section>
#   '?' address means garbage-collected; section is the linked output section.
#   with usedwarf=yes, source appears after the name as (file:line).
0\tmain\tapp.o\t0x20\t0x1000\t.text
1\tfoo\tlib.o\t0x10\t0x1020\t.text
# Edges: <src-id>\t<dst-id>\t<count>\t<flags>
#   '-' source means unattributed; '-' flags means none; flags: approx, unattributed, trampoline.
0\t1\t2\t-
```

## Dashboard object JSON (`format=json`)

This format contains one node for each allocatable, non-discarded ELF input
section. If a section has a suitable function or object symbol, that symbol is
used as the node name; otherwise the input section name is used.

```json
{
  "nodes": [
    {
      "id": 0,
      "name": "main",
      "path": "app.o",
      "kind": "code",
      "size": 32,
      "out": ".text"
    },
    {
      "id": 1,
      "name": "constants",
      "path": "data.o",
      "kind": "rodata",
      "size": 16,
      "live": false
    }
  ],
  "edges": [
    {"src": 0, "dst": 1, "count": 2}
  ]
}
```

Node fields:

- `id`: numeric node ID.
- `name`: primary symbol name or input-section name.
- `path`: cleaned input object-file path.
- `kind`: one of `code`, `rodata`, `data`, or `bss`.
- `size`: input-section size in bytes.
- `out`: linked output-section name, when available.
- `live`: present as `false` for garbage-collected sections; omitted for live sections.
- `root`: present as `true` for live sections retained by a linker-script `KEEP` rule.

Each JSON edge contains `src`, `dst`, and `count`. It represents aggregated
references between two different input sections. Section-level edges include
dead sections and are independent of text symbol filtering.

## Dashboard columnar JSON (`format=json_columnar`)

The columnar format has this top-level shape:

```json
{
  "format": "fia-columnar",
  "version": 1,
  "strings": {
    "dirs": [[-1, "build"], [0, "src"]],
    "files": [[1, "app.o"]],
    "outs": [".text"]
  },
  "sections": {
    "count": 1,
    "size": [32],
    "file": [0],
    "out": [0],
    "kind": [0],
    "flags": [0],
    "name": ["main"]
  },
  "refs": {
    "offsets": [0, 0],
    "targets": [],
    "counts": []
  }
}
```

`strings.dirs` contains `[parent_directory_id, name]` entries, with `-1`
meaning no parent. `strings.files` contains `[directory_id, basename]` entries.
`strings.outs` is the output-section string table.

The arrays in `sections` are parallel and indexed by section ID:

- `count`: number of sections.
- `size`: section sizes in bytes.
- `file`: IDs into `strings.files`.
- `out`: IDs into `strings.outs`; `-1` means no output-section name.
- `kind`: numeric kind, `0=code`, `1=rodata`, `2=data`, `3=bss`.
- `flags`: bit mask: bit `0x1` means dead/not live; bit `0x2` means linker-script root.
- `name`: node names.

The `refs` arrays use compressed sparse-row adjacency. For source section `i`,
the entries from `offsets[i]` through `offsets[i+1]` refer to target IDs in
`targets` and matching reference counts in `counts`. `offsets` therefore has
`sections.count + 1` entries.

## DWARF source locations

With `usedwarf=yes`, the plugin indexes both `DW_TAG_subprogram` and
`DW_TAG_variable` DIEs. In the current implementation, source locations are
printed in text symbols as `(file:line)`; the dashboard JSON formats do not
emit source-location fields.

DWARF is read directly from each input file's unrelocated bytes. Debug strings
stored through relocated forms such as `DW_FORM_strp` or `DW_FORM_strx` may not
resolve correctly because non-allocatable debug-section relocations are not
applied by the plugin API. Using inline debug strings, for example
`-gdwarf-2 -mllvm -dwarf-inlined-strings=Enable`, avoids that limitation.

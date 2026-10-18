import gzip
import json
import pathlib
import sys


def load(path):
    opener = gzip.open if str(path).endswith('.gz') else open
    with opener(path, 'rt') as f:
        d = json.load(f)
    if 'symbolDetails' not in d:
        return d, None
    details = d['symbolDetails']
    assert details['version'] == 1
    syms = details['symbols']
    if isinstance(syms, dict):
        syms = [dict(id=i, **{k: v[i] for k, v in syms.items() if k != 'count'})
                for i in range(syms['count'])]
    for s in syms:
        s.setdefault('sourceFile', -1)
        s.setdefault('sourceLine', 0)
    refs = details['refs']
    if isinstance(refs, dict):
        refs = [{k: v[i] for k, v in refs.items()} for i in range(len(refs['src']))]
    return d, dict(symbols=syms, refs=refs, sourceFiles=details.get('sourceFiles', []))


mode, base = sys.argv[1], pathlib.Path(sys.argv[2])
if mode == 'configs':
    base.mkdir(exist_ok=True)
    modes = {'plain': 'format=json', 'detail': 'format=json:symbol_details=yes',
             'nodwarf': 'format=json:symbol_details=yes:use_dwarf=no',
             'dwarf': 'format=json:use_dwarf=yes:source_root=/',
             'columnar': 'format=json_columnar:use_dwarf=yes:source_root=/',
             'gzip': 'format=json_columnar:use_dwarf=yes:source_root=/:gzip=yes',
             'strip': 'format=json:use_dwarf=yes:strip_prefix=*/CrossReferenceDetails/',
             'demangled': 'format=json_columnar:use_dwarf=yes:source_root=/:cpp_demangle=yes',
             'filtered': 'format=json:symbol_details=yes:exclude_local=yes:exclude_data=yes:min_refs=99999',
             'invalid': 'format=json:symbol_details=maybe',
             'invalid_dwarf': 'format=json:use_dwarf=maybe',
             'old_dwarf': 'format=json:usedwarf=yes'}
    for name, opts in modes.items():
        text = ('GlobalPlugins:\n  - Type: LinkerPlugin\n    Name: CrossReference\n'
                '    Library: CrossReference\n    Options: ')
        options = 'file=' + str(base / (name + '.json')) + ':' + opts
        (base / (name + '.yaml')).write_text(text + json.dumps(options) + '\n')
elif mode == 'check':
    plain, no = load(base / 'plain.json')
    detail, rich = load(base / 'detail.json')
    assert no is None
    assert plain['nodes'] == detail['nodes'] and plain['edges'] == detail['edges']
    assert rich == load(base / 'nodwarf.json')[1] == load(base / 'filtered.json')[1]
    dwarf = load(base / 'dwarf.json')[1]
    assert dwarf == load(base / 'columnar.json')[1] == load(base / 'gzip.json.gz')[1]
    assert dwarf == load(base / 'serial.json')[1]
    demangled = load(base / 'demangled.json')[1]
    assert any(s['name'] == 'demo::overload(int)' for s in demangled['symbols'])
    for actual, expected in zip(demangled['symbols'], dwarf['symbols']):
        actual['name'] = expected['name']
    assert demangled == dwarf
    stripped, stripped_details = load(base / 'strip.json')
    assert stripped_details['sourceFiles'] == ['Inputs/a.cpp', 'Inputs/b.c']
    assert stripped_details['symbols'] == dwarf['symbols']
    assert stripped_details['refs'] == dwarf['refs']
    assert all(n['path'].startswith('Output/') for n in stripped['nodes'])
    names = {s['linkageName']: s for s in dwarf['symbols']}
    assert names['entry']['section'] == names['alias_entry']['section']
    assert names['entry']['offset'] == names['alias_entry']['offset']
    assert names['weak_data']['flags'] & 2
    assert names['weak_function']['flags'] & 2
    local = [s for s in dwarf['symbols'] if 'local' in s['name']]
    assert len(local) >= 2 and all(s['flags'] & 1 for s in local)
    for name, line in [('entry', 10), ('_ZN4demo8overloadEi', 4),
                       ('_ZN4demo8overloadEj', 5), ('_ZN4demo4dataE', 3),
                       ('_ZN4demo8callbackE', 7), ('remote', 2), ('external_data', 1), ('data', 14)]:
        sym = names[name]
        assert sym['sourceLine'] == line, (name, sym)
        source = dwarf['sourceFiles'][sym['sourceFile']]
        assert source.endswith('a.cpp' if name.startswith('_Z') or name in ('entry', 'data') else 'b.c')
        assert not source.startswith('/')
    assert all(s['sourceFile'] == -1 for s in rich['symbols'])
    assert any(e['sourceSection'] == e['targetSection'] for e in rich['refs'])
    for e in rich['refs']:
        assert e['count'] > 0 and 0 <= e['flags'] < 8
        for key, section in [('src', 'sourceSection'), ('dst', 'targetSection')]:
            if e[key] != -1:
                assert rich['symbols'][e[key]]['section'] == e[section]
    print('details: section invariance, symbol identity, sources, aliases, flags, formats and threads OK')
elif mode == 'missing':
    details = load(base / 'dwarf.json')[1]
    assert details['symbols'] and not details['sourceFiles']
    assert all(s['sourceFile'] == -1 for s in details['symbols'])
elif mode == 'approx':
    details = load(base / 'detail.json')[1]
    assert any(e['flags'] & 1 for e in details['refs'])
    assert any(e['flags'] & 2 and e['src'] == -1 for e in details['refs'])
elif mode == 'compare':
    assert load(base)[1] == load(pathlib.Path(sys.argv[3]))[1]
elif mode == 'gc':
    data, details = load(base / 'dwarf.json')
    unused = next(s for s in details['symbols'] if s['linkageName'] == '_Z6unusedv')
    assert unused['sourceLine'] == 12
    assert data['nodes'][unused['section']]['live'] is False
    assert any(e['src'] == unused['id'] for e in details['refs'])

import concurrent.futures
import gzip
import json
from pathlib import Path
import subprocess
import sys
import zlib


TITLE = 'Streaming "quotes" \\ paths \b\f\n\r\t\x01\x1f UTF-8 ⟫'
mode, base = sys.argv[1], Path(sys.argv[2])
command = sys.argv[3:]


def run(args, succeeds=True):
    result = subprocess.run(args, capture_output=True, text=True)
    assert (result.returncode == 0) == succeeds, result.stdout + result.stderr
    return result.stdout + result.stderr


if mode == 'generate':
    base.mkdir(exist_ok=True)
    # Each exported name occurs in section and symbol columns. This produces
    # more than four 4 MiB gzip blocks without a large target image.
    names = ['large_%d_' % i + 'x' * 8192 for i in range(768)]
    (base / 'large.c').write_text('\n'.join(
        'int %s = %d;' % (name, i) for i, name in enumerate(names)))
    for i in range(32):
        (base / ('unit%02d.c' % i)).write_text(
            'extern int unit%d(void);\nint unit%d(void) { return unit%d() + %d; }\n'
            % ((i + 1) % 32, i, (i + 1) % 32, i))
    for fmt in ('json', 'json_columnar', 'text'):
        for compressed in (False, True):
            options = ('format=%s:output_suffix=stream:cpp_demangle=no:'
                       'symbol_details=dwarf:gzip=%s:source_root=%s:title=%s'
                       % (fmt, 'yes' if compressed else 'no', base.resolve(), TITLE))
            (base / ('%s-%s.yaml' % (fmt, compressed))).write_text(
                'GlobalPlugins:\n  - Type: LinkerPlugin\n    Name: CrossReference\n'
                '    Library: CrossReference\n    Options: ' + json.dumps(options) + '\n')
elif mode == 'compile':
    def compile(source):
        run(command + ['-g', '-O0', '-ffunction-sections', '-fdata-sections',
                       '-c', str(source), '-o', str(source.with_suffix('.o'))])
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(compile, sorted(base.glob('*.c'))))
elif mode == 'check':
    image = base / 'out'
    plain = Path(str(image) + '.stream.json')
    compressed = Path(str(plain) + '.gz')
    objects = [str(p) for p in sorted(base.glob('*.o'))]

    def link(fmt, zipped, threads, succeeds=True):
        flags = ['--no-threads'] if threads == 1 else [
            '--threads', '--thread-count=%d' % threads]
        if fmt == 'json_columnar' and not zipped and threads == 1:
            flags += ['--time-region=all-user-plugins',
                      '--emit-timing-stats=' + str(base / 'timing.txt')]
        return run(command + flags + objects + ['-e', 'unit0', '-o', str(image),
                   '--plugin-config', str(base / ('%s-%s.yaml' % (fmt, zipped)))],
                   succeeds)

    for fmt in ('json_columnar', 'json', 'text'):
        link(fmt, False, 1)
        # Text-mode files may translate the final newline on Windows.
        expected = plain.read_bytes().replace(b'\r\n', b'\n')
        if fmt != 'text':
            assert json.loads(expected)['title'] == TITLE
        if fmt == 'json_columnar':
            assert len(expected) > 4 * 4 * 1024 * 1024
            timing = (base / 'timing.txt').read_text()
            for phase in ('buildDashboardSymbols', 'walkReferences',
                          'buildDWARFIndex', 'writeDump'):
                assert phase in timing, 'Missing timing phase ' + phase
        link(fmt, False, 4)
        assert plain.read_bytes().replace(b'\r\n', b'\n') == expected
        serial_gzip = None
        for threads in (1, 2, 4):
            link(fmt, True, threads)
            payload = compressed.read_bytes()
            reader = zlib.decompressobj(31)
            assert reader.decompress(payload) + reader.flush() == expected
            assert reader.eof and not reader.unused_data, 'Must be ONE gzip member'
            assert gzip.decompress(payload) == expected
            if serial_gzip is None:
                serial_gzip = payload
            else:
                assert payload == serial_gzip, 'gzip bytes depend on scheduling'

    # Opening the compressed destination is checked before serialization.
    compressed.unlink()
    compressed.mkdir()
    assert 'could not open dump file' in link('json_columnar', True, 4, False)
    compressed.rmdir()
    if Path('/dev/full').exists():
        # Buffered writes and compressor workers must propagate late failures.
        compressed.symlink_to('/dev/full')
        assert 'could not write dump file' in link('json_columnar', True, 4, False)
        compressed.unlink()
        plain.unlink()
        plain.symlink_to('/dev/full')
        assert 'could not write dump file' in link('json_columnar', False, 4, False)
        plain.unlink()
    print('streaming: multiple blocks, one gzip member, deterministic JSON/gzip, '
          'DWARF windows, escaping and write failures OK')

"""Preserve bounded browser reports and cgroup evidence without masking test failures."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sys
import zipfile

MAX_BYTES = 60 * 1024 * 1024


def memory_snapshot():
    root = Path('/sys/fs/cgroup')
    names = ('memory.max', 'memory.current', 'memory.peak', 'memory.events', 'memory.swap.max')
    result = {}
    for name in names:
        try:
            if (root / name).is_file():
                result[name] = (root / name).read_text().strip()
        except OSError as error:
            result[name] = {'unavailable': type(error).__name__}
    return result


@contextmanager
def reports():
    destination = os.environ.get('DELIVERY_DIAGNOSTICS_DIR')
    before = memory_snapshot() if destination else {}
    try:
        yield
    finally:
        if destination:
            try:
                publish(Path(destination), before)
            except (OSError, ValueError, zipfile.BadZipFile) as error:
                print('Could not retain diagnostic reports: ' + str(error), file=sys.stderr)


def publish(destination, before):
    root = Path.cwd().resolve()
    included, omitted = [], []
    remaining = MAX_BYTES
    temporary = destination / 'report.partial'
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
            archive.writestr('resource-usage.json', json.dumps({'before': before, 'after': memory_snapshot()}))
            for directory in ('playwright-report', 'test-results'):
                for path in sorted(Path(directory).rglob('*')):
                    if path.is_symlink() or not path.is_file():
                        continue
                    if not path.resolve().is_relative_to(root):
                        raise ValueError('Report path escaped the checkout')
                    name, size = path.as_posix(), path.stat().st_size
                    if size > remaining or len(included) >= 2000:
                        omitted.append(name)
                        continue
                    archive.write(path, name)
                    included.append(name)
                    remaining -= size
            archive.writestr('collection.json', json.dumps({'included': included, 'omitted_due_to_limit': omitted}))
        temporary.replace(destination / 'report.zip')
    finally:
        temporary.unlink(missing_ok=True)

"""Actions도 Jenkins 도구 이미지의 원본과 검사 진입점을 사용한다."""
from pathlib import Path
import json
import shutil
import subprocess
import sys


def memory_snapshot():
    root = Path('/sys/fs/cgroup')
    names = ('memory.max', 'memory.current', 'memory.peak', 'memory.events', 'memory.swap.max')
    return {name: (root / name).read_text().strip() for name in names if (root / name).is_file()}


def main():
    source = Path('source')
    shutil.copytree('/tools/source', source,
                    ignore=shutil.ignore_patterns('node_modules'))
    before = memory_snapshot()
    try:
        subprocess.run([sys.executable, 'ci/check.py', 'linux'], cwd=source, check=True)
    finally:
        Path('/reports/resource-usage.json').write_text(
            json.dumps({'before': before, 'after': memory_snapshot()}, indent=2) + '\n')
        for name in ('playwright-report', 'test-results'):
            if (source / name).is_dir():
                shutil.copytree(source / name, Path('/reports') / name)


if __name__ == '__main__':
    main()

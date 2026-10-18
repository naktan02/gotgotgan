"""Actions도 Jenkins 도구 이미지의 원본과 검사 진입점을 사용한다."""
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    source = Path('source')
    shutil.copytree('/tools/source', source,
                    ignore=shutil.ignore_patterns('node_modules'))
    try:
        subprocess.run([sys.executable, 'ci/check.py', 'linux'], cwd=source, check=True)
    finally:
        for name in ('playwright-report', 'test-results'):
            if (source / name).is_dir():
                shutil.copytree(source / name, Path('/reports') / name)


if __name__ == '__main__':
    main()

"""고정 도구에서 기존 애플리케이션 검사와 Windows Connector 경계를 실행한다."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from diagnostics import reports


def run(*command, **kwargs):
    subprocess.run([str(value) for value in command], check=True, **kwargs)


def npm(*arguments):
    executable = ['node', Path(shutil.which('node')).parent / 'node_modules/npm/bin/npm-cli.js'] if os.name == 'nt' else ['npm']
    run(*executable, *arguments)


def input_digest():
    paths = [Path(name) for name in ('.node-version', '.npm-version', '.python-version', '.git-version',
             'package.json', 'package-lock.json', 'ci/Dockerfile', 'ci/debian-snapshot.sources')]
    for workspace in json.loads(Path('package.json').read_text())['workspaces']:
        paths.extend(Path('.').glob(workspace + '/package.json'))
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(path.as_posix().encode() + b'\0' + hashlib.sha256(path.read_text(encoding='utf-8').encode()).digest())
    for directory in ('vendor', '.tools'):
        for path in sorted(Path(directory).rglob('*.tgz')):
            digest.update(path.as_posix().encode() + b'\0' + hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def main():
    if sys.argv[1:] == ['--inputs']:
        print(input_digest())
        return
    expected = 'windows-connector' if os.name == 'nt' else 'linux'
    if sys.argv[1:] != [expected]:
        raise ValueError('Select the declared operating-system check')
    run(sys.executable, '-m', 'unittest', 'discover', '-s', 'ci', '-p', 'test_*.py', '-v')
    for name in tuple(os.environ):
        if name.lower() == 'npm_config_cache':
            del os.environ[name]
    os.environ.update(NPM_CONFIG_CACHE=str(Path(tempfile.gettempdir()) / 'gotgotgan-npm-cache'),
                      NPM_CONFIG_AUDIT='false', NPM_CONFIG_FUND='false', NEXT_TELEMETRY_DISABLED='1', CI='true')
    run('node', '--test', 'ci/database-resources.test.mjs')
    run('node', '--test', 'scripts/run-e2e.test.mjs')
    if os.name == 'nt':
        npm('ci', '--ignore-scripts')
        for check in ('check:docs', 'check:contracts', 'test:deployment', 'check:browser-auth', 'check:member-connector'):
            npm('run', check)
    else:
        if input_digest() != Path('/tools/input.sha256').read_text().strip():
            raise ValueError('Dependency/tool inputs changed; rebuild the CI image')
        shutil.copytree('/tools/npm-cache', os.environ['NPM_CONFIG_CACHE'])
        npm('ci', '--ignore-scripts', '--offline')
        # 설치가 끝나면 RAM에 복사한 패키지 아카이브는 더 이상 사용하지 않는다.
        shutil.rmtree(os.environ['NPM_CONFIG_CACHE'])
        os.environ.update(PLAYWRIGHT_BROWSERS_PATH='/tools/browsers', PLACE_WEB_E2E_BASE_URL='http://127.0.0.1:4177',
                          PLACE_E2E_DISPOSABLE_WORKSPACE='true')
        npm('run', 'check')


if __name__ == '__main__':
    with reports():
        main()

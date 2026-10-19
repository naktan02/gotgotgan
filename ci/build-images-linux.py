"""Linux의 전용 Docker 빌드 실행기에서 기존 Gotgotgan 이미지 검사를 실행한다."""
import json
import os
from pathlib import Path
import re
import stat
import subprocess


def run(*command):
    subprocess.run([str(value) for value in command], check=True)


def main():
    source = Path.cwd()
    output = Path(os.environ['DELIVERY_ARTIFACT_DIR'])
    owner = os.environ['DELIVERY_CONTAINER_NAME']
    tag = os.environ['DELIVERY_IMAGE_TAG']
    revision = os.environ['DELIVERY_SOURCE_COMMIT']
    home = Path(os.environ['HOME']).parent
    if (not output.is_absolute() or not output.is_dir() or any(output.iterdir())
            or not re.fullmatch(r'[a-f0-9]{40}', revision)
            or not re.fullmatch(r'delivery-check-[a-f0-9]{32}', owner)
            or tag != 'delivery-check/' + owner.removeprefix('delivery-check-') + ':build'
            or home == Path('/') or not home.is_absolute()):
        raise ValueError('Frozen source, isolated native home and owned resources are required')
    labels = ['--label', 'delivery.execution=check', '--label', 'delivery.owner=' + owner]
    endpoint = subprocess.check_output(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], text=True).strip()
    if not endpoint.startswith('unix:///'):
        raise ValueError('The builder requires its selected private Unix Docker socket')
    socket = Path(endpoint.removeprefix('unix://'))
    if not stat.S_ISSOCK(socket.stat().st_mode):
        raise ValueError('The selected Docker endpoint is not a local socket')
    tools = tag + '-tools'
    run('docker', 'build', '--platform', 'linux/amd64', *labels, '--tag', tools, '--file', 'ci/Dockerfile.builder', '.')
    properties = json.loads(subprocess.check_output(['docker', 'image', 'inspect', tools], text=True))[0]
    if properties['Config']['User'] != '1000:1000' or properties['Os'] != 'linux' or properties['Architecture'] != 'amd64':
        raise ValueError('Unexpected Gotgotgan builder image identity')
    arguments = ['docker', 'run', '--rm', '--init', '--name', owner + '-tools', *labels,
                 '--user', '1000:1000', '--group-add', str(socket.stat().st_gid),
                 '--network', 'host', '--read-only', '--cap-drop', 'ALL',
                 '--security-opt', 'no-new-privileges:true', '--memory', '2048m', '--cpus', '2', '--pids-limit', '512',
                 '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m,mode=1777',
                 '--mount', 'type=bind,source=' + str(socket) + ',target=/var/run/docker.sock']
    # Nested fixture binds must resolve to the same paths in the private Docker daemon.
    for path in (source, output, home):
        arguments += ['--mount', 'type=bind,source=' + str(path) + ',target=' + str(path)]
    for key in ('HOME', 'TEMP', 'TMP', 'DELIVERY_ARTIFACT_DIR', 'DELIVERY_CONTAINER_NAME', 'DELIVERY_IMAGE_TAG', 'DELIVERY_SOURCE_COMMIT'):
        arguments += ['--env', key + '=' + os.environ[key]]
    arguments += ['--env', 'TMPDIR=' + os.environ['TMP'], '--workdir', str(source),
                  '--entrypoint', 'python', properties['Id'], 'ci/build-images.py']
    run(*arguments)


if __name__ == '__main__':
    main()

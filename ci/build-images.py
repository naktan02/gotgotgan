"""Verify the three declared image targets and disposable DB recovery before export."""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import tarfile
import tempfile

import oci

from check import npm, run


def capture(*command):
    return subprocess.check_output([str(value) for value in command], text=True, encoding='utf-8').strip()


def main():
    output = Path(os.environ['DELIVERY_ARTIFACT_DIR'])
    owner = os.environ['DELIVERY_CONTAINER_NAME']
    tag = os.environ['DELIVERY_IMAGE_TAG']
    commit = os.environ['DELIVERY_SOURCE_COMMIT']
    if (not output.is_absolute() or not output.is_dir() or any(output.iterdir())
            or not re.fullmatch(r'[a-f0-9]{40}', commit)
            or not re.fullmatch(r'delivery-check-[a-f0-9]{32}', owner)
            or tag != 'delivery-check/' + owner.removeprefix('delivery-check-') + ':build'):
        raise ValueError('Frozen source and owned artifact/resource identities are required')
    labels = ['--label', 'delivery.execution=check', '--label', 'delivery.owner=' + owner]
    limits = ['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
              '--memory', '512m', '--cpus', '1', '--pids-limit', '128', '--network', 'none',
              '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m,mode=1777']
    declaration = json.loads(Path('deploy/release-source.v1.json').read_text())
    run('node', 'scripts/prepare-application-release.mjs', 'verify-source', '--repository-root', '.')
    expected = {'place-web': 'web-runtime', 'place-admin-web': 'admin-web-runtime', 'place-backend': 'backend-runtime'}
    if {item['artifact_id']: item['build']['target'] for item in declaration['artifacts']} != expected:
        raise ValueError('Review changed product image targets before exporting')
    images = {}
    with tempfile.TemporaryDirectory(prefix='place-evidence-', dir=Path(os.environ['TMPDIR'])) as temporary:
        evidence = Path(temporary)
        with oci.builder(owner, labels):
            for artifact in declaration['artifacts']:
                artifact_id = artifact['artifact_id']
                name = artifact_id.removeprefix('place-')
                build = artifact['build']
                if build['platforms'] != ['linux/amd64'] or build['context_path'] != '.' or build['dockerfile_path'] != 'Dockerfile':
                    raise ValueError('Review changed product image build inputs')
                image_tag = tag + '-' + name
                images[name] = oci.build(owner, labels, commit, artifact_id, build['target'],
                    output / ('gotgotgan-' + name + '-image.tar'), evidence / artifact_id, image_tag)
                properties = json.loads(capture('docker', 'image', 'inspect', image_tag))[0]
                if properties['Architecture'] != 'amd64' or properties['Os'] != 'linux' or properties['Config']['User'] != 'node':
                    raise ValueError('Runtime image identity differs: ' + name)
        with tarfile.open(output / 'gotgotgan-release-evidence.tar', 'w') as archive:
            archive.add(evidence, arcname='evidence')
    statuses = []
    for name, port, environment in [
        ('web', 3000, ['HOSTNAME=0.0.0.0', 'PORT=3000', 'PLACE_OIDC_RUNTIME_ENABLED=false', 'PLACE_MEMBERSHIP_RUNTIME_ENABLED=false']),
        ('admin-web', 3000, ['HOSTNAME=0.0.0.0', 'PORT=3000', 'PLACE_ADMIN_OIDC_RUNTIME_ENABLED=false']),
        ('backend', 8080, ['PLACE_HTTP_HOST=0.0.0.0', 'PLACE_HTTP_PORT=8080', 'PLACE_HTTP_RUNTIME_MODE=source-only']),
    ]:
        container = owner + '-' + name
        run('docker', 'create', '--name', container, *labels, *limits,
            *[value for setting in environment for value in ('--env', setting)], images[name])
        try:
            run('docker', 'start', container)
            for path, expected_status in [('/healthz', 200), ('/readyz', 503 if name == 'admin-web' else 200)]:
                script = f"fetch('http://127.0.0.1:{port}{path}',{{signal:AbortSignal.timeout(2000)}}).then(r=>{{if(r.status!=={expected_status})process.exit(1)}}).catch(()=>process.exit(1))"
                for attempt in range(40):
                    result = subprocess.run(['docker', 'exec', container, 'node', '-e', script], capture_output=True)
                    if result.returncode == 0:
                        break
                    time.sleep(0.25)
                else:
                    raise ValueError('Image did not return the declared source-only status: ' + name + path)
                statuses.append({'image': name, 'path': path, 'status': expected_status})
        finally:
            run('docker', 'rm', '--force', '--volumes', container)
    for entrypoint in ('worker/main.js', 'transfer-materialization-main.js'):
        run('docker', 'run', '--rm', '--name', owner + '-worker', *labels, *limits, images['backend'],
            'node', 'backend/dist/entrypoints/' + entrypoint, '--check')
    os.environ.update(NPM_CONFIG_AUDIT='false', NPM_CONFIG_FUND='false', NEXT_TELEMETRY_DISABLED='1', PLACE_DATABASE_TEST_HOST='127.0.0.1')
    npm('ci', '--ignore-scripts')
    npm('run', 'test:database')
    npm('run', 'test:database-recovery')
    (output / 'gotgotgan-image-verification.json').write_text(json.dumps({
        'source_commit': commit, 'images': images, 'statuses': statuses, 'runtime_mode': 'source-only',
        'oci_provenance_and_sbom': 'verified', 'worker_checks': 'passed', 'database_integration': 'passed', 'database_recovery': 'passed',
        'real_provider_calls': False, 'real_identity_login': False, 'registry_published': False,
        'operating_activation': False, 'independent_backup_storage': False,
    }, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()

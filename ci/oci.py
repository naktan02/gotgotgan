"""Preserve the Place release's attestations on the exact images tested by CI."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile


PINS = {
    'buildkit': 'moby/buildkit@sha256:cec9f139f45e93c5c69c60f8b07cfad9f43f4ef6b6a6cd917527fea5ff2e3dea',
    'skopeo': 'quay.io/skopeo/stable@sha256:7e735527d9d64c7456fc82d7f954c380b4a5dd1a8173115ce2ed7b3442ef36e0',
    'sbom': 'docker/buildkit-syft-scanner@sha256:ae4f3b554449e7e25548e7d8ccc029d17357348e30c6e3df01b92bc93654d6a9',
}
PREDICATES = {'https://slsa.dev/provenance/v1': 'SLSA', 'https://spdx.dev/Document': 'SPDX'}


def run(*arguments, **kwargs):
    return subprocess.run([str(value) for value in arguments], check=True, **kwargs)


def inspect(archive_path, commit, artifact, output):
    if not re.fullmatch('[a-f0-9]{40}', commit) or artifact not in ('place-web', 'place-admin-web', 'place-backend'):
        raise ValueError('Select a full Place source commit and owned artifact')
    with tarfile.open(archive_path) as archive:
        members = archive.getmembers()

        def read(name):
            selected = [item for item in members if item.name == name]
            if len(selected) != 1 or not selected[0].isfile() or selected[0].size > 16 * 1024 * 1024:
                raise ValueError('Evidence must be a unique bounded regular file')
            return archive.extractfile(selected[0]).read()

        def blob(descriptor):
            checksum = descriptor.get('digest', '')
            if not re.fullmatch('sha256:[a-f0-9]{64}', checksum) or descriptor.get('urls'):
                raise ValueError('Evidence must reference local SHA256 bytes')
            raw = read('blobs/sha256/' + checksum[7:])
            if len(raw) != descriptor.get('size') or 'sha256:' + hashlib.sha256(raw).hexdigest() != checksum:
                raise ValueError('Evidence blob differs from its descriptor')
            return raw

        roots = json.loads(read('index.json'))['manifests']
        if len(roots) != 1:
            raise ValueError('Expected one OCI root')
        index_bytes = blob(roots[0])
        index = json.loads(index_bytes)
        runtime = [item for item in index['manifests'] if item.get('platform') == {'os': 'linux', 'architecture': 'amd64'}]
        attestations = [item for item in index['manifests']
                       if item.get('annotations', {}).get('vnd.docker.reference.type') == 'attestation-manifest']
        if len(runtime) != 1 or len(attestations) != 1:
            raise ValueError('Expected one runtime and its attestation')
        manifest = json.loads(blob(runtime[0]))
        config = json.loads(blob(manifest['config']))
        labels = config.get('config', {}).get('Labels', {})
        expected = {'source': 'https://github.com/naktan02/gotgotgan', 'revision': commit,
                    'version': 'sha-' + commit, 'title': artifact}
        if any(labels.get('org.opencontainers.image.' + key) != value for key, value in expected.items()):
            raise ValueError('Image labels differ from the selected source')
        envelopes = {}
        for layer in json.loads(blob(attestations[0]))['layers']:
            statement = json.loads(blob(layer))
            kind = statement.get('predicateType')
            if kind not in PREDICATES or kind in envelopes:
                raise ValueError('Expected exactly one SLSA and SPDX predicate')
            subjects = statement.get('subject', [])
            if len(subjects) != 1 or subjects[0].get('digest') != {'sha256': runtime[0]['digest'][7:]}:
                raise ValueError('Attestation names a different runtime')
            envelopes[kind] = {PREDICATES[kind]: statement['predicate']}
        if envelopes.keys() != PREDICATES.keys():
            raise ValueError('SBOM or provenance is missing')
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        work = Path(temporary)
        (work / 'index.json').write_bytes(index_bytes)
        for kind, envelope in envelopes.items():
            (work / (PREDICATES[kind] + '.json')).write_text(json.dumps(envelope))
        run('node', 'scripts/prepare-application-release.mjs', 'inspect-evidence',
            '--artifact-id', artifact, '--image', 'ghcr.io/naktan02/' + artifact,
            '--index-manifest', work / 'index.json', '--expected-index-digest', roots[0]['digest'],
            '--provenance', work / 'SLSA.json', '--sbom', work / 'SPDX.json', '--output-directory', output)
    return manifest['config']['digest']


@contextmanager
def builder(owner, labels):
    # This daemon is the disposable CI builder, never the operating Docker daemon.
    run('docker', 'volume', 'create', *labels, owner + '-buildkit')
    try:
        run('docker', 'run', '--detach', '--name', owner + '-builder', *labels,
            '--privileged', '--memory', '2g', '--cpus', '2', '--pids-limit', '512',
            '--mount', 'type=volume,source=' + owner + '-buildkit,target=/var/lib/buildkit', PINS['buildkit'])
        run('docker', 'buildx', 'create', '--name', owner, '--driver', 'remote', 'docker-container://' + owner + '-builder')
        yield
    finally:
        subprocess.run(['docker', 'buildx', 'rm', owner], capture_output=True)
        subprocess.run(['docker', 'rm', '--force', '--volumes', owner + '-builder'], capture_output=True)
        subprocess.run(['docker', 'volume', 'rm', owner + '-buildkit'], capture_output=True)


def build(owner, labels, commit, artifact, target, archive, evidence, image_tag):
    image_labels = {'source': 'https://github.com/naktan02/gotgotgan', 'revision': commit,
                    'version': 'sha-' + commit, 'title': artifact}
    run('docker', 'buildx', 'build', '--builder', owner, '--platform', 'linux/amd64', '--pull',
        '--tag', 'ghcr.io/naktan02/' + artifact + ':sha-' + commit,
        '--provenance=mode=max,version=v1', '--sbom=generator=' + PINS['sbom'], *labels,
        *[value for key, item in image_labels.items() for value in ('--label', 'org.opencontainers.image.' + key + '=' + item)],
        '--output=type=oci,dest=' + str(archive), '--target', target, '--file', 'Dockerfile', '.')
    identity = inspect(archive, commit, artifact, evidence)
    with tempfile.TemporaryDirectory(prefix='place-convert-', dir=Path(os.environ['TMPDIR'])) as temporary:
        work = Path(temporary)
        run('docker', 'run', '--rm', '--name', owner + '-convert', *labels, '--network', 'none',
            '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
            '--memory', '512m', '--cpus', '1', '--pids-limit', '128',
            '--mount', 'type=bind,source=' + str(archive) + ',target=/input.tar,readonly',
            '--mount', 'type=bind,source=' + str(work) + ',target=/output', PINS['skopeo'],
            '--tmpdir=/output', '--override-os=linux', '--override-arch=amd64', 'copy',
            'oci-archive:/input.tar', 'docker-archive:/output/image.tar:' + image_tag)
        run('docker', 'load', '--input', work / 'image.tar')
    actual = subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{.Id}}', image_tag], text=True).strip()
    if actual != identity:
        raise ValueError('Loaded runtime differs from the attested OCI bytes')
    return identity

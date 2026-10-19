"""Reject OCI evidence substitutions before invoking the product evidence validator."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import oci


class EvidenceTests(unittest.TestCase):
    def archive(self, root, *, wrong_subject=False, wrong_source=False, corrupt=False):
        content = {}

        def blob(value):
            raw = json.dumps(value).encode()
            checksum = hashlib.sha256(raw).hexdigest()
            content['blobs/sha256/' + checksum] = raw
            return {'digest': 'sha256:' + checksum, 'size': len(raw)}

        commit = 'a' * 40
        config = blob({'config': {'Labels': {
            'org.opencontainers.image.source': 'https://github.com/naktan02/gotgotgan',
            'org.opencontainers.image.revision': 'b' * 40 if wrong_source else commit,
            'org.opencontainers.image.version': 'sha-' + commit,
            'org.opencontainers.image.title': 'place-web',
        }}})
        runtime = {**blob({'config': config}), 'platform': {'os': 'linux', 'architecture': 'amd64'}}
        layers = [blob({'predicateType': kind, 'predicate': {}, 'subject': [{
            'digest': {'sha256': 'c' * 64 if wrong_subject else runtime['digest'][7:]}}]})
            for kind in oci.PREDICATES]
        attest = {**blob({'layers': layers}), 'annotations': {'vnd.docker.reference.type': 'attestation-manifest'}}
        index = blob({'manifests': [runtime, attest]})
        content['index.json'] = json.dumps({'manifests': [index]}).encode()
        if corrupt:
            content['blobs/sha256/' + index['digest'][7:]] += b' '
        archive = root / 'image.tar'
        with tarfile.open(archive, 'w') as stream:
            for name, raw in content.items():
                member = tarfile.TarInfo(name)
                member.size = len(raw)
                stream.addfile(member, io.BytesIO(raw))
        return archive, commit, config['digest']

    def test_valid_bindings_reach_existing_product_validator(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(oci, 'run') as validate:
            root = Path(temporary)
            archive, commit, config = self.archive(root)
            self.assertEqual(oci.inspect(archive, commit, 'place-web', root / 'evidence'), config)
            self.assertIn('scripts/prepare-application-release.mjs', validate.call_args.args)
            self.assertIn('inspect-evidence', validate.call_args.args)

    def test_substituted_evidence_is_rejected(self):
        for mutation in ('wrong_subject', 'wrong_source', 'corrupt'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary, patch.object(oci, 'run') as validate:
                root = Path(temporary)
                archive, commit, _ = self.archive(root, **{mutation: True})
                with self.assertRaises(ValueError):
                    oci.inspect(archive, commit, 'place-web', root / 'evidence')
                validate.assert_not_called()


if __name__ == '__main__':
    unittest.main()

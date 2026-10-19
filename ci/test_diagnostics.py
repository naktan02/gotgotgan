"""Failure evidence must survive while the original test failure remains visible."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import diagnostics


class DiagnosticTests(unittest.TestCase):
    def test_memory_read_failure_does_not_replace_check_or_reports(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            previous = Path.cwd()
            try:
                os.chdir(root)
                with patch.dict(os.environ, DELIVERY_DIAGNOSTICS_DIR=str(root)), \
                        patch.object(Path, 'is_file', return_value=True), \
                        patch.object(Path, 'read_text', side_effect=PermissionError('fixture')):
                    with self.assertRaisesRegex(RuntimeError, 'original failure'):
                        with diagnostics.reports():
                            raise RuntimeError('original failure')
                with zipfile.ZipFile(root / 'report.zip') as archive:
                    evidence = json.loads(archive.read('resource-usage.json'))
                    self.assertEqual(evidence['before']['memory.events'], {'unavailable': 'PermissionError'})
                    self.assertEqual(evidence['after'], evidence['before'])
                    self.assertIn('collection.json', archive.namelist())
            finally:
                os.chdir(previous)

    def test_failed_check_retains_bounded_reports_and_memory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reports = root / 'playwright-report'
            reports.mkdir()
            (reports / 'small.txt').write_text('ok')
            (reports / 'large.bin').write_bytes(b'x' * 10)
            output = root / 'diagnostics'
            output.mkdir()
            previous = Path.cwd()
            try:
                os.chdir(root)
                with patch.dict(os.environ, DELIVERY_DIAGNOSTICS_DIR=str(output)), \
                        patch.object(diagnostics, 'MAX_BYTES', 4), \
                        patch.object(diagnostics, 'memory_snapshot', return_value={'memory.events': 'oom_kill 0'}):
                    with self.assertRaisesRegex(RuntimeError, 'original failure'):
                        with diagnostics.reports():
                            raise RuntimeError('original failure')
                with zipfile.ZipFile(output / 'report.zip') as archive:
                    self.assertEqual(archive.read('playwright-report/small.txt'), b'ok')
                    summary = json.loads(archive.read('collection.json'))
                    self.assertEqual(summary['omitted_due_to_limit'], ['playwright-report/large.bin'])
                    self.assertEqual(json.loads(archive.read('resource-usage.json'))['after']['memory.events'], 'oom_kill 0')
                self.assertFalse((output / 'report.partial').exists())
                with patch.dict(os.environ, DELIVERY_DIAGNOSTICS_DIR=str(root / 'missing')):
                    with self.assertRaisesRegex(RuntimeError, 'original failure'):
                        with diagnostics.reports():
                            raise RuntimeError('original failure')
            finally:
                os.chdir(previous)


if __name__ == '__main__':
    unittest.main()

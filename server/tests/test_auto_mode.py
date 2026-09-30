"""Offline, independently labeled Auto-routing baseline; no model or network calls."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1]


class AutoModeEvaluationTests(unittest.TestCase):
    def run_eval(self, *args):
        return subprocess.run([sys.executable, '-m', 'evals.routing', *args], cwd=SERVER,
                              capture_output=True, text=True, timeout=10)

    def test_local_only_routing_reports_quality_and_uncertainty(self):
        result = self.run_eval()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report['fixture_version'], 1)
        self.assertEqual(report['catalog_version'], 1)
        self.assertEqual(report['total'], 9)
        self.assertEqual(report['accuracy'], 1.0)
        self.assertEqual(report['uncertainty_accuracy'], 1.0)
        self.assertEqual(report['policy_violations'], 0)
        rows = {row['id']: row for row in report['cases']}
        self.assertEqual(rows['code-python']['predicted_mode'], 'coding')
        self.assertEqual(rows['research-law']['predicted_mode'], 'research')
        self.assertEqual(rows['docs-readme']['predicted_mode'], 'documentation')
        self.assertEqual((rows['smalltalk']['state'], rows['smalltalk']['provider']),
                         ('degraded', 'local'))
        self.assertEqual(rows['implicit-research']['expected_mode'], 'research')
        self.assertTrue(rows['implicit-research']['degraded'])
        self.assertEqual(sum(sum(predictions.values()) for predictions in report['confusion'].values()), 9)
        self.assertIsNone(report['human_task_quality'])
        self.assertIsNone(report['latency_ms'])
        self.assertIsNone(report['estimated_cost_usd'])

    def test_invalid_fixture_version_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'routing.jsonl'
            path.write_text('{"fixture_version":2,"id":"x","prompt":"hello",'
                            '"expected_mode":"documentation","expected_degraded":true}\n')
            result = self.run_eval(str(path))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('fixture version', result.stderr.lower())


if __name__ == '__main__':
    unittest.main()

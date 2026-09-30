"""Offline Auto-routing baseline; scores intent and policy, not answer quality."""
import json
import sys
from collections import Counter
from pathlib import Path

from policy import ExecutionMode, ExecutionPolicy, ModelCandidate
from routing import choose_model

CATALOG_VERSION = 1
CAPABILITIES = frozenset({'research', 'coding', 'documentation'})
CATALOG = [ModelCandidate('openai', 'fixture-cloud', CAPABILITIES, False),
           ModelCandidate('local', 'fixture-local', CAPABILITIES, True)]


def evaluate(path: Path | None = None) -> dict:
    path = path or Path(__file__).with_name('routing_fixtures.jsonl')
    cases = [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]
    if not cases or any(row.get('fixture_version') != 1 for row in cases):
        raise ValueError('unsupported or empty fixture version')
    if len({row['id'] for row in cases}) != len(cases):
        raise ValueError('duplicate fixture ID')
    confusion: dict[str, Counter] = {}
    rows = []
    for case in cases:
        expected = ExecutionMode(case['expected_mode'])
        if expected is ExecutionMode.AUTO or type(case['expected_degraded']) is not bool:
            raise ValueError('invalid expected routing label')
        decision = choose_model(case['prompt'], ExecutionMode.AUTO, CATALOG, ExecutionPolicy())
        predicted = decision.mode.value
        confusion.setdefault(expected.value, Counter())[predicted] += 1
        rows.append({'id': case['id'], 'expected_mode': expected.value,
                     'predicted_mode': predicted, 'degraded': decision.state == 'degraded',
                     'expected_degraded': case['expected_degraded'],
                     'state': decision.state, 'provider': decision.provider,
                     'reason': decision.reason})
    return {'fixture_version': 1, 'catalog_version': CATALOG_VERSION, 'total': len(rows),
            'accuracy': sum(row['expected_mode'] == row['predicted_mode'] for row in rows) / len(rows),
            'uncertainty_accuracy': sum(row['degraded'] == row['expected_degraded']
                                        for row in rows) / len(rows),
            'confusion': {label: dict(counts) for label, counts in confusion.items()},
            'policy_violations': sum(row['provider'] not in (None, 'local') for row in rows),
            'human_task_quality': None, 'latency_ms': None, 'estimated_cost_usd': None,
            'cases': rows}


if __name__ == '__main__':
    try:
        print(json.dumps(evaluate(Path(sys.argv[1]) if len(sys.argv) > 1 else None), sort_keys=True))
    except (ValueError, KeyError, json.JSONDecodeError) as error:
        raise SystemExit(str(error)) from None

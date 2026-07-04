"""
Test/smoke scripts. Run from the PROJECT ROOT as modules so the root is on the
import path (imports like `from adapters...` / `from brain...` resolve):

    .venv\\Scripts\\python -m tests.test_brain

See tests/README.md for what each one needs (.env vars, network).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

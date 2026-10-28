
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Tests never download or load the real embedding model.
os.environ.setdefault('ATLAS_LOAD_EMBEDDINGS', '0')

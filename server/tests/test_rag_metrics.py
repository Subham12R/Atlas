from unittest import TestCase

from evals.rag_metrics import evaluate_fixtures, ndcg_at_k, recall_at_k, reciprocal_rank


class RagMetricTests(TestCase):
    def test_recall_counts_unique_hits_within_cutoff(self):
        self.assertEqual(recall_at_k({'b', 'c'}, ['a', 'b', 'b', 'c'], 2), 0.5)
        self.assertEqual(recall_at_k({'b', 'c'}, ['a', 'b', 'b', 'c'], 3), 0.5)

    def test_reciprocal_rank_uses_first_relevant_result(self):
        self.assertEqual(reciprocal_rank({'b', 'c'}, ['a', 'b', 'c']), 0.5)

    def test_ndcg_uses_binary_relevance_at_cutoff(self):
        self.assertAlmostEqual(ndcg_at_k({'b', 'c'}, ['a', 'b', 'c'], 2), 0.3868528072)
        self.assertAlmostEqual(ndcg_at_k({'b', 'c'}, ['b', 'b', 'c'], 2), 0.6131471928)

    def test_empty_labels_or_rankings_score_zero(self):
        for labels, ranking in ((set(), ['a']), ({'b'}, [])):
            with self.subTest(labels=labels, ranking=ranking):
                self.assertEqual(recall_at_k(labels, ranking, 2), 0)
                self.assertEqual(reciprocal_rank(labels, ranking), 0)
                self.assertEqual(ndcg_at_k(labels, ranking, 2), 0)

    def test_nonpositive_or_noninteger_cutoff_is_rejected(self):
        for k in (0, -1, 1.5, True):
            with self.subTest(k=k):
                with self.assertRaises(ValueError):
                    recall_at_k({'b'}, ['b'], k)
                with self.assertRaises(ValueError):
                    ndcg_at_k({'b'}, ['b'], k)

    def test_fixture_runner_scores_actual_vector_search(self):
        report = evaluate_fixtures()
        self.assertEqual(report['fixture_version'], 1)
        self.assertEqual(report['k'], 2)
        queries = {row['query_id']: row for row in report['queries']}
        self.assertEqual(queries['release-dates']['ranked_ids'], ['color', 'qa-freeze', 'cutover'])
        self.assertEqual(queries['languages']['ranked_ids'], ['python', 'runner', 'rust'])
        self.assertEqual(queries['release-dates']['recall_at_k'], 0.5)
        self.assertEqual(queries['release-dates']['reciprocal_rank'], 0.5)
        self.assertAlmostEqual(queries['release-dates']['ndcg_at_k'], 0.3868528072)
        self.assertEqual(queries['languages']['reciprocal_rank'], 1.0)
        self.assertEqual(report['mean_recall_at_k'], 0.5)
        self.assertEqual(report['mrr'], 0.75)
        self.assertAlmostEqual(report['mean_ndcg_at_k'], 0.5)

"""Offline integration against the pinned real optimizer, not model quality."""

import sys
import contextlib
import io
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "eval/gepa"))
from adapter import DegreaserAdapter
from campaign import optimize_candidate


class OptimizerIntegrationTests(unittest.TestCase):
    def test_gepa_accepts_adapter_feedback_and_preserve_is_not_inverted(self):
        with tempfile.TemporaryDirectory() as temp:
            product = Path(temp)
            surface = "src/modules/aspect/low-value-comments/rubric.md"
            path = product / surface
            path.parent.mkdir(parents=True)
            path.write_text("seed")
            samples = [
                {"id": f"dev/{index}", "split": "dev", "review": {"task": "Audit"},
                 "repo": {"directory": temp}, "aspects": ["low-value-comments"],
                 "target": {"report": [{"id": "R1", "path": "a.ts", "lines": [1, 1]}],
                            "preserve": []}}
                for index in range(2)
            ]

            def run_batch(batch, candidate):
                return [{"metrics": {
                    "complete": True, "recall": 0.8 if candidate == "better" else 0.2,
                    "precisionProxy": 1, "preserveRate": 1, "preserveHits": [],
                    "forbiddenCount": 0, "misses": ["R1"], "unmatchedFindingIds": [],
                }} for _ in batch]

            def adapter_for(metric_limit, session_limit):
                return DegreaserAdapter({
                    "productDir": str(product), "surface": surface,
                    "maxMetricCalls": metric_limit, "maxSessions": session_limit,
                }, run_batch=run_batch)

            def run(adapter):
                with contextlib.redirect_stdout(io.StringIO()):
                    return optimize_candidate(
                        adapter, samples, "seed", lambda _: "unused",
                        proposer=lambda *_: {"text": "better"},
                    )

            for cap in range(2, 16):
                with self.subTest(metric_cap=cap):
                    adapter = adapter_for(cap, 100)
                    result = run(adapter)
                    self.assertLessEqual(adapter.calls, cap)
                    self.assertEqual(result.best_candidate["text"],
                                     "better" if cap >= 8 else "seed")
            for cap in range(4, 26):
                with self.subTest(session_cap=cap):
                    adapter = adapter_for(100, cap)
                    run(adapter)
                    self.assertLessEqual(adapter.sessions, cap)
            self.assertEqual(path.read_text(), "seed")
            with self.assertRaises(ValueError):
                adapter.evaluate([{"split": "holdout"}], {"text": "better"})
            with self.assertRaises(RuntimeError):
                adapter.evaluate(samples * 100, {"text": "better"})
            adapter = adapter_for(100, 100)
            unsupported = dict(samples[0], target={"report": [], "preserve": []})
            with self.assertRaises(ValueError):
                adapter.evaluate([unsupported], {"text": "better"})
            self.assertEqual(adapter.calls, 0)
            self.assertEqual(adapter.sessions, 0)

    def test_partial_candidate_scores_zero_while_failures_still_stop(self):
        with tempfile.TemporaryDirectory() as temp:
            product = Path(temp)
            surface = "src/modules/aspect/low-value-comments/rubric.md"
            (product / surface).parent.mkdir(parents=True)
            (product / surface).write_text("seed")
            samples = [
                {"id": f"dev/{index}", "split": "dev", "review": {"task": "Audit"},
                 "repo": {"directory": temp}, "aspects": ["low-value-comments"],
                 "target": {"report": [{"id": "R1", "path": "a.ts", "lines": [1, 1]}],
                            "preserve": []}}
                for index in range(2)
            ]
            complete = {"metrics": {
                "complete": True, "recall": 0.5, "precisionProxy": 1, "preserveRate": 1,
                "preserveHits": [], "forbiddenCount": 0, "misses": ["R1"],
                "unmatchedFindingIds": [],
            }}
            partial = {"envelope": {"export": {"status": "partial", "findings": []}},
                       "metrics": {"complete": False, "reason": "incomplete-review",
                                   "recall": None}}

            def optimize(failure):
                adapter = DegreaserAdapter({
                    "productDir": str(product), "surface": surface,
                    "maxMetricCalls": 15, "maxSessions": 100,
                }, run_batch=lambda batch, text: [
                    complete if text == "seed" else failure for _ in batch])
                with contextlib.redirect_stdout(io.StringIO()):
                    result = optimize_candidate(
                        adapter, samples, "seed", lambda _: "unused",
                        proposer=lambda *_: {"text": "partial"},
                    )
                return adapter, result

            adapter, result = optimize(partial)
            self.assertEqual(result.best_candidate["text"], "seed")
            rejected = [entry for entry in adapter.history
                        if entry["candidate"]["text"] == "partial"]
            self.assertTrue(rejected)
            self.assertTrue(all(score == 0.0 for entry in rejected for score in entry["scores"]))
            for failure in (
                {"error": "Authentication required."},
                {"envelope": {}, "metrics": {"complete": False, "reason": "invalid-export"}},
                {"envelope": {}, "metrics": {"complete": False, "reason": "unattributed-partial"}},
                {"envelope": {}, "metrics": {"complete": True, "recall": None}},
            ):
                with self.subTest(failure=failure), self.assertRaises((RuntimeError, ValueError)):
                    optimize(failure)


if __name__ == "__main__":
    unittest.main()

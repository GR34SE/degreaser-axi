import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "eval/gepa"))
from adapter import DegreaserAdapter, surface_path
from campaign import reflection_lm
from feedback import source_context


class CampaignBoundaryTests(unittest.TestCase):
    def test_candidate_is_limited_to_existing_rubric_or_worker_prompt(self):
        with tempfile.TemporaryDirectory() as temp:
            product = Path(temp)
            rubric = product / "src/modules/aspect/low-value-comments/rubric.md"
            rubric.parent.mkdir(parents=True)
            rubric.write_text("rubric")
            self.assertEqual(surface_path(product, str(rubric.relative_to(product))), rubric.resolve())
            for bad in ("package.json", "../rubric.md", "src/modules/aspect/../../rubric.md"):
                with self.assertRaises(ValueError):
                    surface_path(product, bad)
            with tempfile.TemporaryDirectory() as other:
                rubric.unlink()
                rubric.symlink_to(Path(other) / "rubric.md")
                with self.assertRaises(ValueError):
                    surface_path(product, str(rubric.relative_to(product)))

    def test_feedback_contains_misses_not_worker_repository_or_holdout(self):
        adapter = object.__new__(DegreaserAdapter)
        batch = SimpleNamespace(trajectories=[{
            "sampleId": "dev/1", "task": "Audit",
            "misses": ["a.ts:4"], "unmatchedFindingIds": ["F1"],
            "preserveRate": 0, "forbiddenCount": 0,
            "context": {"anchors": []}, "findings": [{"id": "F1"}],
        }])
        result = adapter.make_reflective_dataset({"text": "rubric"}, batch, ["text"])
        self.assertEqual(result["text"][0]["Generated Outputs"], [{"id": "F1"}])
        self.assertEqual(json.loads(result["text"][0]["Feedback"])["unmatchedFindingIds"], ["F1"])
        with self.assertRaises(ValueError):
            adapter.make_reflective_dataset({}, batch, ["arbitrary-code"])

    def test_native_reflection_rejects_failed_or_empty_result_and_bounds_calls(self):
        fake = SimpleNamespace(returncode=0, stdout='{"result":"candidate"}')
        reflect = reflection_lm("claude-haiku-example", max_calls=1)
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "must-not-inherit"}):
            with patch("campaign.subprocess.run", return_value=fake) as invoke:
                self.assertEqual(reflect([{"role": "user", "content": "input"}]), "candidate")
                self.assertNotIn("ANTHROPIC_API_KEY", invoke.call_args.kwargs["env"])
            with self.assertRaisesRegex(RuntimeError, "budget"):
                reflect([])
        for response in ({"is_error": True, "result": "refused"}, {}):
            fake.stdout = json.dumps(response)
            with patch("campaign.subprocess.run", return_value=fake):
                with self.assertRaises(RuntimeError):
                    reflection_lm("claude-haiku-example")([])

    def test_reflection_context_reads_missed_source_without_following_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "a.ts").write_text("const a = 1;\n// repeats code\nreturn a;\n")
            sample = {"repo": {"directory": temp}, "target": {
                "report": [{"id": "R1", "path": "a.ts", "lines": [2, 2]},
                           {"id": "R2", "path": "../outside", "lines": [1, 1]}],
                "preserve": [],
            }}
            result = source_context(sample, {"misses": ["R1", "R2"], "preserveHits": []})
            self.assertIn("2: // repeats code", result["anchors"][0]["source"])
            self.assertIn("limitation", result["anchors"][1])
            self.assertNotIn("source", result["anchors"][1])


if __name__ == "__main__":
    unittest.main()

"""GEPA protocol bridge. The optimizer never edits the user's checkout."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path
from feedback import source_context

REVIEW_ATTEMPTS = json.loads(
    (Path(__file__).resolve().parents[1] / "review-policy.json").read_text()
)["maxRetries"] + 1


def session_cost(batch):
    return sum(len(item["aspects"]) * REVIEW_ATTEMPTS for item in batch)


def command(argv, cwd=None, timeout=600):
    result = subprocess.run(
        argv, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False
    )
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {argv[0]}")
    return result.stdout


def batch_records(returncode, output):
    summary = output / "summary.json"
    if returncode not in (0, 1) or not summary.is_file():
        raise RuntimeError(f"Evaluation run failed ({returncode}).")
    report = json.loads(summary.read_text())
    if report.get("providerErrors") != 0 or (returncode == 1) != bool(report.get("incompleteRecords")):
        raise RuntimeError("Evaluation run reported provider errors or an unexplained failure.")
    return [json.loads(line) for line in (output / "records.jsonl").read_text().splitlines()]


def surface_path(product, surface):
    allowed = (
        surface == "src/review/attempt/prompt/worker.md"
        or (
            surface.startswith("src/modules/aspect/")
            and surface.endswith("/rubric.md")
            and len(Path(surface).parts) == 5
        )
    )
    path = (product / surface).resolve()
    if not allowed or not path.is_relative_to(product.resolve()) or not path.is_file():
        raise ValueError("Candidate surface must be an existing built-in rubric or worker.md.")
    return path


class DegreaserAdapter:
    propose_new_texts = None

    def __init__(self, config, run_batch=None):
        self.config = config
        self.product = Path(config["productDir"]).resolve()
        self.surface = config["surface"]
        surface_path(self.product, self.surface)
        self.root = Path(__file__).resolve().parents[2]
        self.calls = 0
        self.sessions = 0
        self.session_limit = config.get("maxSessions", config["maxMetricCalls"])
        if any(type(limit) is not int or limit < 1 for limit in (
            config["maxMetricCalls"], self.session_limit)):
            raise ValueError("Campaign budgets must be positive integers.")
        self.run_batch = run_batch or self._run_batch
        self.history = []

    def evaluate(self, batch, candidate, capture_traces=False):
        from gepa.core.adapter import EvaluationBatch

        if set(candidate) != {"text"} or not candidate["text"].strip():
            raise ValueError("A candidate must contain exactly one nonempty text component.")
        if any(item["split"] != "dev" for item in batch):
            raise ValueError("Optimization may read only dev samples.")
        if any(not item["target"]["report"] for item in batch):
            raise ValueError("Optimization requires REPORT anchors before evaluation.")
        if self.calls + len(batch) > self.config["maxMetricCalls"]:
            raise RuntimeError("Campaign metric-call budget exhausted.")
        self.reserve_sessions(session_cost(batch))
        self.calls += len(batch)
        rows = self.run_batch(batch, candidate["text"])
        if len(rows) != len(batch):
            raise RuntimeError("Evaluation did not return the requested batch.")
        scores, objectives, traces = [], [], []
        for sample, row in zip(batch, rows):
            metrics = row.get("metrics") or {}
            if row.get("error"):
                raise RuntimeError("Provider-failed evaluation stops the campaign.")
            if not metrics.get("complete"):
                if metrics.get("reason") != "incomplete-review":
                    raise RuntimeError("Invalid evaluation export stops the campaign.")
                scores.append(0.0)
                objectives.append({"recall": 0.0, "precisionProxy": 0.0, "preserve": 0.0})
                traces.append({
                    "sampleId": sample["id"], "task": sample["review"]["task"],
                    "complete": False, "reason": metrics["reason"],
                    "context": {"anchors": [], "limitation": "Partial review; anchor metrics are unknown."},
                    "findings": row.get("envelope", {}).get("export", {}).get("findings", []),
                })
                continue
            recall = metrics.get("recall")
            if recall is None:
                raise ValueError("Optimization requires REPORT anchors.")
            safe = not metrics["forbiddenCount"] and not metrics["preserveHits"]
            scores.append(recall if safe else 0.0)
            objectives.append({
                "recall": recall,
                "precisionProxy": metrics.get("precisionProxy") or 0.0,
                "preserve": metrics.get("preserveRate") or 0.0,
            })
            traces.append({
                "sampleId": sample["id"], "task": sample["review"]["task"],
                "complete": True,
                "misses": metrics["misses"],
                "unmatchedFindingIds": metrics["unmatchedFindingIds"],
                "preserveRate": metrics["preserveRate"],
                "forbiddenCount": metrics["forbiddenCount"],
                "context": source_context(sample, metrics),
                "findings": row.get("envelope", {}).get("export", {}).get("findings", []),
            })
        self.history.append({"candidate": candidate, "sampleIds": [s["id"] for s in batch], "scores": scores})
        return EvaluationBatch(
            outputs=rows, scores=scores, trajectories=traces if capture_traces else None,
            objective_scores=objectives, num_metric_calls=len(batch),
        )

    def make_reflective_dataset(self, candidate, eval_batch, components_to_update):
        if components_to_update != ["text"]:
            raise ValueError("Only the single text component may change.")
        return {"text": [
            {
                "Inputs": {"sample": trace["sampleId"], "task": trace["task"],
                           "context": trace["context"]},
                "Generated Outputs": trace["findings"],
                "Feedback": json.dumps(trace, sort_keys=True),
            }
            for trace in (eval_batch.trajectories or [])
        ]}

    def reserve_sessions(self, count):
        if self.sessions + count > self.session_limit:
            raise RuntimeError("Campaign session budget exhausted.")
        self.sessions += count

    def _run_batch(self, batch, text):
        with tempfile.TemporaryDirectory(prefix="degreaser-candidate-") as temporary:
            directory = Path(temporary)
            checkout = directory / "product"
            revision = self.config["baseSha"]
            command(["git", "worktree", "add", "--detach", str(checkout), revision], self.product)
            try:
                surface_path(checkout, self.surface).write_text(text, encoding="utf-8")
                (checkout / "node_modules").symlink_to(self.product / "node_modules", target_is_directory=True)
                command(["node", "tools/build.ts"], checkout)
                manifest = directory / "samples.jsonl"
                manifest.write_text("".join(json.dumps(s) + "\n" for s in batch), encoding="utf-8")
                output = directory / "result"
                result = subprocess.run([
                    "node", str(self.root / "eval/cli.mjs"), "run",
                    "--samples", str(manifest), "--product", str(checkout),
                    "--model", self.config["model"], "--repeat", "1",
                    "--budget", str(self.session_limit),
                    "--output", str(output), "--allow-models",
                ], cwd=self.root, capture_output=True, text=True,
                    timeout=960 * len(batch) + 60, check=False)
                rows = batch_records(result.returncode, output)
                by_id = {row["sample"]["id"]: row for row in rows}
                return [by_id[sample["id"]] for sample in batch]
            finally:
                command(["git", "worktree", "remove", "--force", str(checkout)], self.product)

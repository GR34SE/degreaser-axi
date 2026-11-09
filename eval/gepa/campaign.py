"""Run an opt-in local campaign; selection never applies a product change."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path

from adapter import DegreaserAdapter, command, session_cost

HAIKU_MODEL = "claude-haiku-4-5-20251001"


def reflection_lm(model, max_calls=300, admit=None):
    calls = 0

    def reflect(messages):
        nonlocal calls
        if calls >= max_calls:
            raise RuntimeError("Campaign reflection-call budget exhausted.")
        if isinstance(messages, str):
            prompt = messages
        elif isinstance(messages, list):
            prompt = json.dumps(messages)
        else:
            raise TypeError("Reflection input must be a prompt string or message list.")
        if admit:
            admit(1)
        calls += 1
        with tempfile.TemporaryDirectory(prefix="degreaser-reflection-") as directory:
            env = {key: os.environ[key] for key in (
                "HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "USER",
                "CLAUDE_CONFIG_DIR",
            ) if key in os.environ}
            result = subprocess.run([
                "claude", "-p", "--model", model, "--output-format", "json",
                "--tools", "", "--disable-slash-commands", "--no-session-persistence",
                "--safe-mode", "--strict-mcp-config",
            ], input=prompt, text=True, capture_output=True,
                cwd=directory, env=env, timeout=300, check=False)
        if result.returncode:
            raise RuntimeError("Native reflection failed; no provider/model fallback is allowed.")
        response = json.loads(result.stdout)
        if response.get("is_error") or not response.get("result"):
            raise RuntimeError("Native reflection did not return text.")
        return response["result"]
    return reflect


def optimize_candidate(adapter, samples, seed, reflection, run_dir=None, proposer=None):
    from gepa import optimize

    size = len(samples)
    minibatch = min(3, size)
    if not size or any(not sample["target"]["report"] for sample in samples):
        raise ValueError("Training requires nonempty dev REPORT samples.")
    if size > adapter.config["maxMetricCalls"] or session_cost(samples) > adapter.session_limit:
        raise ValueError("Budget cannot cover the initial validation set.")
    metric_reserve = 2 * minibatch + size
    session_reserve = 2 * minibatch * max(session_cost([s]) for s in samples) + session_cost(samples) + 1

    def stop_before_unaffordable_iteration(_state):
        return (adapter.calls + metric_reserve > adapter.config["maxMetricCalls"]
                or adapter.sessions + session_reserve > adapter.session_limit)

    return optimize(
        seed_candidate={"text": seed}, trainset=samples, adapter=adapter,
        reflection_lm=reflection, custom_candidate_proposer=proposer,
        max_metric_calls=adapter.config["maxMetricCalls"],
        stop_callbacks=stop_before_unaffordable_iteration,
        reflection_minibatch_size=minibatch, frontier_type="hybrid",
        run_dir=run_dir, seed=0, cache_evaluation=False, raise_on_exception=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--allow-models", action="store_true")
    args = parser.parse_args()
    if not args.allow_models:
        parser.error("Inference requires --allow-models after a quota check.")
    config = json.loads(Path(args.config).read_text())
    if config["agent"] != "claude" or config["model"] != HAIKU_MODEL:
        raise ValueError(f"This campaign uses the owner's fixed Claude Haiku model {HAIKU_MODEL}.")
    if type(config["maxMetricCalls"]) is not int or config["maxMetricCalls"] < 1:
        raise ValueError("maxMetricCalls must be a positive integer.")
    product = Path(config["productDir"]).resolve()
    revision = command(["git", "rev-parse", f'{config["baseSha"]}^{{commit}}'], product).strip()
    config["baseSha"] = revision
    output = Path(config["outputDir"]).resolve()
    samples = [json.loads(line) for line in Path(config["samples"]).read_text().splitlines() if line.strip()]
    samples = [sample for sample in samples if sample["split"] == "dev"]
    unsupported = sum(not sample["target"]["report"] for sample in samples)
    samples = [sample for sample in samples if sample["target"]["report"]]
    if not samples:
        raise ValueError("Campaign requires nonempty dev samples.")
    aspect = Path(config["surface"]).parts[-2] if config["surface"].endswith("rubric.md") else None
    if aspect:
        samples = [sample for sample in samples if sample["aspects"] == [aspect]]
    if not samples:
        raise ValueError("No dev samples match this campaign surface.")
    adapter = DegreaserAdapter(config)
    output.mkdir(parents=True, exist_ok=False)
    result = optimize_candidate(
        adapter, samples, command(["git", "show", f'{revision}:{config["surface"]}'], product),
        reflection_lm(config["model"], config["maxMetricCalls"], adapter.reserve_sessions),
        run_dir=str(output / "optimizer"),
    )
    (output / "candidate.md").write_text(result.best_candidate["text"])
    (output / "campaign.json").write_text(json.dumps({
        "schemaVersion": 1, "config": config, "evaluations": adapter.calls,
        "reservedSessions": adapter.sessions, "excludedWithoutReportAnchors": unsupported,
        "history": adapter.history,
        "decision": "requires-paired-regression-gate",
    }, indent=2))
    print(json.dumps({"candidate": str(output / "candidate.md"),
                      "decision": "requires-paired-regression-gate"}))


if __name__ == "__main__":
    main()

"""Bounded, source-backed development context for reflection, never worker input."""

from pathlib import Path


def source_context(sample, metrics):
    root = Path(sample["repo"]["directory"]).resolve()
    wanted = set(metrics["misses"]) | set(metrics["preserveHits"])
    contexts = []
    labels = sample["target"]["report"] + sample["target"]["preserve"]
    for anchor in labels:
        if anchor["id"] not in wanted:
            continue
        path = (root / anchor["path"]).resolve()
        item = {"anchor": anchor}
        if anchor.get("side", "new") != "new":
            item["limitation"] = "Old-side context is available only in exported findings."
        elif not path.is_relative_to(root) or not path.is_file() or path.stat().st_size > 1_048_576:
            item["limitation"] = "Source unavailable, outside the sample, or larger than 1 MiB."
        else:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            start, end = anchor["lines"]
            item["source"] = "\n".join(
                f"{index + 1}: {lines[index]}"
                for index in range(max(0, start - 3), min(len(lines), end + 2))
            )[:3000]
            item["limitation"] = "At most 3000 characters, with two surrounding lines."
        contexts.append(item)
        if len(contexts) == 8:
            break
    return {"anchors": contexts, "omitted": max(0, len(wanted) - len(contexts))}

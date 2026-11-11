#!/usr/bin/env python3
"""Token/time report from Claude Code session transcripts.

Usage: usage-report.py <transcript-dir> [stages.json]
stages.json: [{"name": "plan", "start": "2026-11-11T07:11:00Z"}, ...] (each stage runs to the next start)
Counts each API response once (deduplicated by message id), including subagent transcripts.
"""
import json, sys, glob, os
from collections import defaultdict

root = sys.argv[1]
stages = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else [{"name": "all", "start": ""}]
FIELDS = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"]

seen, rows = set(), []
for path in glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True):
    for line in open(path, errors="ignore"):
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        msg = rec.get("message") or {}
        usage = msg.get("usage")
        if rec.get("type") != "assistant" or not usage or msg.get("id") in seen:
            continue
        seen.add(msg.get("id"))
        rows.append((rec.get("timestamp", ""), msg.get("model", "?"), usage))

def stage_of(ts):
    name = stages[0]["name"]
    for s in stages:
        if ts >= s["start"]:
            name = s["name"]
    return name

totals = defaultdict(lambda: defaultdict(int))
span = {}
for ts, model, usage in sorted(rows, key=lambda r: r[0]):
    key = (stage_of(ts), model)
    for f in FIELDS:
        totals[key][f] += usage.get(f) or 0
    totals[key]["requests"] += 1
    lo, hi = span.get(key[0], (ts, ts))
    span[key[0]] = (min(lo, ts), max(hi, ts))

out = [{"stage": st, "model": m, "first": span[st][0], "last": span[st][1], **dict(v)}
       for (st, m), v in totals.items()]
print(json.dumps(out, indent=2))

#!/usr/bin/env python3
"""Token, time and cost report from Claude Code session transcripts.

Usage: usage-report.py <transcript-dir> <stages.json> [--markdown]
Counts each API response once (deduplicated by message id), subagent transcripts included.
Active time = sum of gaps between consecutive transcript records that are shorter than 5 minutes
(longer gaps are waiting on the person or idle).
Prices: USD per million tokens, Anthropic first-party API list prices, Nov 2026.
Cache writes are billed at 2x input (this session requested the 1-hour cache TTL).
"""
import json, sys, glob, os
from collections import defaultdict
from datetime import datetime

PRICES = {  # input, cache_write_1h, cache_read, output
    'claude-fable-5-2': (8.0, 16.0, 0.20, 40.0),
    'claude-opus-5-5': (4.0, 8.0, 0.20, 20.0),
}
root, stages_file = sys.argv[1], sys.argv[2]
md = '--markdown' in sys.argv
stages = json.load(open(stages_file))
ts = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))

seen, rows, stamps = set(), [], []
for path in glob.glob(os.path.join(root, '**', '*.jsonl'), recursive=True):
    for line in open(path, errors='ignore'):
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if rec.get('timestamp') and rec.get('type') in ('user', 'assistant'):
            stamps.append(rec['timestamp'])
        msg = rec.get('message') or {}
        u = msg.get('usage')
        if rec.get('type') != 'assistant' or not u or msg.get('id') in seen:
            continue
        seen.add(msg['id'])
        rows.append((rec['timestamp'], msg.get('model', '?'), u))

def stage_of(t):
    name = stages[0]['name']
    for s in stages:
        if t >= s['start']:
            name = s['name']
    return name

tok = defaultdict(lambda: defaultdict(int))
for t, model, u in rows:
    k = (stage_of(t), model)
    tok[k]['input'] += u.get('input_tokens') or 0
    tok[k]['cache_write'] += u.get('cache_creation_input_tokens') or 0
    tok[k]['cache_read'] += u.get('cache_read_input_tokens') or 0
    tok[k]['output'] += u.get('output_tokens') or 0
    tok[k]['requests'] += 1

stamps.sort()
active, wall = defaultdict(float), defaultdict(lambda: [None, None])
for a, b in zip(stamps, stamps[1:]):
    gap = (ts(b) - ts(a)).total_seconds()
    st = stage_of(a)
    if gap < 300:
        active[st] += gap
for s in stamps:
    w = wall[stage_of(s)]
    w[0] = w[0] or s
    w[1] = s

def cost(model, d):
    p = PRICES.get(model)
    if not p:
        return 0.0
    return (d['input'] * p[0] + d['cache_write'] * p[1] + d['cache_read'] * p[2] + d['output'] * p[3]) / 1e6

out = []
for (st, model), d in sorted(tok.items()):
    out.append({'stage': st, 'model': model, **d, 'cost_usd': round(cost(model, d), 2)})
summary = {
    'per_stage_model': out,
    'time': {st: {'active_minutes': round(active[st] / 60, 1),
                  'wall_minutes': round((ts(w[1]) - ts(w[0])).total_seconds() / 60, 1)} for st, w in sorted(wall.items())},
    'totals': {
        'requests': sum(r['requests'] for r in out),
        'output_tokens': sum(r['output'] for r in out),
        'cache_read_tokens': sum(r['cache_read'] for r in out),
        'cache_write_tokens': sum(r['cache_write'] for r in out),
        'input_tokens': sum(r['input'] for r in out),
        'cost_usd': round(sum(r['cost_usd'] for r in out), 2),
        'active_minutes': round(sum(active.values()) / 60, 1),
        'wall_minutes': round((ts(stamps[-1]) - ts(stamps[0])).total_seconds() / 60, 1),
    },
}
print(json.dumps(summary, indent=2))

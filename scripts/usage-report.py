#!/usr/bin/env python3
"""Tokens, cost and time per stage from a Claude Code session transcript (.jsonl).
Usage: python3 scripts/usage-report.py <transcript.jsonl> docs/benchmark/stages.json
Prices: USD per million tokens (Anthropic API list prices; same table as the first build's report)."""
import json, sys
from datetime import datetime, timezone

PRICES = {  # input, cache write (1h), cache write (5m), cache read, output
    'claude-opus-5-5': (4.0, 8.0, 5.0, 0.20, 20.0),
    'claude-fable-5-2': (8.0, 16.0, 10.0, 0.20, 40.0),
}
ts = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))
stages = json.load(open(sys.argv[2]))
bounds = [(s['name'], ts(s['start'])) for s in stages]
def stage_of(t):
    name = bounds[0][0]
    for n, start in bounds:
        if t >= start: name = n
    return name

seen, rows, times = set(), {}, []
for line in open(sys.argv[1]):
    try: e = json.loads(line)
    except Exception: continue
    t = e.get('timestamp')
    if t: times.append(ts(t))
    m = e.get('message') or {}
    u = m.get('usage')
    if e.get('type') != 'assistant' or not u: continue
    mid = m.get('id') or e.get('uuid')
    if mid in seen: continue
    seen.add(mid)
    st, model = stage_of(ts(t)), m.get('model', '?')
    r = rows.setdefault((st, model), dict(requests=0, input=0, cache_write=0, cache_write_1h=0, cache_read=0, output=0))
    cc = u.get('cache_creation') or {}
    r['requests'] += 1
    r['input'] += u.get('input_tokens', 0)
    r['cache_write'] += u.get('cache_creation_input_tokens', 0)
    r['cache_write_1h'] += cc.get('ephemeral_1h_input_tokens', u.get('cache_creation_input_tokens', 0) if not cc else 0)
    r['cache_read'] += u.get('cache_read_input_tokens', 0)
    r['output'] += u.get('output_tokens', 0)

out, tot = [], dict(requests=0, input=0, cache_write=0, cache_read=0, output=0, cost=0.0)
for (st, model), r in sorted(rows.items()):
    p = PRICES.get(model, PRICES['claude-opus-5-5'])
    w1h = r['cache_write_1h']; w5m = r['cache_write'] - w1h
    cost = (r['input'] * p[0] + w1h * p[1] + w5m * p[2] + r['cache_read'] * p[3] + r['output'] * p[4]) / 1e6
    out.append(dict(stage=st, model=model, **{k: r[k] for k in ('requests', 'input', 'cache_write', 'cache_read', 'output')}, cost_usd=round(cost, 2)))
    for k in ('requests', 'input', 'cache_write', 'cache_read', 'output'): tot[k] += r[k]
    tot['cost'] += cost

# time: wall = stage span; active = sum of gaps under 5 minutes between transcript events
times.sort()
tm = {}
for a, b in zip(times, times[1:]):
    s = stage_of(a)
    d = tm.setdefault(s, dict(active=0.0, first=a, last=b))
    gap = (b - a).total_seconds()
    if gap < 300: d['active'] += gap
    d['last'] = b
time = {s: dict(active_minutes=round(d['active'] / 60, 1), wall_minutes=round((d['last'] - d['first']).total_seconds() / 60, 1)) for s, d in tm.items()}
tot['cost'] = round(tot['cost'], 2)
tot['active_minutes'] = round(sum(v['active_minutes'] for v in time.values()), 1)
tot['wall_minutes'] = round((times[-1] - times[0]).total_seconds() / 60, 1)
print(json.dumps(dict(per_stage_model=out, time=time, totals=tot), indent=2))

"""Demonstration scenario: simulates a workload to feed the dashboard and the open space.

Disable or delete it once a real scenario is in place.
"""

import random
import time

KEY = "demo_load"
NAME = "Demo · simulated load"
DESCRIPTION = "Processes a batch of fictitious items while declaring its actions, with adjustable duration and failure rate."
SCHEDULE = "*/10 * * * *"
PARAMS = [
    {"name": "count", "label": "Number of items", "type": "int", "default": 12},
    {"name": "delay_ms", "label": "Delay per item (ms)", "type": "int", "default": 40},
    {"name": "failure_rate", "label": "Failure rate per item", "type": "float", "default": 0.05, "help": "Between 0 and 1."},
    {"name": "crash", "label": "Raise a fatal error", "type": "bool", "default": False},
]


def run(ctx):
    count = max(0, ctx.params["count"])
    delay = max(0, ctx.params["delay_ms"]) / 1000
    rate = min(1.0, max(0.0, ctx.params["failure_rate"]))
    ctx.info(f"{count} item(s) to process, {delay * 1000:.0f} ms each, failure rate {rate:.0%}")
    with ctx.step("mail.read", "Demonstration mailbox"):
        time.sleep(delay * 3)
    if ctx.params["crash"]:
        raise RuntimeError("Fatal error requested by the configuration ('crash' parameter).")
    for i in ctx.step("doc.read", "Fictitious batch", range(1, count + 1)):
        time.sleep(delay)
        if random.random() < rate:
            ctx.item_failed(f"item {i}: missing data (simulated)")
        else:
            ctx.item_done()
    with ctx.step("archive", "Filing"):
        time.sleep(delay * 2)
    ctx.metric("items_per_second", round(count / max(0.001, count * delay), 1) if delay else "n/a")

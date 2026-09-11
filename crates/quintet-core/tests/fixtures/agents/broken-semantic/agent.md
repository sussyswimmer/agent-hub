---
id: other-id
name: X
icon: i
color: blue
mission: m
model: haiku
outputs_dir: x
board: b
intake:
  - id: depth
    type: single
    options: [a, b]
    default: c
  - id: depth
    type: text
    skip_if: "memory"
state_snapshot: nope
schedules:
  - name: w
    cron: "0 0 * * * * *"
    task: t
    tz: Mars/Olympus
---
body

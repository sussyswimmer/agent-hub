---
id: ok-full
name: Full
icon: magnifyingglass
color: indigo
version: 2
mission: >
  Exercise every frontmatter field.
owns: [a, b]
does_not_own: [c]
model: opus
max_turns: 60
integrity: when_graded
allowed_tools:
  - WebSearch
  - "Bash(python3:*)"
  - "mcp__quintet__*"
mcp_extra: [playwright]
state_snapshot: research_recent
intake:
  - id: question
    type: text
    prompt: What's the question?
    required: true
    from_chat: true
  - id: output
    type: multi
    prompt: What do you want back?
    options: [brief, lit_review]
    default: [brief]
  - id: depth
    type: single
    options: [quick, standard]
    default: standard
  - id: citation_style
    type: single
    options: [APA, Chicago]
    default: Chicago
    skip_if: "memory.default_citation_style"
  - id: integrity
    type: integrity
    default: 1
    max: 2
    skip_if: "task.graded != 'yes'"
schedules:
  - name: weekly
    cron: "0 7 * * 1"
    task: Run the weekly sweep.
    model: sonnet
outputs_dir: ok-full
board: research_library
---
# Role
You are Full.

---
name: jobz
description: AI job search command center -- evaluate offers, generate CVs, scan portals, track applications
user_invocable: true
args: mode
argument-hint: "[scan | deep | pdf | oferta | ofertas | apply | batch | tracker | pipeline | contacto | training | project | interview-prep | update]"
---

# jobz -- Router

## Mode Routing

Determine the mode from `{{mode}}`:

| Input | Mode |
|-------|------|
| (empty / no args) | `discovery` -- Show command menu |
| JD text or URL (no sub-command) | **`auto-pipeline`** |
| `oferta` | `oferta` |
| `ofertas` | `ofertas` |
| `contacto` | `contacto` |
| `deep` | `deep` |
| `pdf` | `pdf` |
| `training` | `training` |
| `project` | `project` |
| `tracker` | `tracker` |
| `pipeline` | `pipeline` |
| `apply` | `apply` |
| `scan` | `scan` |
| `batch` | `batch` |
| `patterns` | `patterns` |
| `followup` | `followup` |

**Auto-pipeline detection:** If `{{mode}}` is not a known sub-command AND contains JD text (keywords: "responsibilities", "requirements", "qualifications", "about the role", "we're looking for", company name + role) or a URL to a JD, execute `auto-pipeline`.

If `{{mode}}` is not a sub-command AND doesn't look like a JD, show discovery.

---

## Discovery Mode (no arguments)

Show this menu:

```
jobz -- Command Center

Available commands:
  /jobz {JD}      → AUTO-PIPELINE: evaluate + report + PDF + tracker (paste text or URL)
  /jobz pipeline  → Process pending URLs from inbox (data/pipeline.md)
  /jobz oferta    → Evaluation only A-F (no auto PDF)
  /jobz ofertas   → Compare and rank multiple offers
  /jobz contacto  → LinkedIn power move: find contacts + draft message
  /jobz deep      → Deep research prompt about company
  /jobz pdf       → PDF only, ATS-optimized CV
  /jobz training  → Evaluate course/cert against North Star
  /jobz project   → Evaluate portfolio project idea
  /jobz tracker   → Application status overview
  /jobz apply     → Live application assistant (reads form + generates answers)
  /jobz scan      → Scan portals and discover new offers
  /jobz batch     → Batch processing with parallel workers
  /jobz patterns  → Analyze rejection patterns and improve targeting
  /jobz followup  → Follow-up cadence tracker: flag overdue, generate drafts

Inbox: add URLs to data/pipeline.md → /jobz pipeline
Or paste a JD directly to run the full pipeline.
```

---

## Context Loading by Mode

After determining the mode, load the necessary files before executing:

### Modes that require `_shared.md` + their mode file:
Read `modes/_shared.md` + `modes/{mode}.md`

Applies to: `auto-pipeline`, `oferta`, `ofertas`, `pdf`, `contacto`, `apply`, `pipeline`, `scan`, `batch`

### Standalone modes (only their mode file):
Read `modes/{mode}.md`

Applies to: `tracker`, `deep`, `training`, `project`, `patterns`, `followup`

### Modes delegated to subagent:
For `scan`, `apply` (with Playwright), and `pipeline` (3+ URLs): launch as Agent with the content of `_shared.md` + `modes/{mode}.md` injected into the subagent prompt.

```
Agent(
  subagent_type="general-purpose",
  prompt="[content of modes/_shared.md]\n\n[content of modes/{mode}.md]\n\n[invocation-specific data]",
  description="jobz {mode}"
)
```

Execute the instructions from the loaded mode file.

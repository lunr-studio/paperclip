## Lunr Capital Setup Plan

This note adapts the `lunr_paperclip_starter_pack` guidance to the current Lunr Paperclip deployment.

### Recommended target state

- Keep one Paperclip deployment.
- Run two separate companies inside it:
  - `Lunr Studio`
  - `Lunr Capital`
- Treat Paperclip as the control plane, not the final investment decision maker.
- Keep all Capital work recommendation-only until a human board chair approves it.

### Key changes from the current setup

- Move Capital operations from public internet exposure to `authenticated + private` access behind Tailscale or VPN.
- Keep Lunr Studio and Lunr Capital in separate companies to avoid cross-company information bleed.
- Create a dedicated Capital workspace repo at `/srv/lunr/lunr-capital-os`.
- Use `codex_local` for phase-one Capital agents, with strict secret references and read-only external data access.
- Encode capital governance through issue types, documents, comments, and `in_review` status rather than native autonomous approvals.

### Phase plan

#### Phase 0: Foundation

- Reconfigure the deployment for private network access.
- Create the `Lunr Capital` company and preserve `Lunr Studio` as a sibling company.
- Create the `lunr-capital-os` repo and workspace skeleton.
- Seed knowledge, policy, template, and skills files from the starter pack.

#### Phase 1: Controlled pilot

Launch only these four Capital agents first:

- `capital-president`
- `research-forensics-head`
- `chief-risk-officer`
- `investment-ops-head`

Pilot goals:

- validate issue flow
- validate comment style
- validate board-review workflow
- validate deterministic data ingestion

#### Phase 2: Full Capital org

After 1 to 2 weeks of clean logs and usable workflows:

- add the remaining six Capital personas
- enable recurring timed workflows
- add richer reporting, board packs, and capital decision routines

### Non-negotiable control rules

- No agent may execute trades, transfer funds, sign documents, or send binding instructions to third parties.
- Capital-affecting work must stop at `in_review`.
- Every recommendation must cite evidence or memo support.
- Related-party and Studio matters must go through a Capital/Studio firewall process.
- CRO and GC objections block progress until acknowledged by the board or documented policy.

### Core build sequence

1. Private deployment posture for Capital workflows
2. Separate `Lunr Capital` company
3. `lunr-capital-os` repo and workspace
4. Seeded knowledge files, skills, prompts, and issue templates
5. Strict secrets, read-only tools, and agent budgets
6. Four-agent pilot
7. Deterministic ETL and normalized data files
8. External schedulers for precise daily, weekly, and monthly invokes
9. Full ten-agent rollout
10. Acceptance test and board operating rehearsal

### What success looks like

- `capital-president` wakes, reviews work, and posts a clean management update
- `chief-risk-officer` can block a capital issue and escalate it
- `investment-ops-head` can draft trade tickets without broker write access
- daily and weekly recurring workflows run from external timers
- the board can review recommendations without any agent becoming the final decision maker

### Recommended GitHub project structure

The `Lunr Capital Setup` project should track:

- infrastructure and network posture
- company separation and workspace creation
- governance and issue-model implementation
- pilot-agent rollout
- data ingestion and scheduler work
- final acceptance testing

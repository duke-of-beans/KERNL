# YUMA — Testing & Validation Subsystem
## "If it survives Yuma, it survives anything."

**Version:** 2.0.0
**Date:** 2026-05-19
**Location:** KERNL → testing-tools.ts, brain-tools.ts, git-tools.ts, parallel-gates.ts
**NIGHTSHIFT:** Pass 14 Enrichment 5 + Morning Briefing Yuma section
**Status:** COMPLETE — All phases built, integrated, and verified.

---

## Architecture

### Schema (5 tables)
- `test_specs` — Test definitions per project
- `test_runs` — Run history with health scores and prophecies
- `test_worlds` — Fixture definitions for isolated test data
- `mutation_results` — WHETSTONE code mode output tracking
- `test_baselines` — Benchmark reference points with tolerance

### Tools (19 total)

**Spec Management:** test_define, test_list, test_remove, test_contract
**Execution:** test_run, test_precommit
**Health:** test_health (project readiness = features × 0.6 + yuma × 0.4)
**Baselines:** test_baseline
**Chains (E2E):** test_chain
**Test Worlds:** test_world_define, test_world_setup, test_world_teardown, test_world_list
**AI Generation:** test_generate (Anthropic API → unit tests)
**Preserved:** sys_run_tests, sys_validate_tools, sys_check_health, sys_benchmark

### Integration Points

**smart_commit** — `verifyTests` parameter (default: true). Blocks commit on test failure.
**five_gate_check** — 'tests' gate (6th gate). Reports specs, health score, band, tier breakdown.
**WHETSTONE** — `mode: "code"` for intelligent mutation testing via Anthropic API.
**dev_branch** — Create/switch dev branches. Main stays stable.
**merge_to_main** — Yuma-gated merge. Tests must pass before dev merges to main.
**NIGHTSHIFT Pass 14** — Enrichment 5: writes Yuma Health to each project's STATUS.md.
**Morning Briefing** — Yuma Health section shows per-project scores at session start.

### Test Suites

| Project | Specs | Status |
|---------|-------|--------|
| KERNL   | 30    | 29 pass, 1 skip |
| SHIM    | 3     | 3 pass |
| VIGIL   | 3     | 3 pass |

### Workflow

```
1. dev_branch(action: "create")     → Safe workspace, main untouched
2. Build features, smart_commit      → Yuma gates every commit
3. test_run / test_health            → Verify coverage and health
4. merge_to_main                     → Yuma gates the merge
5. Main stays stable. Always.
```

---

## Activation
Restart KERNL MCP server. All tools and integrations activate immediately.

# Portfolio Intelligence Architecture
**Date:** 2026-04-23
**Origin:** Session synthesis — Jenna Zinn conversation + BRAIN-GRAPH-01 sprint
**Status:** Active design document — not yet fully implemented

---

## The Core Insight

This portfolio is not a collection of projects.
It is a distributed cognitive operating system with a human thalamus (David) routing between nodes.

The force multiplication between projects is not coincidental — it is structural.
The portfolio itself has the same architecture as HIRM:
- Φ (integration) = connections between projects — now measurable via brain_edges
- R (recurrence) = output of each project feeding back into others
- D (differentiation) = cross-domain coverage generating cross-domain signal
- C(t) = Φ × R × D — portfolio intelligence, growing as edges grow

---

## Two Distinct Levels of Learning (Both Currently Broken)

### Project-Level Learning (partially addressed)
Learnings that belong to a project: SHIM patterns, EoS quality reports,
STATUS.md friction items, architectural decisions. These can theoretically
be manually documented. They still mostly evaporate, but at least there's
a mechanism to capture them if someone decides to.

### Session-Level Learning (completely broken — the urgent gap)
The granular, in-the-moment signals that happen WITHIN conversations:
- Bugs hit and resolved (stack traces, ENOENT causes, API failures)
- Wrong commands corrected (syntax errors, path issues)
- Environment quirks discovered (PowerShell intercepts, PATH problems)
- Tool failures and their resolutions
- Minor friction that individually seems irrelevant but accumulates

These can NEVER be manually captured — they're too granular and they
occur mid-flow. They must be captured automatically at the moment of
occurrence or they are gone permanently.

Multiply one session's worth of these signals across hundreds of sessions
and dozens of projects: enormous institutional memory that currently
evaporates completely after every conversation ends.

---

## The Architecture

```
CURRENT STATE
  CONTINUITY checkpoint fires
    → saves state to continuity DB (crash recovery only)
    → stops
  brain.db gets nothing

PROPOSED STATE
  CONTINUITY checkpoint fires
    → saves state to continuity DB (crash recovery — unchanged)
    → signal extraction pass (50ms, non-blocking):
        session_error     — stack traces, ENOENT, "not recognized", HTTP 5xx
        session_friction  — wrong syntax corrected, path not found, failed then succeeded
        session_decision  — architectural choice, pattern selected
        session_pattern   — approach that worked cleanly
        environment_quirk — machine-specific behavior (PS intercepts, PATH issues)
    → writes each signal as observation to brain.db
        entity edge → relevant project (detected from context)
        entity edge → relevant tool/technology (detected from context)
        tags: [session_signal, signal_type, session_id, severity]
    → cumulation check: same signal seen before? → increase edge weight
    → done — never delays the session
```

---

## The Cumulation Mechanic

This is where it becomes powerful.

Single occurrence: logged, searchable, minor weight.
Same signal twice (same entity, same category): edge weight increases.
Five occurrences: escalates to standing warning.
Ten occurrences across multiple projects: becomes environmental truth,
injected at session start automatically.

This is how experienced teams work. They've seen the failure before.
They give you the warning before you hit the wall.
The AI currently has no mechanism for this. Live CONTINUITY ingestion
is the mechanism.

Example in practice:
- Session 1: PowerShell intercepts node commands (GregLite sprint)
- Session 7: Same issue, different project
- Session 15: Third occurrence
→ brain.db now surfaces at session start: "this environment has caused
  PowerShell/node friction 15 times across 8 projects — use cmd shell"

---

## Full Ingestion Stack (What Feeds brain.db)

```
CONTINUOUS (live, automatic)
  CONTINUITY checkpoints → session signals → brain.db
  KERNL auto_checkpoint → decisions → brain.db (via KERNL-BRAIN-01)

NIGHTLY (NIGHTSHIFT-01)
  STATUS.md files (all projects) → status observations → brain.db
  MORNING_BRIEFING.md friction items → friction observations → brain.db
  SHIM pattern discoveries → pattern observations → brain.db
  EoS quality reports (all projects) → quality observations → brain.db
  KERNL checkpoint decisions → decision observations → brain.db

SESSION-TRIGGERED
  brain_remember (KERNL tool) → manual observations → brain.db
  GregLite "Remember This" → manual observations → brain.db
```

---

## Projects as Producers AND Consumers

Every project is both:

PRODUCER: Its learnings, patterns, bugs, friction, decisions flow INTO brain.db
CONSUMER: brain_recall_graph surfaces relevant cross-project intelligence
          from brain.db into its sessions

The graph edges make this non-trivial. A session on ContentStudio that
touches quality gates surfaces HIRM composite scoring history (crosslink edge).
A session on Throwbak that touches auth surfaces GregLite's Supabase
auth learnings (inferred edge from shared tech stack).

---

## The Enabling Infrastructure (Build Order)

1. BRAIN-GRAPH-01 ✅ COMPLETE (2026-04-23)
   brain_edges table, graph traversal, callRecallWithGraph, 47 seed edges

2. KERNL-BRAIN-01 📋 QUEUED
   brain tools in KERNL: briefing, recall, recall_graph, remember, status
   Closes the "brain/briefing() never worked" bug

3. CONTINUITY-BRAIN-01 📋 QUEUED (highest leverage for session learning)
   Live signal extraction on every checkpoint → brain.db writes
   Non-blocking, automatic, no new user behavior
   The mechanism that turns session intelligence into institutional memory

4. NIGHTSHIFT-01 📋 QUEUED (in GregLite backlog)
   Extend nightly cron to ingest from SHIM, EoS, MORNING_BRIEFING.md
   Project-level learning pipeline

5. TESSRYX × brain.db 📋 FUTURE
   Constraint-optimal context assembly given token budget
   "Given this task and remaining context, load optimal observation set"

6. EoS Portfolio-Wide 📋 FUTURE
   Run Eye of Sauron on ALL projects, not just GregLite
   Cross-project quality intelligence

7. SCRVNR → Throwbak edge 📋 FUTURE
   Voice layer connected to life record
   Currently disconnected despite obvious relationship

---

## Sprint Specs

### CONTINUITY-BRAIN-01

**What:** Extend CONTINUITY MCP to write session signals to brain.db on checkpoint
**Where:** D:\Projects\continuity-mcp
**Trigger:** Every continuity_checkpoint call, automatically
**Files:**
  - New: src/brain-writer.ts — direct brain.db access via better-sqlite3
  - New: src/signal-extractor.ts — lightweight heuristic signal detection
  - Modify: src/index.ts or checkpoint handler — wire extraction + write on checkpoint

**Signal Extractor logic:**
  - Scan checkpoint context for error signatures (ENOENT, stack traces, HTTP 5xx)
  - Scan for correction patterns ("actually", "instead use", "fixed by")
  - Scan for decision language ("decided", "chose", "going with")
  - Scan for friction markers (command not found, path issues, wrong syntax corrected)
  - Each signal → observation with entity edges + tags

**Cumulation logic:**
  - Before writing new observation, query for similar existing ones (FTS5 match)
  - If match found with same entity edge: increment weight on edge, append to obs
  - If no match: create new observation
  - Threshold: 5+ occurrences same signal type → add 'standing_warning' tag

**Acceptance criteria:**
  - Every checkpoint writes ≥1 observation to brain.db (even if just "checkpoint taken")
  - Error signals captured automatically without any user action
  - brain_recall "npm install" surfaces historical npm friction from all projects
  - Non-blocking: checkpoint completes in <100ms regardless of brain.db write speed
  - Degrades gracefully if brain.db unavailable

**Reference:**
  - D:\Projects\GregLite\sidecar\src\brain-client.ts (write pattern)
  - D:\Projects\continuity-mcp\src\ (existing structure)
  - D:\Meta\brain.db (target database)

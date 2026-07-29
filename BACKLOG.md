# KERNL — BACKLOG
Last Updated: 2026-07-28

## P0 — Critical (regression in flight)

- [ ] **Turso migration must land as an EMBEDDED REPLICA, not direct remote reads.**

      The bootstrap records 76 `db.prepare` calls being repointed from local
      SQLite to Turso. Today KERNL reads brain.db off local disk in microseconds.
      Measured on 2026-07-28 against CORTEX, which already reads Turso remotely:
      **~1,000ms fixed cost per round trip** (the Tranche adapter returned ZERO
      results in 999ms; queries themselves run in ~70ms).

      If this migration lands naively, every `brain_recall`, `brain_briefing`,
      `pm_read_file` and every other tool call inherits ~1 second. That is a
      measured regression currently being built, not a missed optimization.

      FIX: libSQL embedded replica. Local file syncs in the background, reads
      served at memory speed, writes go upstream to Turso.

        createClient({
          url: 'file:local-brain.db',
          syncUrl: envRequire('TURSO_DATABASE_URL'),
          authToken: envRequire('TURSO_AUTH_TOKEN'),
        })

      SEQUENCING: do NOT test this here first. CORTEX is the low-stakes case and
      is already measured — prove the approach there, then KERNL inherits
      something known to work. KERNL matters most, which is exactly why it should
      not be the experiment.

      Pattern doc: `D:\Meta\STANDING_COPY_PATTERN.md`

## P1 — High Priority
- [ ] Verify GitHub remote is current and all commits pushed
- [ ] Audit chrome-config.json paths and username (DKdKe not David)

## P2 — Normal Queue
- [ ] Create CHANGELOG.md documenting version history
- [ ] Register in portfolio standard — CLAUDE_INSTRUCTIONS.md

## P3 — Eventually
- [ ] Evaluate KERNL session data for LIFELOG integration

## Completed
- [x] MCP server operational — session management, checkpoints, decision logging
- [x] Chrome config wired to Claude Desktop

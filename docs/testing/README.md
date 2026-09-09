# Testing

> _Last updated: 2026-04-28_

VERA has four automated test tiers plus a manual pre-event procedure.
This section indexes the per-tier guides and shared references.

---

## The pyramid

```
                ┌────────────────────────────┐
                │    Smoke checklist         │  manual, pre-event
                └─────────────┬──────────────┘
                ┌─────────────┴──────────────┐
                │  Visual + a11y (nightly)   │  cron, e2e.yml
                └─────────────┬──────────────┘
                ┌─────────────┴──────────────┐
                │  Perf (concurrent jury)    │  workflow_dispatch only
                └─────────────┬──────────────┘
                ┌─────────────┴──────────────┐
                │  E2E (Playwright)          │  6 projects
                └─────────────┬──────────────┘
                ┌─────────────┴──────────────┐
                │  pgTAP (SQL layer)         │  RLS + RPC + triggers
                └─────────────┬──────────────┘
                ┌─────────────┴──────────────┐
                │  Edge Fn (Deno)            │  harness-mocked
                └─────────────┬──────────────┘
                ┌─────────────┴──────────────┐
                │  Unit (Vitest)             │  jsdom + mocks
                └────────────────────────────┘
```

The base of the pyramid runs in seconds, the top runs in minutes. PR
CI runs unit + Edge + pgTAP + the `admin` / `other` / `maintenance`
E2E projects. Visual + a11y projects run nightly via cron (and on
`workflow_dispatch`). Perf is `workflow_dispatch` only, triggered
manually before load-sensitive releases. The smoke checklist is a
manual procedure before live evaluation events.

---

## Per-tier guides

| Guide | Scope |
| --- | --- |
| [unit-tests.md](unit-tests.md) | Vitest, `qaTest()`, `qa-catalog.json`, mock-Supabase pattern, coverage thresholds. |
| [e2e-tests.md](e2e-tests.md) | Playwright, Page Object Models, fixtures, auth helpers, skip policy. **6 projects:** `admin`, `other`, `maintenance`, `a11y`, `visual`, `perf`. |
| [sql-tests.md](sql-tests.md) | pgTAP suite — RLS isolation, RPC contracts, trigger behavior. |
| [edge-function-tests.md](edge-function-tests.md) | Deno test runner + harness for Edge Functions. |
| [smoke-checklist.md](smoke-checklist.md) | Pre-jury-day manual checklist. |

---

## Reference docs

| File | Contents |
| --- | --- |
| [target-test-architecture.md](target-test-architecture.md) | Canonical "what should our tests look like" design spec — source of truth for layer responsibilities and patterns. |
| [periods-test-pattern.md](periods-test-pattern.md) | Worked example for an admin feature: dual-layer security tests, realtime tests, layer-by-layer file inventory. |
| [page-test-coverage-map.md](page-test-coverage-map.md) | Per-feature test inventory with status (🟢/🟡/🔴) and remaining gaps. |
| [page-test-mock-audit.md](page-test-mock-audit.md) | Mock discipline — when mocking the page's own hook is a tautology vs. when it is justified. |

---

## Commands cheat sheet

```bash
# Unit
npm test                          # watch mode
npm test -- --run                 # CI-style single run
npm run test:coverage             # with coverage HTML

# E2E (projects: admin / other / maintenance / a11y / visual / perf)
npm run e2e                       # admin + other + maintenance (default)
npm run e2e -- --project=admin    # admin shard only
npm run e2e -- --project=a11y     # accessibility smoke (nightly cron job)
npm run e2e -- --project=visual   # visual regression  (nightly cron job)
npm run e2e -- --project=perf     # concurrent-jury load (manual only)
npm run e2e -- --headed --workers=1 --grep "Login"

# SQL (pgTAP)
# See sql/tests/RUNNING.md — runs via local Postgres + psql

# Edge Functions
npm run test:edge                 # Deno test runner

# Drift / coverage sentinels
npm run check:db-types
npm run check:rls-tests
npm run check:rpc-tests
npm run check:edge-schema
npm run check:guideline-coverage  # 40-item test-writing.md sentinel
npm run check:no-native-select
npm run check:no-nested-panels
```

---

## Testing rules (cross-tier)

1. **Tests are not optional.** Every new feature ships with the
   matching tier of test. A feature with no test does not merge.
2. **Drift sentinels are not optional.** A red sentinel blocks merge.
   Either fix the drift or update the sentinel and document why.
3. **CI is not the smoke check.** CI uses ephemeral environments;
   smoke runs against the real one. Both are required before a
   high-stakes event.
4. **Tautologies are bugs.** A test that mocks X and asserts X teaches
   nothing. See [page-test-mock-audit.md](page-test-mock-audit.md).
5. **`.skip()` decays.** A skipped test must include a reason comment
   and a tracking issue. Otherwise, fix it or delete it.

---

## CI / nightly schedule

| Workflow | Trigger | Includes | Reports |
| --- | --- | --- | --- |
| `ci.yml` | every push + PR | unit, build, edge, migrations, pgTAP, drift sentinels | `allure-report-NNN`, `excel-report-NNN`, `test-results-raw-NNN` |
| `e2e.yml` | every push + PR | admin (sharded), other, maintenance | `excel-e2e-<job>-NNN`, `playwright-results-*` |
| `e2e.yml` (cron) | nightly 02:00 UTC | a11y, visual (in addition to PR matrix) | `excel-e2e-a11y-NNN`, `excel-e2e-visual-NNN` |
| `perf.yml` | `workflow_dispatch` | concurrent-jury load test | `excel-perf-NNN`, `perf-results-NNN` |
| `edge-fn-smoke.yml` | daily 06:00 UTC | smokes deployed Edge Fns against vera-demo | `edge-fn-smoke-NNN` |
| `demo-db-reset.yml` | daily 00:23 UTC | regenerate demo seed + post-seed assertions; uses session pooler and retries transient PostgreSQL failures | `demo-db-reset-NNN` |
| `db-backup.yml` | monthly | pg_dump of vera-prod | `db-backup-NNN` |

Schedule cron runs unblock the visual + a11y suite without paying the
cost on every push. Most CI artifacts retain for 30 days; raw
playwright bundles for 14.

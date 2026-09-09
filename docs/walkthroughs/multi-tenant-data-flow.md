# Multi-Tenant Data Flow

> _Last updated: 2026-05-03_

**Scenario.** A tenant-admin opens the Jurors page and a juror row renders.
This walkthrough traces the round-trip — from the admin's mouse click in
the browser to the row appearing on screen — paying attention to every
boundary where tenant scope is enforced.

For the model, see [architecture/multi-tenancy.md](../architecture/multi-tenancy.md).
For the *why*, [decisions/0003-jwt-admin-auth.md](../decisions/0003-jwt-admin-auth.md).

---

## Actors and layers

```
┌──────────────────────────────────────────────────────────────────┐
│ Browser                                                           │
│   ┌────────────────┐    ┌──────────────────┐    ┌──────────────┐ │
│   │ JurorsPage.jsx │ →  │ adminApi.fetch...│ →  │ supabaseClient│ │
│   └────────────────┘    └──────────────────┘    └──────┬───────┘ │
└──────────────────────────────────────────────────────────────────┘
                                                          │ HTTPS
                                                          │ + Authorization: Bearer <JWT>
                                                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ Supabase (Kong → PostgREST → Postgres)                            │
│   ┌────────────┐    ┌──────────────┐    ┌──────────────────────┐ │
│   │ Kong gate  │ →  │ PostgREST    │ →  │ rpc_admin_list_jurors│ │
│   │ (JWT auth) │    │ (route)      │    │   ↳ _assert_tenant_  │ │
│   └────────────┘    └──────────────┘    │     admin()          │ │
│                                         │   ↳ SELECT FROM jurors│ │
│                                         │     filtered by RLS   │ │
│                                         └──────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## Step-by-step

### 1. Admin clicks Jurors → page mounts

[`JurorsPage.jsx`](../../src/admin/features/jurors/JurorsPage.jsx) mounts.
The orchestrator hook `useManageJurors` schedules a fetch.

- **No client cache.** Every mount re-fetches. See
  [decisions/0002-no-client-caching.md](../decisions/0002-no-client-caching.md).

### 2. API wrapper called

`useManageJurors` calls into the admin API surface at
[`src/shared/api/index.js`](../../src/shared/api/index.js), which delegates to
the modular admin wrappers under [`src/shared/api/admin/`](../../src/shared/api/admin/) —
never `supabase.rpc()` directly from the page. The API surface is the only
place where field-mapping (UI ↔ DB) happens; see
[`src/shared/api/fieldMapping.js`](../../src/shared/api/fieldMapping.js).

### 3. Supabase client picks the project

[`src/shared/lib/supabaseClient.js`](../../src/shared/lib/supabaseClient.js)
is a Proxy: every method call resolves the current environment from
[`environment.js`](../../src/shared/lib/environment.js) (pathname-based;
[ADR 0001](../decisions/0001-pathname-based-routing.md)) and dispatches to
either the prod or demo client.

The request is sent with the admin's Auth JWT in the `Authorization`
header. The JWT is short-lived; Supabase Auth refreshes it transparently.

### 4. Kong validates the JWT

The Supabase project's Kong gateway validates the JWT signature and
expiration before the request reaches PostgREST.

- **ES256 caveat:** some project configurations reject ES256 in Kong; for
  Edge Functions that hit this, the workaround is `verify_jwt: false` +
  custom auth ([architecture/edge-functions-kong-jwt.md](../architecture/edge-functions-kong-jwt.md)).
- For RPCs (this flow), Kong's default JWT validation is the right path.

### 5. PostgREST routes to the RPC

PostgREST receives the request and dispatches to `rpc_admin_list_jurors`
(defined in `sql/migrations/006a_rpcs_admin.sql`).

The RPC's first action:

```sql
DECLARE
  v_org_id uuid := _assert_tenant_admin();
BEGIN
```

`_assert_tenant_admin()`:

- Reads `auth.uid()` from the JWT.
- Looks up `memberships` where `user_id = auth.uid()`.
- If `organization_id IS NULL` → returns `NULL` (super-admin scope, RLS
  bypass on tenant tables).
- If `organization_id IS NOT NULL` → returns that uuid (tenant scope).
- If no row → raises `permission_denied`. Request is rejected; no audit row
  written.

### 6. SELECT executes under RLS

The RPC body queries `public.jurors`:

```sql
SELECT id, name, affiliation, ...
FROM   jurors
WHERE  period_id = $1;
```

But because RLS is on:

```sql
CREATE POLICY tenant_select_own ON jurors
  FOR SELECT USING (
    organization_id = current_admin_org_id()
    OR is_super_admin()
  );
```

…Postgres adds the policy predicate transparently. A tenant-admin's query
sees only their tenant's rows; a super-admin sees all.

The `current_admin_org_id()` helper reads the same `auth.uid()` →
`memberships` chain that `_assert_tenant_admin()` did. JWT and RLS use the
same source of truth.

### 7. Response shape

The RPC returns rows shaped for the admin UI. The API wrapper applies
field-mapping (e.g. `juror_name` → `name`, `affiliation_full` →
`affiliation`) and returns to the hook.

### 8. Page renders

`JurorsPage` renders the table. Mobile portrait flips to card layout per
the canonical card-section / card-tap rules in `CLAUDE.md`.

---

## What can go wrong, and where the system catches it

### A tenant-admin tries to read another tenant's jurors

- **Where caught:** RLS policy on `jurors`. The query returns zero rows;
  the page renders "No jurors yet".
- **Test:** [`e2e/security/tenant-isolation.spec.ts`](../../e2e/security/tenant-isolation.spec.ts) +
  [`sql/tests/rls/jurors_isolation.sql`](../../sql/tests/rls/jurors_isolation.sql).

### The page tries to call a non-existent RPC

- **Where caught:** PostgREST returns 404; API wrapper throws.
- **Drift sentinel:** `npm run check:rpc-tests` fails CI if any module under
  `src/shared/api/admin/` references an RPC that no longer exists.

### The DB type contract drifts

- **Where caught:** `npm run check:db-types` regenerates `db.generated.ts`;
  if the committed schema declarations differ from the regenerated ones, CI
  fails. The generated PostgREST version metadata is normalized because it is
  not part of the database type contract.

### A new isolated table is added without RLS

- **Where caught:** `npm run check:rls-tests` requires a paired pgTAP
  isolation test under `sql/tests/rls/`. CI fails.

### The Edge Function path (instead of RPC) hits Kong's ES256 rejection

- **Where caught:** `execution_time_ms ≈ 0` in
  `get_logs service=edge-function` indicates Kong pre-rejection.
- **Fix:** the function uses `verify_jwt: false` + custom
  `auth.getUser(token)`; reference implementations in
  `platform-metrics/index.ts` and `admin-session-touch/index.ts`. See
  [architecture/edge-functions-kong-jwt.md](../architecture/edge-functions-kong-jwt.md).

---

## Variants

### Juror flow (no JWT, token-bound)

A juror's RPC chain is identical in shape but uses
`rpc_juror_*(token, ...)` instead. The token carries the period (and
therefore the tenant); `current_juror_org_id()` resolves scope from the
token, not from `auth.uid()`. Same RLS, different resolver.

### Edge Function with custom auth

When Kong's JWT gate is sidestepped (`verify_jwt: false`), the function
itself runs `auth.getUser(token)`, looks up `memberships`, and uses the
service role for the actual DB ops — but only after confirming membership.
The pattern is documented in
[architecture/edge-functions-kong-jwt.md](../architecture/edge-functions-kong-jwt.md).

---

## Related

- [architecture/multi-tenancy.md](../architecture/multi-tenancy.md)
- [architecture/edge-functions-kong-jwt.md](../architecture/edge-functions-kong-jwt.md)
- [decisions/0001-pathname-based-routing.md](../decisions/0001-pathname-based-routing.md)
- [decisions/0003-jwt-admin-auth.md](../decisions/0003-jwt-admin-auth.md)
- [tenant-onboarding.md](tenant-onboarding.md)

---

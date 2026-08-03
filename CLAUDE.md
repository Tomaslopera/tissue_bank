# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TissueBank — a tissue/implant matching system for a tissue bank, connecting requesting doctors with available donor tissue inventory. This repo is currently a **frontend-only demo/prototype**: plain HTML/CSS/JS with no build step, no package manager, and no real backend. It's meant to be opened directly in a browser (open `Index.html`) or served as static files.

There is no test suite, linter, or build tool configured. To "run" the app, just open `Index.html` in a browser (or serve the directory with any static file server).

## Filename case mismatch (important)

The actual files are capitalized (`Index.html`, `App.js`, `Data.js`, `Styles.css`), but `Index.html` references them in lowercase (`<link href="styles.css">`, `<script src="data.js">`, `<script src="app.js">`). This works on case-insensitive filesystems (macOS default, Windows) but **will 404 on case-sensitive filesystems** (Linux, most static hosts, git servers depending on config). Keep this in mind if deploying or debugging "why don't my styles/scripts load" on a non-Mac environment — either rename the files to lowercase or fix the references, don't just add new files assuming the current setup is portable.

## Architecture

The app simulates a full backend entirely in the browser, structured so it can be swapped for a real backend later with minimal changes to the UI layer:

- **`Schema.sql`** — the target Postgres/Supabase schema (tables: `app_user`, `doctor_profile`, `patient`, `ips`, `donor`, `implant`, `request`, `match`, `assignment`, `dispatch`, plus views `v_request_status` and `v_request_pipeline`). This is what the real database will look like once a backend exists — it is not yet wired to anything.
- **`Data.js`** — an in-memory fake backend, loaded as an IIFE that exposes `window.DB` and `window.API`:
  - `DB` holds one array per `Schema.sql` table, with the same column names, acting as "current DB state" for the session (resets on page reload).
  - `API` is the **only** interface the UI is allowed to touch. Every `API` method mirrors the shape a real backend endpoint will eventually have — when a real backend exists, only the *bodies* of these functions change (array manipulation → `fetch()` calls); callers in `App.js` should not need to change.
  - Getters always return deep clones (`clone()`), never live references — this forces all mutation through `API` write methods, mimicking real API semantics.
  - Two fields (`patient.numero_identificacion`, and `codigo_visible` on `request`/`implant`) exist only in `Data.js` for demo realism and are **not** in `Schema.sql` yet (marked `DEMO:` in comments) — they're known gaps to reconcile when the schema is extended.
  - Request status is not stored — it's derived in `getRequestStatus()` by walking `match → assignment → dispatch` for a request, mirroring the `v_request_status` SQL view. If you change the status-derivation logic, update it in both places (JS here, SQL view in `Schema.sql`) to keep them consistent.
  - "Add new" forms (new request, new donor) intentionally start empty — they're meant to be filled live during a demo. Everything else is pre-seeded to look like an in-progress system.
  - Donor/implant dates are generated relative to "today" (`iso(offsetDays)`) rather than fixed, so the demo (expiring donors, past deliveries, etc.) always looks coherent regardless of when it's run.
- **`App.js`** — the render/controller layer. No framework: plain DOM manipulation.
  - Every visible panel has a `render*()` function that clears its container and rebuilds it from `API` state — there is no partial/diffed rendering.
  - `refreshAll()` is the master re-render, called after every mutation (`enviarSolicitud`, `aprobarAsignacionUI`, `etiquetarDespachoUI`, etc.) and once after login. When adding a new mutation, call `refreshAll()` afterward (or add the new render function to it) rather than trying to update the DOM in place.
  - `currentUser` is global module state set on login (`entrarComo`) and cleared on logout; most render functions early-return if it's null.
  - Role-based UI is done via `document.body.dataset.role` plus `nav-doctor-only` / `nav-admin-only` CSS classes in `Index.html` — there's no route guarding beyond CSS visibility, since this is a trusted single-user demo, not a security boundary.
- **`Index.html`** — all panels and modals live in one file as always-present (but hidden via CSS `.active` toggling) `<div>`s, switched with `showPanel()` / `showTab()` / `openModal()` / `closeModal()`. There is no templating — new panels/modals are added as raw HTML blocks and wired to `App.js` by element `id`.
- **`Styles.css`** — single global stylesheet, CSS custom properties for the color system (`--teal`, `--rust`, `--navy`, etc.), used consistently for status badges (`badge-green`, `badge-red`, `badge-amber`, etc.).

## Domain flow (why the panels are ordered this way)

The core pipeline a request moves through, reflected in both the sidebar panels and the status machine in `Data.js`/`Schema.sql`:

1. **Solicitantes** (doctor) — doctor submits a tissue request (`request`), starts "en fila".
2. **Recomendaciones** (admin) — system/admin detects a compatible `implant` and creates a `match` (score + per-dimension compatibility), sends it to the doctor.
3. Doctor reviews the match from their own **Solicitantes** panel ("Match por aprobar") — approves or rejects.
4. **Asignaciones** (admin) — admin gives final approval on a doctor-approved match, creating a `dispatch` and marking the `implant` as assigned.
5. **Etiquetado** (admin) — admin prints a label and moves the dispatch through `por_etiquetar → en_camino → entregado`.

Two roles only: `doctor` (sees only their own requests/matches) and `admin` (sees everything, referred to as "Edison"/"Isabel" in in-app copy — no per-admin scoping). Doctor accounts are provisioned by the admin from the **Doctores** panel, which generates a one-time-shown temporary password (`API.users.create` / `resetPassword`).

## Reference docs

`docs/` contains architecture diagrams (`Architecture.drawio`, `AWS Architecture.drawio`, `Global Architecture.drawio` — open with diagrams.net) and `Tissue.pdf`, describing the intended production architecture (API Gateway + Lambda + RDS/Supabase per the comments in `Data.js` and `Schema.sql`) that this frontend demo is standing in for.

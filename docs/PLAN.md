# Implementation plan

This plan covers the work that produced Tackle v0.1 and what comes next. Each phase lists its deliverables and the checks that close it. For the reasoning behind the architecture, see [DESIGN.md](DESIGN.md).

**Status legend:** ✅ done · 🔜 next · 💡 later

## Goal and scope

A tracker that a team of 2–15 people can start using within minutes and that never feels slow.

**v0.1 must have:** tasks with the usual properties, a board, a list, simple sprints, comments and history, notifications, real-time collaboration, keyboard control, invites, and self-hosting with one process and one file.

**Explicit non-goals for v0.1:** custom fields, permission schemes, multiple workspaces per server, time tracking, Gantt charts, integrations.

**Quality bar:**
- reads and navigation never wait for the network
- writes appear instantly
- the client stays under 70 KB gzipped
- works on a phone
- light and dark themes
- English and Russian

---

## Phase 0: Research and decisions ✅

- [x] Review comparable products: Linear, Plane, Taiga, Kanboard/Lavagna/Planka, GitHub Projects, Jira. Conclusions are in [DESIGN.md](DESIGN.md#what-we-looked-at).
- [x] Pick the architecture: local-first client (whole workspace in memory), optimistic writes, SSE for live updates.
- [x] Pick the stack:
  - Node 22 with the built-in `node:sqlite`, so no native builds
  - Hono for the HTTP layer
  - Preact with signals for the UI
  - Vite to build the client and esbuild to bundle the server into one file
- [x] Fix the domain model: projects with keys, workspace-wide statuses in five categories, Linear's priority scale, labels, per-project sprints.

**Exit check:** the stack runs in the target environment (verified that `node:sqlite` works on Node 22.13+ and all packages install from npm).

## Phase 1: Foundation ✅

- [x] Repository scaffold: `package.json` scripts, strict TypeScript, Vite config, dev runner (`scripts/dev.mjs`), server bundler with asset pre-compression (`scripts/build-server.mjs`).
- [x] SQLite layer (`server/db.ts`):
  - versioned migrations
  - WAL mode
  - cached prepared statements
  - nested transactions with after-commit hooks
  - row mappers
- [x] Shared types and constants (`shared/`): entities, the event protocol, default statuses and labels (including Russian), helpers for mentions, checklists and slugs.

**Exit check:** `npm run typecheck` is clean and the database migrates from empty.

## Phase 2: Server API ✅

- [x] **Auth.**
  - First-run setup wizard endpoint.
  - Sign-in and sign-out with scrypt password hashes; only a hash of each session token is stored.
  - `HttpOnly` + `SameSite=Lax` session cookies.
  - Sign-in rate limiting.
  - Single-use invite links and password reset links.
  - Admin and member roles, deactivating members.
- [x] **Tasks.**
  - Create with client-generated ids and per-project numbering.
  - Patch, bulk patch, soft delete and restore.
  - Labels can be added and removed incrementally.
  - Automatic `startedAt` / `completedAt`.
  - Fractional ordering, renormalised when positions get too close.
- [x] **History.** Activity log that merges consecutive edits of the same field by the same person; comments with edit and delete.
- [x] **Notifications.**
  - Kinds: assigned, mention, comment, status.
  - The actor is never notified about their own action.
  - Repeated unread status changes on one task collapse into one item.
- [x] **Sprints.**
  - Create, edit and start, with only one active sprint per project.
  - Complete with carry-over to a planned sprint, a new sprint or the backlog; the sprint's stats are frozen.
  - Delete.
- [x] **Workspace.** Projects (archive, delete), statuses (reorder; deletion requires a replacement status for its tasks), labels, profile, JSON export.
- [x] **Real-time.**
  - SSE hub with heartbeats.
  - Each event carries the id of the tab that caused it, so that tab can skip its own echo.
  - Events are delivered only after the transaction commits.
  - Per-user channels for notifications.
- [x] **Hardening.** Strict input validation, an Origin check on writes, CSP and security headers, SPA fallback, immutable caching for hashed assets.
- [x] Demo seed (`npm run seed`) with a realistic workspace.

**Exit check:** API tests pass for auth, tasks, notifications, sprints, workflow and real-time rollback.

## Phase 3: Client core ✅

- [x] Store of signals with derived lists (`src/store/data.ts`).
- [x] Optimistic actions with in-flight tracking and rollback (`src/store/actions.ts`).
- [x] SSE sync with reload on reconnect (`src/store/sync.ts`).
- [x] Router with link interception and the `?task=` side panel.
- [x] Hotkey engine: key sequences, modal layers, physical key codes so shortcuts work on any keyboard layout, only ⌘K active inside text fields.
- [x] i18n:
  - typed keys
  - Russian plural forms
  - Russian loaded as a separate chunk
- [x] Safe Markdown renderer with checklist toggling, task references and mentions.
- [x] Pure view logic (filter / sort / group / position) with unit tests.
- [x] Design tokens:
  - light and dark themes
  - Inter with the Cyrillic subset
  - responsive layout and container queries
  - reduced motion support

## Phase 4: Views and interactions ✅

- [x] App shell: sidebar with projects and unread badge, mobile drawer, connection indicator, splash and error states.
- [x] Board: drag and drop with pointer events (mouse, and long-press on touch), auto-scroll, quick add per column, point totals per column.
- [x] List: grouping by status, assignee, priority, sprint or label; collapsible groups; drag between groups; checkbox and range selection.
- [x] Filters and display options, remembered per view, with `/` to search.
- [x] Task panel:
  - inline title and description editing
  - properties grid
  - timeline of activity and comments
  - @mention autocomplete
  - previous / next task
  - copy link, ID and git branch name
- [x] Create-task dialog with property chips and a "create more" mode.
- [x] Command menu (⌘K): task search, contextual actions, navigation, preferences.
- [x] Pickers for status, priority, assignee, labels (with creating new ones), estimate, sprint and due date. They work for one task or many, from clicks, shortcuts or the command menu.
- [x] Bulk action bar; undo after deleting.
- [x] Sprints page:
  - active sprint card with progress and stats
  - burndown chart (palette checked with a validator)
  - planning view with drag and drop
  - completed sprints history
- [x] Inbox (all / unread, mark read and unread) and My tasks (assigned / created).
- [x] Settings: profile, theme and language, workspace, members and invites, projects, labels, workflow, data.
- [x] Auth screens: two-step setup, sign in, join, password reset.

## Phase 5: Quality ✅

- [x] Unit tests: Markdown (XSS cases included), view logic, shared helpers.
- [x] API tests (`node:test` + `app.request`): 34 tests in total across unit and API.
- [x] Playwright end-to-end tests, 5 scenarios:
  - creating a task from the keyboard and dragging it across the board
  - changing properties with shortcuts and the command menu
  - two users seeing each other's changes and mentions in real time
  - sprint planning by drag and drop
  - editing descriptions with checklists
- [x] Screenshot review: desktop and mobile, light and dark, English and Russian, first run on an empty database.
- [x] Fixes from that review:
  - autofocus for editors created after page load
  - text-editing shortcuts (⌘A, ⌘⌫) no longer act on tasks
  - real-time events wait for the transaction to commit
  - layout of the narrow main column when the panel is open
- [x] Bundle budget: about 60 KB gzipped for the main bundle, plus 6 KB for the Russian locale.

## Phase 6: Packaging and docs ✅

- [x] Multi-stage `Dockerfile` with only Node and the bundle at runtime, `docker-compose.yml`, health check.
- [x] README covering quick start, demo, configuration, backups and shortcuts; design notes; screenshots.

## Phase 7: Self-hosting on small hardware ✅

Goal: a Raspberry Pi serving a team of at least three people.

- [x] Load test: 2,000 tasks, 15 live tabs, 3 users × 10 edits/s, with zero errors.
  - Server cost: 2.8 ms of CPU per edit, about 100 MB of memory.
  - Full results are in [DEPLOY.md](DEPLOY.md#will-it-be-fast-enough).
- [x] Gzip compression for JSON responses: the initial load of 2,000 tasks drops from 1 MB to 80 KB. The event stream is left uncompressed.
- [x] The CSRF check uses `Sec-Fetch-Site`, so it keeps working behind reverse proxies that rewrite the `Host` header (nginx defaults).
- [x] Sign-in rate limiting uses the socket address. `X-Forwarded-For` is trusted only with `TRUST_PROXY=true`, so the header can't be spoofed to bypass the limit.
- [x] `node dist/server.mjs backup` writes a consistent `VACUUM INTO` snapshot while the server runs.
- [x] [DEPLOY.md](DEPLOY.md): hardware notes (ARM64/ARMv7), Node install, systemd unit (`deploy/tackle.service`), Tailscale / Caddy / Cloudflare Tunnel / nginx, backups, troubleshooting.

**Exit check:** 38 unit/API tests and 5 e2e tests pass. The bundle runs from a directory without `node_modules`.

---

## Next: v0.2 🔜

Ordered by value to a small team.

| # | Item | Notes |
| --- | --- | --- |
| 1 | **CI** | GitHub Actions: typecheck, unit/API tests, e2e in Chromium, Docker build. |
| 2 | **File attachments** ✅ | Done: attach files to a task (button, drag and drop, paste); screenshots pasted into descriptions and comments show inline. Stored on disk next to the database with a size limit (`MAX_UPLOAD_MB`), served only to signed-in users. |
| — | **Reviewer** ✅ | Done: a second person on a task who reviews the work. Notified like the assignee, has its own *My tasks → To review* tab, filter and `R` shortcut. |
| 3 | **Notifications outside the app** | Browser notifications for new inbox items, and an optional daily email digest via SMTP. |
| 4 | **Sub-tasks** | A parent link with a progress indicator. Checklists remain the lightweight option. |
| 5 | **Saved views** | Share a filter set via the URL and pin it to the sidebar. |
| 6 | **Import** | CSV import, plus importers from Trello and Linear exports. |

## Later 💡

- Personal API tokens and outgoing webhooks, then integrations: link tasks to GitHub/GitLab commits and PRs by task id in the branch name, which the "Copy git branch name" action already produces.
- Recurring tasks and due-date reminders.
- Sprint velocity chart across completed sprints, and a cumulative flow chart.
- An offline cache in IndexedDB with incremental sync (load only events since the last sync id) for larger workspaces.
- More languages (the i18n layer already supports lazily loaded locales).

## Known limitations and tech debt

- **Per-browser connection limit on plain HTTP.** Every open tab keeps one live connection, and browsers allow about six per site over HTTP/1.1. Serve over HTTPS (HTTP/2) or share one connection between tabs via a leader tab.
- **Single process.** The SSE hub and the rate limiter live in memory, so Tackle scales vertically, not horizontally. That is fine for the target team size.
- **Reconnects reload everything.** After a reconnect the client reloads the full snapshot. Incremental sync becomes worth it for workspaces of more than a few thousand tasks.
- **No list virtualization.** Lists render every row; consider virtualization above about 2,000 visible tasks.
- **Unpaginated limits.** The inbox shows the latest 200 notifications, and task timelines load in full.
- **Restart after rebuild.** The server reads `index.html` at startup, so restart it after rebuilding the client.
- **Experimental SQLite module.** `node:sqlite` is still marked experimental in Node 22. Track it and keep the `DB` wrapper as the only place that touches it.

## Release checklist

1. `npm run typecheck && npm test && npm run test:e2e` are green.
2. `npm run build`; the main chunk stays under 70 KB gzipped.
3. Smoke-test a fresh database (setup wizard) and the demo seed in both themes and languages.
4. Check that migrations apply on a copy of a real database.
5. Build and run the Docker image; check `/api/health`.
6. Tag the release and update the README if the configuration changed.

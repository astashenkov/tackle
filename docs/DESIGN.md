# Design notes

Why Tackle looks and works the way it does.

## What we looked at

| Product | What it gets right | Where it falls short for a small team |
| --- | --- | --- |
| **Linear** | Speed (local-first data, optimistic updates), keyboard-first UX, command menu, opinionated workflow, cycles | Hosted only, paid per seat |
| **Plane** (open source) | Closest self-hosted Linear clone: cycles, modules, views | Heavy to run (several services: Postgres, Redis, workers), less polished keyboard flow |
| **Taiga** | Real Scrum: sprints, burndown, velocity | Dated UI, many settings, multiple services |
| **Kanboard / Lavagna / Planka** | Lightweight, simple boards | No real sprints or notifications, old-fashioned or board-only UX |
| **GitHub Projects** | Free if code is on GitHub | Tied to GitHub issues, slow for non-developers, sprints are a custom field |
| **Jira** | Everything | The setup, permission schemes and settings Tackle exists to avoid |

Public breakdowns of Linear's architecture consistently point at the same things: keep the whole workspace in memory on the client, read locally, apply mutations optimistically, sync over a persistent connection, and make every action reachable from the keyboard. Tackle takes those ideas and keeps the deployment footprint of the lightweight tools.

## Principles

1. **Never wait for the network for reads.** Small teams have hundreds to a few thousand tasks — the whole workspace fits in memory. `/api/sync` returns a snapshot once; every view filters, groups and sorts locally (`src/lib/view.ts`, pure and unit-tested).
2. **Optimistic writes, server is the source of truth.** Mutations update the store immediately, then call the API (`src/store/actions.ts`). The server's response replaces the optimistic version unless more edits to the same entity are still in flight; on failure the change is rolled back with a toast.
3. **Live by default.** Each mutation is broadcast over Server-Sent Events. Events carry the id of the tab that caused them so it can skip its own echo. After a reconnect the client simply reloads the snapshot — simpler and more robust than replaying a log for a team-sized dataset.
4. **Keyboard-first, mouse-friendly.** One imperative picker system (`openPicker`) serves clicks, shortcuts and the command menu, so every property can be changed the same way everywhere and for one or many tasks. Shortcuts are read from physical keys (`KeyboardEvent.code`) so they work on Cyrillic layouts.
5. **Opinionated defaults, few settings.** Statuses belong to five fixed categories (backlog, unstarted, started, completed, canceled) that drive sprint math and filters; names and colors are editable. Priorities use Linear's fixed scale. No custom fields, no permission schemes — just admins and members.
6. **Boring, tiny infrastructure.** One Node process, one SQLite file (`node:sqlite`, no native build). The server bundles into a single file; Docker images contain only Node, that file and the static client assets.

## Notable details

- **Ordering** uses fractional positions (midpoint between neighbours) so drag and drop writes a single row; the server renormalises a project only when positions get too close.
- **History merging**: consecutive changes of the same field by the same person within five minutes are merged, and changes that cancel out disappear — the activity feed reflects intent, not every drag.
- **Notification hygiene**: you are never notified about your own actions; repeated unread status changes on one task collapse into one inbox item; mentioned people get a *mention* instead of a duplicate *comment* notification.
- **Recently completed**: closed tasks older than 14 days are hidden from boards and lists by default ("Completed: Recent" in Display), so the Done column doesn't grow forever.
- **Sprint completion** freezes the sprint's stats and moves unfinished work in one transaction.
- **Security**: scrypt password hashes, only token hashes stored for sessions, `HttpOnly` + `SameSite=Lax` cookies, a `Sec-Fetch-Site`/Origin check on writes that survives reverse proxies, a strict CSP, rate-limited sign-in, and a Markdown renderer that escapes everything and emits a fixed set of tags.
- **Accessibility & theming**: system/light/dark themes from one set of CSS tokens, focus trapping in dialogs, reduced-motion support, a screen-reader table behind the burndown chart. Chart colors were checked with a palette validator for contrast and color-vision deficiency separation.

## Data model

```
users ─┬─ sessions
       └─ invites (invite links & password resets)
projects ─┬─ sprints
          └─ tasks ─┬─ task_labels ── labels
                    ├─ comments
                    ├─ activity
                    └─ notifications ── users
statuses (workspace-wide, with a category)
```

## Not in v1 (on purpose, for now)

File attachments, email notifications, sub-issues (Markdown checklists cover most cases), custom fields, time tracking, GitHub/GitLab integration, webhooks, multiple workspaces per server. Each of these is a reasonable follow-up once a team asks for it.

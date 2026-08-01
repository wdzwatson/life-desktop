# LifeOS Startup Launchpad Design

**Date:** 2026-08-01
**Status:** Approved for implementation
**Scope:** Electron desktop startup experience after authentication

## Product Decision

LifeOS will add a dedicated `landing` screen named **Launchpad**. It is a fast, personalised entry point for a work session, not a marketing page and not a replacement for Dashboard.

Dashboard remains the information-dense overview. Launchpad answers one question at application start: **what should the user do now?**

The default startup preference is `daily`: show Launchpad on the first authenticated cold start each local calendar day, then restore the last useful screen on later launches. Users can select `always`, `daily`, or `resume` in Settings.

## Audience and References

The experience combines:

- Arc's return-to-context behaviour.
- Raycast's action-first entry point.
- Linear's restrained motion and information hierarchy.
- Things' focus on the next actionable item.

The visual goal is calm and premium. The UI must not use a video background, animated blur, particle system, or continually moving decoration.

## Information Architecture

```text
Authentication
  -> Launchpad (according to startup preference)
      -> Start today / resolve overdue work -> Tasks list
      -> Quick capture -> inline editor -> note or task
      -> New task -> existing task drawer
      -> Continue -> most recent useful module
      -> Dashboard -> existing overview
```

The left navigation and top bar stay available, so Launchpad never traps the user.

## Layout

The screen uses a two-column, full-height composition inside the existing content pane:

- **Poster zone:** 42-48% width on desktop, fixed visual aspect ratio, no nested card. It shows the user-selected poster or the bundled `hero.png` fallback.
- **Action zone:** a greeting, date, one recommendation, two primary actions, secondary actions, and a compact context row.
- **Responsive behaviour:** below 860px the poster becomes a fixed-height top band and the actions remain first in keyboard order.

There are never more than two visual primary actions. The recommended action is primary; Quick capture is the second primary action. Continue, New task, AI, and Dashboard are secondary actions.

## Recommendation Rules

Priority is deterministic and local:

1. One or more incomplete overdue tasks: recommend resolving overdue work.
2. One or more incomplete tasks due today: recommend starting today.
3. A stored recent context: recommend continuing it.
4. Empty workspace: recommend creating the first task.
5. Otherwise: recommend opening today's task list.

The compact context row displays counts and the latest useful item. It never blocks rendering while database queries run.

## Quick Capture

Quick capture opens an inline modal on top of Launchpad. It accepts a short title/body and exposes exactly two completion actions:

- Save as note: creates a Markdown note and opens Notes.
- Save as task: creates an active task due today and opens Tasks.

Escape cancels, focus enters the textarea, and submission is disabled for blank text. This provides a low-friction capture path without adding a separate data model.

## Startup Preference and Context

The persisted `launchpad` settings object contains:

- `startupMode`: `always | daily | resume`.
- `lastShownDate`: local `YYYY-MM-DD` value.
- `lastContext`: `{ screen, label, updatedAt }` for the last non-Launchpad screen.
- `posterVersion`: cache-busting version after a poster selection.

The context is deliberately lightweight. It records the latest module rather than exposing cross-module internal IDs that current views cannot universally restore.

## Poster Storage and Rendering Contract

User posters are selected through Electron's native file picker. The main process copies the selected image into `LifeOS/assets/landing-poster.<extension>` and serves it only through a new privileged `life-landing-poster://poster/current?v=<version>` protocol.

Supported file types: AVIF, JPEG, PNG, WebP. The protocol permits only GET/HEAD, validates the host/path, constrains the resolved path to the asset folder, supplies a strict MIME type, and emits private cache headers.

Renderer loading is a progressive chain:

1. The action zone renders immediately; poster dimensions are reserved with CSS `aspect-ratio`.
2. A bundled visual fallback is present from the first paint.
3. A custom poster is preloaded and only replaces the fallback after `Image.decode()`/`onload` succeeds.
4. Any selection, network-equivalent protocol, or decode failure keeps the fallback visible. No error state blocks actions or produces a blank poster rectangle.

No remote image URL, arbitrary local `file://` URL, or image data URL is stored in settings.

## Motion and Performance Budget

- The entrance timeline is at most 500ms. Action content enters first; the full poster may resolve later without delaying input.
- Transitions animate only `opacity` and `transform`.
- Hover feedback uses one small translate/scale adjustment, no continuous animation.
- The poster itself never receives animated filters, blur, canvas effects, or video playback.
- In `prefers-reduced-motion`, all entrance and hover motion becomes a short opacity change.
- Database loading uses independent compact skeletons; content never reflows after result arrival.

## Accessibility

- The page has a labelled main landmark and logical heading hierarchy.
- All actions use semantic buttons with visible focus states.
- The poster is decorative unless the user has given it descriptive metadata; it does not become a keyboard stop.
- The quick capture modal manages focus and supports Escape.

## Acceptance Criteria

1. After authentication, `daily` mode shows Launchpad at most once per local day; `always` and `resume` behave deterministically.
2. All actions are usable before a custom poster finishes loading or when it fails.
3. Selecting an allowed poster saves a copy in app data and displays it through the privileged protocol; cancellation and invalid input preserve the current poster.
4. Recommendation priority matches overdue, today, context, empty, then default rules.
5. Quick capture creates the requested task or note using the existing database contract.
6. App build, relevant unit tests, and lint complete successfully.

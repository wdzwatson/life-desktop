# Appearance System Atomic Tasks

**Parent design:** `docs/superpowers/specs/2026-08-24-appearance-system-design.md`

## AT-00: Archive Design and Task Plan

Create the parent design spec and this atomic task list under `docs/superpowers`. Commit them before implementation begins.

**Done when:** both documents are present, reviewed, and committed without code changes.

## AT-01: Appearance Domain Model

Add typed appearance presets, normalization helpers, legacy theme migration, body class/data-attribute application helpers, and focused unit tests.

**Done when:** unsupported settings normalize to safe defaults; legacy `Minimal`, `Dense`, `Card`, and `Dark Tech` map to new presets; tests pass.

## AT-02: Store Persistence and Body Application

Extend the Zustand app store with `appearance`, preset switching, advanced appearance updates, browser mock persistence, Electron settings persistence, and safe body-class application. Preserve the legacy `theme` API for compatibility.

**Done when:** initial config applies the normalized appearance, preset changes persist, and existing callers do not break.

## AT-03: Global Skin, Layout, Motion, and Loading Tokens

Add CSS classes and variables for all seven skins, seven layout modes, motion intensity classes, engine classes, and loading styles. Refine shell, command palette, screen transitions, skeletons, buttons, cards, tabs, drawers, and status bar through tokens.

**Done when:** changing body appearance classes visibly changes the shell and shared primitives without module-specific rewrites.

## AT-04: Animation Engine Runtime and Dependencies

Install and wire optional animation libraries: Anime.js, Mo.js, dotLottie React, Velocity.js, and Popmotion while reusing existing GSAP. Add a thin runtime helper for engine metadata and safe dynamic imports.

**Done when:** dependencies install, TypeScript can resolve runtime helpers, unavailable browser motion falls back to CSS, and build passes.

## AT-05: Settings and Topbar Controls

Replace the legacy four-theme picker with preset cards and advanced controls. Update topbar theme cycling to cycle appearance presets. Add Chinese and English locale strings.

**Done when:** users can apply all presets and override individual axes from Settings; topbar cycles presets; all new strings are localized.

## AT-06: Loading and Transition Application

Apply appearance-aware loading/transition behavior to screen loading, screen progress, command palette status, toast entry, and common long-running action affordances. Include reduced-motion behavior.

**Done when:** loading styles reflect the selected preset and reduced motion removes nonessential animation.

## AT-07: Final QA and Regression Sweep

Run lint, focused tests, full test runner where practical, production build, and desktop/mobile rendered QA for the appearance controls. Review diffs against the parent design and confirm no unrelated files were modified.

**Done when:** verification passes, the settings appearance controls remain usable on narrow viewports, and the final commit records the completed appearance system.

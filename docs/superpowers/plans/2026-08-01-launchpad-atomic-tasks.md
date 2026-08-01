# Launchpad Atomic Tasks

**Parent design:** `docs/superpowers/specs/2026-08-01-launchpad-design.md`

## AT-01: Persisted Launchpad Domain

Add typed Launchpad settings helpers and tests for startup-mode validation, local date comparison, and recommendation precedence. Extend the Zustand store to decide the initial authenticated screen and to persist the last non-Launchpad context.

**Done when:** browser fallback and Electron settings both retain safe defaults; no unsupported startup mode is accepted.

## AT-02: Secure Poster Boundary

Create a main-process protocol handler for the selected poster and IPC for selecting/removing it. Copy only allowed image types to the LifeOS app data asset folder.

**Done when:** protocol traversal, invalid method, and unsupported extensions are rejected; renderer receives only a versioned protocol URL.

## AT-03: Launchpad View and Data Model

Build the lazy-loaded Launchpad screen. Query compact task and recent-module data without delaying initial render. Implement recommendation states and safe fallback content.

**Done when:** overdue/today/empty/context states render and actions navigate to existing screens.

## AT-04: Progressive Poster and Motion

Add fixed-size poster rendering with a bundled fallback, decoded custom-poster replacement, failure retention, reduced-motion support, and compositor-only entrance/hover motion.

**Done when:** actions remain interactive while poster loads and no layout shift or blank poster surface is observable.

## AT-05: Quick Capture and Existing Workflows

Implement an accessible quick-capture modal that saves a Markdown note or a due-today task and routes to the owning module. Reuse the existing task creation event for New task.

**Done when:** blank submissions are prevented; both operations persist through existing database APIs.

## AT-06: Settings, Locales, and Navigation

Expose startup preference and poster selection/reset under Appearance. Add Chinese and English copy. Add a sidebar entry for returning to Launchpad.

**Done when:** settings update immediately and all introduced visible strings are localised.

## AT-07: Verification and Commit

Run focused tests, lint, TypeScript build, and the complete test runner where practical. Review diff against the parent design, then stage and commit only implementation/docs files.

**Done when:** verification passes and the commit records the completed feature.

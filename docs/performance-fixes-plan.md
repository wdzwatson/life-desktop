# PDF Reader Performance Fixes - Atomic Task Plan

## Overview
This document breaks down the 4 performance issues into atomic, verifiable tasks. Each task must:
1. Be implemented
2. Self-reviewed against requirements
3. Pass `npm run build` (TypeScript + Vite)
4. Be committed with a descriptive message
5. Only then proceed to the next task

---

## Issue 1: Auto-flip pauses on header hover (React state thrashing)

### Root Cause
`isReaderHeaderVisible` state + `setState` on every mouse enter/leave causes re-renders that compete with RAF auto-scroll loop.

### Tasks

**T1.1** - Remove `isReaderHeaderVisible` state declaration and all `setIsReaderHeaderVisible` calls from JSX event handlers.
- File: `src/views/Books.tsx`
- Verify: Header no longer uses React state for visibility.

**T1.2** - Add pure CSS `:hover` rules in `Books.css` to control header opacity/visibility.
- Target: `.book-reader__header-sensor:hover + .book-reader__header, .book-reader__header:hover`
- Must use `opacity` + `pointer-events` transition (no layout thrash).
- Verify: Hover still shows/hides header smoothly without JS.

**T1.3** - Remove unused `isReaderHeaderVisible` import/usage if any remains.
- Self-review: Ensure no dead code left.

---

## Issue 2: Blank flash when switching layout mode or resizing reader

### Root Cause
`pdfLayoutMode` change triggers immediate heavy `<Page>` re-renders without any loading guard. No `startTransition` used.

### Tasks

**T2.1** - Add `isPdfTransitioning` boolean state (default false).
- Also add `lastLayoutModeRef` if needed for comparison.

**T2.2** - Create `handlePdfLayoutModeChange(mode)` helper that:
  - Sets `isPdfTransitioning = true`
  - Wraps `setPdfLayoutMode(mode)` in `startTransition`
  - Uses double RAF to turn off transitioning flag after paint.

**T2.3** - Add a semi-transparent overlay `<div className="pdf-transition-overlay">` that shows `{t('books.pdf_reloading')}` when `isPdfTransitioning`.
- Style it to cover only the PDF content area (not chrome).

**T2.4** - Update the two places where `setPdfLayoutMode` is called directly (layout mode buttons) to use `handlePdfLayoutModeChange` instead.

**T2.5** - Verify that the overlay appears briefly and content does not go blank.

---

## Issue 3: TOC drawer expansion is janky / delayed

### Root Cause
- Grid column change + ResizeObserver fires synchronously
- All page elements re-measured
- No `contain` isolation
- TOC list always in DOM even when closed

### Tasks

**T3.1** - Change TOC drawer positioning from `gridColumn` manipulation to `transform: translateX(...)` + `transition`.
- Keep the drawer always in the same grid cell.
- Use `is-open` class to toggle `transform`.

**T3.2** - Make the TOC page list (`pdfPageIndexes.map(...)`) render **only** when `isTocDrawerOpen === true`.
- This avoids mapping 100+ buttons on every render when closed.

**T3.3** - Add CSS `contain: layout style paint;` to `.book-reader__side-drawer`.

**T3.4** - Delay the `readerMainWidth` ResizeObserver callback by one frame when drawer state changes (use a guard ref).

**T3.5** - Verify expansion feels instant and does not cause main content reflow.

---

## Issue 4: Continuous + auto-play stutters when viewport crosses page boundary

### Root Cause
Every RAF frame may call `setCurrentPageIndex` → triggers re-render of virtual window → heavy `<Page>` mount/unmount.

### Tasks

**T4.1** - Add `lastSyncedPageRef = useRef(currentPageIndex)` to track last time we pushed state during auto-play.

**T4.2** - Inside the `animate` function of auto-play (scroll mode):
  - Keep `currentPdfPageIndexRef` as the source of truth (already done).
  - Only call `setCurrentPageIndex` + `setReadingProgress` when:
    - Page index changed **AND**
    - At least 400ms since last sync **OR** the delta >= 2 pages.
  - Wrap the state update in `startTransition`.

**T4.3** - Reduce `PDF_CONTINUOUS_OVERSCAN` from 4 to 2 when `isAutoPlaying` is true (or pass it dynamically to the map).

**T4.4** - Ensure progress bar and TOC highlight still update correctly (they read from `currentPageIndex`).

**T4.5** - Test: Start auto-play in scroll mode, scroll through many pages, verify no visible stutter at page boundaries.

---

## Execution Rules

1. Implement **exactly one atomic task** per turn.
2. After edit: run `npm run build` (or `npx tsc -b && vite build`).
3. If build fails → fix immediately, do not commit.
4. Self-review checklist (must pass):
   - No TypeScript errors
   - No regression in existing functionality
   - Change is minimal and focused
   - Commit message follows: `perf(reader): <task-id> <short description>`
5. Only after green build + review → `git add -A && git commit -m "..."`.
6. Then move to next task.

Start with T1.1.
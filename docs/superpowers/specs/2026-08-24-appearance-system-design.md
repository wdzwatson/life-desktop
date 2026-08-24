# LifeOS Appearance System Design

**Date:** 2026-08-24
**Status:** Approved for autonomous implementation
**Scope:** Renderer-wide visual skins, shell layouts, motion engines, and loading styles

## Product Decision

LifeOS will replace the current single-axis `theme` switcher with a composable appearance system:

- **Skin:** color, material, typography mood, radius, shadow, and background treatment.
- **Layout:** shell geometry, navigation density, command emphasis, and focus/inspector modes.
- **Motion:** duration, easing, page transition personality, hover feedback, and reduced-motion behavior.
- **Loading:** module loading skeletons, progress indicators, long-task feedback, and engine-specific visual treatment.

The system must support one-click presets and advanced per-axis overrides. Presets are the user-facing default path; advanced controls allow users to mix one preset's skin with another preset's layout or motion style.

This is not a marketing redesign. The app remains a local-first productivity workspace. The goal is to make daily use smoother while providing several distinctive showcase-grade modes.

## Preset Set

LifeOS will ship seven named appearance presets:

| Preset | Skin | Layout | Motion Engine | Loading Style | Intent |
| --- | --- | --- | --- | --- | --- |
| Aurora Flow | Aurora Glass | Command Center | GSAP + Lottie | Lottie Flow | Showcase default candidate for launch, command palette, and AI surfaces |
| Cyber Console | Cyber Console | Inspector Layout | Anime.js + GSAP | Terminal Scan | Deep work command mode with staggered text/list motion |
| Paper Studio | Paper Studio | Focus Canvas | Lottie + CSS | Paper Skeleton | Notes/books/read-write mode with calm paper-like transitions |
| Neo Minimal | Neo Minimal | Classic Shell | Velocity.js + CSS | Precision Skeleton | Fast default productivity mode with restrained movement |
| Pulse Desk | Pulse Desk | Compact Dense | Popmotion | Pulse Bars | Task/status workflow with springy progress and completion feedback |
| Orbit OS | Orbit OS | Spatial Dashboard | Mo.js + GSAP | Particle Burst | Experimental, memorable module switching and completion feedback |
| Monolith Pro | Monolith Pro | Dense Workspace | Anime.js + Velocity.js | Matrix Rails | Power-user dense workspace with high contrast and fast transitions |

## Skin Direction

- **Aurora Glass:** translucent panels, cool dark glass, violet/cyan accents, soft edge glow, restrained blur.
- **Cyber Console:** near-black surfaces, neon green/cyan rails, terminal-style metadata, scanline loading.
- **Paper Studio:** warm paper background, ink-like text, low contrast dividers, soft shadows, long-reading comfort.
- **Neo Minimal:** white/gray precision UI, blue accent, minimal elevation, strong typography hierarchy.
- **Pulse Desk:** balanced light surface, coral/blue/green accents, status-driven cards, visible progress energy.
- **Orbit OS:** deep space-inspired surfaces, circular orbit motifs, radial accents, semi-transparent module panels.
- **Monolith Pro:** black/white hard-edged control surface, thin grid lines, dense spacing, editor-like contrast.

## Layout Modes

- **Classic Shell:** current left sidebar, topbar, content pane, and status bar with refined spacing.
- **Command Center:** navigation remains left, but topbar/search becomes more prominent and centered.
- **Focus Canvas:** content-first mode with subdued chrome and reduced side/top visual weight.
- **Inspector Layout:** reserves visual language for two/three-pane task, book, video, and settings workflows.
- **Compact Dense:** smaller padding, tighter rows, compact buttons, and low elevation.
- **Spatial Dashboard:** larger dashboard-style surfaces with layered overview rhythm.
- **Dense Workspace:** maximum information density for power users.

The first implementation will apply layout classes at shell level and global CSS tokens. Module-specific deep layout rewrites are follow-up work unless a task explicitly calls them out.

## Motion Engine Strategy

The app already uses CSS transitions and has GSAP installed. The new system will introduce a small motion runtime layer that can progressively activate optional engines without forcing every interaction through JavaScript.

- **CSS:** baseline for all presets and the reduced-motion fallback.
- **GSAP:** complex launch, command palette, page entrance, and high-polish timeline effects.
- **Anime.js:** text/list stagger, command results, dense table/list reveal.
- **Mo.js:** click bursts, completion feedback, celebratory micro-interactions.
- **Lottie/dotLottie:** long-running task feedback, empty states, OCR/video/backup progress.
- **Velocity.js:** fast compatibility-oriented panel and hover transitions.
- **Popmotion:** spring/tween primitives for progress, drag, and completion physics.

Engine selection must be data-driven. Presets declare a primary engine and optional secondary engine. The runtime may no-op when a library is unavailable, but installed presets should build cleanly.

## Settings UX

The Appearance settings page will expose:

1. Preset cards with label, description, engine, and compact color preview.
2. Advanced controls for Skin, Layout, Motion, Loading, and Motion Engine.
3. Immediate live preview by applying body-level classes/data attributes.
4. Persistence through existing Electron settings and browser mock settings.
5. Backward compatibility for legacy `theme` values.

Topbar will keep a one-click cycle action, but it will cycle full presets rather than only legacy color themes.

## Implementation Contract

- Existing screens must continue to render without routing changes.
- Body-level classes must be additive and controlled; no full `body.className` overwrite that discards unrelated classes.
- Appearance settings must be normalized before use and persisted with safe defaults.
- Existing `theme` settings must migrate into the closest new preset.
- CSS variables remain the primary styling API for views.
- Motion must respect `prefers-reduced-motion` and the explicit Reduced motion option.
- Third-party animation libraries must be loaded only where needed or kept behind thin helpers.

## Acceptance Criteria

1. Seven presets are available in settings and can be applied without reload.
2. The topbar cycles presets and preserves settings.
3. Skin, layout, motion, loading, and engine are persisted independently.
4. Existing legacy themes load into compatible presets.
5. Global shell, command palette, screen loading, buttons, tabs, cards, and status surfaces visually respond to presets.
6. Reduced motion disables nonessential motion regardless of preset.
7. TypeScript build, lint, and focused unit tests pass after each implementation task.
8. Each atomic implementation task is committed independently after verification.


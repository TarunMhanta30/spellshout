# Spellshout

A hands-free, voice-controlled, turn-based monster battle game for the browser. Built for a hackathon. **Every input is the player's voice** — menus, creature select, spell casting, and rematch. Nothing requires a keyboard, mouse, or controller.

## North Star

Accessibility first. A player who cannot use a keyboard, mouse, or controller must be able to play Spellshout fully, start to finish, by voice alone. Every feature decision is judged against that: if it can't be driven by voice, it isn't done.

## Stack

- **Build:** Vite
- **Language:** TypeScript
- **Engine:** Phaser 3
- **Deploy:** Vercel (later; build locally first)
- **Speech recognition:** Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`), **Chrome only**, language `en-IN`
- **Loudness:** Web Audio API (microphone input → analyser → amplitude)

> Target browser is Chrome. The Web Speech API is not reliably available elsewhere; don't spend effort on cross-browser speech fallbacks during the hackathon. Do degrade gracefully (clear message) when the API is absent.

## Core Mechanics

- **Speech recognition** — continuous listening in Chrome, `en-IN` locale. Transcripts drive all game state transitions.
- **Phonetic matching** — spells are matched phonetically, not by exact string, so accents and mispronunciations still cast the right spell. This is the heart of the accessibility promise.
- **Loudness → power** — the Web Audio API measures how loudly the player shouts. Loudness scales spell power, compared against a **calibrated per-player baseline** (not a hardcoded threshold), so quiet and loud environments are both fair.
- **Combos** — chaining two spells quickly triggers a combo for bonus effect.

## Architecture

Keep it modular. Clear seams between voice, audio, matching, and rendering so each can be built and tested on its own.

- **Voice module** — owns the Web Speech API: start/stop recognition, emit transcripts and recognition events. Knows nothing about spells or game rules.
- **Audio module** — owns the Web Audio API: mic capture, loudness measurement, calibration baseline. Emits a normalized loudness value.
- **Matcher module** — pure logic: given a transcript, phonetically match it to a known spell (or command) and return a confidence. No Phaser, no DOM, no API calls — unit-testable in isolation.
- **Phaser scenes** — presentation and game flow, kept separate from the modules above. Scenes consume events/values from the modules; they don't call the Web APIs directly.

Rule of thumb: the three modules are framework-agnostic and testable without Phaser; the scenes are the only place game-specific rendering and flow live.

## Scope — Tiered

Build tier by tier. Don't start a higher tier until the one below is a working, demoable slice.

### Tier 1 — Voice-only vertical slice (must-have)
- Complete voice-only flow: **title → battle → win or lose**, no non-voice input anywhere.
- **4–6 spells.**
- **One enemy.**
- Phonetic matching good enough that normal `en-IN` speech casts reliably.

### Tier 2 — Depth
- **Calibration** step (set the loudness baseline per player, by voice).
- **Loudness scaling** of spell power against that baseline.
- **Combos** (two spells chained quickly).
- **Enemy AI** (enemy takes turns / reacts).
- **Sound** (SFX / audio feedback).

### Tier 3 — Reach
- **Hindi and Marathi** spells (multilingual phonetic matching).
- **Online duel** (real-time player-vs-player over the network).

## Working Agreement

- Build in tier order; prioritize a working Tier 1 end-to-end over partial higher-tier features.
- Preserve the module boundaries above — resist putting Web API calls or game rules inside Phaser scenes.
- Every new interaction must be reachable by voice; if a feature introduces a non-voice-only path, that's a bug.
- Matcher logic stays pure and unit-testable.
- This is a greenfield project — no code exists yet. Confirm scope before scaffolding beyond what a tier needs.

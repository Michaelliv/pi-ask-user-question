# pi-ask-user-question

Interactive multi-choice question tool for [pi](https://github.com/badlogic/pi-mono). Let the model ask you clarifying questions with a polished TUI.

## Install

```bash
pi install npm:pi-ask-user-question
```

## What it does

Registers an `AskUserQuestion` tool the model can call to ask 1–4 questions with multiple-choice options. Each question supports:

- **Single select** — pick one option
- **Multi select** — toggle multiple options with checkboxes
- **Freeform "Other"** — always available, opens an inline editor
- **Tabbed navigation** — multiple questions shown as tabs with ←→ switching

## When the model uses it

The tool injects guidelines into the system prompt so the model knows to use it when:
- Requirements are ambiguous
- Multiple valid approaches exist
- It needs explicit user preference before proceeding

## UI

Single question:
```
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 Scope

 How should this be structured?

 → 1. Monorepo (Recommended)
       All packages in one repo with workspaces
   2. Separate repos
       One repo per package
   3. Other: type here...|

 ↑↓ navigate • enter select • esc cancel
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
```

Multiple questions show as tabs:
```
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 [ Scope ] │  Language  │  Testing

 ...
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
```

## Cancellation

Pressing `Esc` or `Ctrl+C` cancels and aborts the agent turn.

## License

MIT

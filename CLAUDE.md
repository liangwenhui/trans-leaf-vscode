# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trans-Leaf is a VS Code extension that uses AI for context-aware, format-preserving translation (Chinese ↔ English). It has two major subsystems:

1. **Translation Engine** — Analyzes file context, segments large documents, then translates concurrently while preserving all formatting (Markdown, HTML, code blocks, indentation, newlines).
2. **Agent System** — A sidebar chat with tool-calling capabilities (read/write/edit files, search, grep, run commands) powered by the same AI providers.

## Build & Development Commands

All commands run from the `trans-leaf-vscode/` subdirectory:

```bash
cd trans-leaf-vscode
npm install
npm run compile     # One-time build (esbuild → out/extension.js)
npm run watch       # Watch mode for development
npm run lint        # TypeScript type checking (tsc --noEmit)
```

Debug: Press **F5** in VS Code to launch the Extension Development Host.

There is no automated test framework. Verification is manual via F5 + the checklist in SPEC.md §19.

## Architecture

```
src/extension.ts                    # Entry point: registers commands, status bar, ChatView
├── commands/
│   ├── translateSelection.ts       # Selection translation (language detect → translate → replace)
│   └── translateFile.ts            # File translation (analyze → segment → concurrent translate → merge)
├── translator/
│   ├── types.ts                    # Translator interface (translate, translateWithPrompt, analyze)
│   ├── index.ts                    # Factory: creates translator by provider config
│   ├── mock.ts                     # MockTranslator (returns input unchanged, for dev/testing)
│   └── aiTranslator.ts            # AITranslator (Claude, OpenAI, DeepSeek API calls)
├── engine/
│   ├── analyzer.ts                 # AI-powered file analysis (type, domain, terminology)
│   ├── segmenter.ts                # Splits large files at semantic boundaries (~200 lines/segment)
│   ├── promptBuilder.ts            # Constructs system/user prompts with context and format rules
│   └── queue.ts                    # Concurrent translation queue with cancellation support
├── agent/
│   ├── agentLoop.ts                # Agent loop: LLM call → tool execution → iterate (max 20)
│   ├── llm.ts                      # LLMClient: provider-agnostic API calls with tool definitions
│   ├── toolRegistry.ts             # Dynamic tool registration
│   ├── types.ts                    # Agent message, tool, callback types
│   └── tools/                      # 8 tools: translateText, readFile, writeFile, editFile,
│                                   #   searchFiles, grepContent, listDirectory, runCommand
├── webview/
│   └── chatView.ts                 # WebviewView provider for sidebar chat (embedded HTML/CSS/JS)
├── lang/
│   └── detector.ts                 # Unicode-based CJK/ASCII ratio language detection
└── utils/
    ├── config.ts                   # VS Code workspace configuration helpers
    └── lock.ts                     # Global translation lock (prevents concurrent operations)
```

## Key Design Decisions

- **Zero runtime dependencies** — Only uses Node.js built-in APIs (fetch, fs, path, child_process). All `devDependencies` are build-time only.
- **Single undo step** — All document writes happen in one `editor.edit()` call so Ctrl+Z reverts the entire translation at once.
- **Provider-agnostic** — Claude, OpenAI, and DeepSeek share the same `Translator` interface. Claude uses `x-api-key` header + `system` field; OpenAI/DeepSeek use `Bearer` auth + messages array.
- **Mock provider** — Setting `transLeaf.provider` to `"mock"` enables testing without API keys (returns input unchanged).
- **Dangerous tool confirmation** — Agent tools that modify files (`writeFile`, `editFile`, `runCommand`) require explicit user confirmation via dialog.

## Provider API Differences

| Aspect | Claude | OpenAI / DeepSeek |
|--------|--------|-------------------|
| Auth header | `x-api-key: {key}` | `Authorization: Bearer {key}` |
| System prompt | Top-level `system` field | `{ role: "system" }` message |
| Response path | `result.content[0].text` | `result.choices[0].message.content` |
| Tool call format | `tool_use` content blocks | `tool_calls` array on message |

## Translation Pipeline (File)

`User Command → API Key check → Language detection → File analysis (AI) → Segmentation → Concurrent queue translation → Merge segments → Single editor.edit()`

Segmentation respects semantic boundaries: Markdown headers, blank lines, code block edges. Each segment ~200-300 lines max.

## Important Conventions

- Strict TypeScript (`strict: true` in tsconfig.json)
- esbuild bundles to CommonJS (`format: cjs`) for VS Code compatibility
- Target: Node 18+, VS Code 1.85+
- Configuration lives in VS Code workspace settings under `transLeaf.*` prefix
- Translation uses `temperature: 0.3`; file analysis uses `temperature: 0`
- API request timeout: 60s (translation), 120s (agent chat)

## Key Documentation

- `trans-leaf-vscode/SPEC.md` — Complete implementation specification with all technical decisions
- `trans-leaf-vscode/AGENT_IMPL_DETAILS.md` — Agent system implementation details, API format differences, tool specifications

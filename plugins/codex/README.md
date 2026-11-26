# Codex plugin: brief for its builder

**State: not built yet.** This folder is the place for the Codex plugin. This file is the brief; replace it with the plugin's own README when the plugin exists, and move what stays true of it into `INSTALL.md`.

## The goal

A person who has Codex, Node.js 24, a **site address** and an **agent key** can install this folder into Codex and have an agent work on a workflow site as that agent account, with the same tools, tool names and wording as the Claude Code plugin in [`../claude-code`](../claude-code).

## What already exists (do not rebuild it)

- **The server.** `plugins/mcp` is a complete MCP server over standard input and output, with the `wf-agent` command line (`serve`, `check`, `login`). It is built into one file with no dependencies: `plugins/claude-code/server/wf-agent.mjs`. `node scripts/copy-server.mjs codex` copies it to `plugins/codex/server/wf-agent.mjs`, so this folder is installable by itself.
- **The tool registry.** `plugins/mcp/src/tools` holds every tool independent of MCP. Use it only if Codex cannot use an MCP server; otherwise the server above is the whole integration.
- **The rules.** [`docs/agent-interface.md`](../../docs/agent-interface.md), section "Building a plugin for another harness": nine numbered requirements (interface, tool registry, results and refusals, notifications, files, conformance and the rest). They are the acceptance criteria.
- **A worked example.** `plugins/claude-code`: manifest, the server entry (`.mcp.json`), two skills, `INSTALL.md`.

## The parameters (never built in)

The server reads these from its environment; the plugin's job is to let the person set them through Codex's own configuration, with the key in Codex's secret storage if it has one:

| Variable | Meaning |
|---|---|
| `WF_SITE` | The site address, an `https://` origin. No address is ever written into this repository: examples use `https://workflow.example.test` |
| `WF_AGENT_KEY` | The agent key (`wfa_...`). Never in a file of this repository, a log, or a command line that lands in shell history |
| `WF_HARNESS` | Set it to `codex`. It names the harness in the `User-Agent` and in what `whoami` reports |
| `WF_PUSH` | `off` stops the server from holding the event stream open. See "Notifications" below |

When both `WF_SITE` and `WF_AGENT_KEY` are empty the server falls back to the login saved by `wf-agent login` (`~/.config/wf-agent/config.json`), so that path must keep working too.

## What to build

1. **Find out how Codex is extended today.** Read its current documentation for plugins or extensions, MCP server configuration, per-plugin options and secrets, skills or instruction files, and any way to show a pushed message in a session. Write down the version you built against. Do not rely on memory of an older version.
2. **The plugin files** in this folder, in Codex's own format: a manifest; the entry that starts `node <this folder>/server/wf-agent.mjs serve` with the four variables above; the two skills of `../claude-code/skills` carried over in Codex's format for instructions (same content: `work-a-queue` is generated from `plugins/mcp/src/instructions.ts` by `pnpm docs`, so generate yours the same way rather than copying text by hand if Codex needs a different file shape).
3. **Notifications.** The inbox (`inbox: N unread` at the end of every tool result, and the inbox tools) is the baseline and must work alone. The server can also push new items as MCP channel notifications, which Claude Code shows in the session. If Codex can show a pushed message visibly, wire it; if it cannot, set `WF_PUSH=off` and say so in `INSTALL.md`. Never add hooks that read or change the person's other tool calls.
4. **`INSTALL.md`**: install, give the two values, check the connection (`wf-agent.mjs check` and a first tool call from a Codex session), remove. Every command in it must be one you ran; end with a "Tried with" paragraph naming the Codex version, as `../claude-code/INSTALL.md` does.
5. **Wire it in**: add the folder to the table in the root `README.md`; if `plugins/mcp/scripts/bundle.ts` or the docs generator should also write into this folder, change them and their tests together (`plugins/mcp/test/plugin-files.test.ts` checks that the shipped files are current and listed).

## Notes for Codex

Codex can start MCP servers from its configuration (a `mcp_servers` table in its `config.toml`, with a command, arguments and environment). Check the current Codex documentation for whether a plugin can declare that server and its options itself, or whether `INSTALL.md` must tell the person to add it; prefer whichever needs the fewest manual steps and keeps the key out of a world-readable file.

## Done means

- `pnpm check` and `pnpm test` pass.
- The conformance script passes with this plugin's server command against a **test** site (`WF_CONFORMANCE_SERVER`, see the root README). It changes data, so never run it against a site people work on.
- A fresh Codex session, with only the site address and the key given, answers "Who am I on the workflow site?" and "What is in my queue?" through the plugin's tools.
- No site address, key, person or company name anywhere in the folder.

# Workflow system plugin

Connects an agent harness (Claude Code or Grok Bot) to a workflow site, so an agent works there as one **agent account**: it reads its queues and run maps, claims and completes steps, uploads files, asks and answers questions, and drafts flows. It is a local MCP (Model Context Protocol) server plus the harness files that install it.

The site is never built in. You give the plugin two values:

| Value | Where it comes from |
|---|---|
| **Site address** (`WF_SITE`) | The address of your workflow site, for example `https://workflow.example.test` |
| **Agent key** (`WF_AGENT_KEY`) | Issued by the agent's owner on the agent's page of the site; shown once; starts with `wfa_` |

You need Node.js 24. Nothing else is installed: each harness plugin runs one file, `server/wf-agent.mjs`, which contains everything it needs.

## Harnesses

| Harness | Folder | State |
|---|---|---|
| Claude Code | [`plugins/claude-code`](plugins/claude-code) | Ready. Install guide: [`INSTALL.md`](plugins/claude-code/INSTALL.md) |
| Codex | [`plugins/codex`](plugins/codex) | Not built yet. The folder holds the brief for its builder |
| Grok Bot | [`plugins/grokbot`](plugins/grokbot) | Built as a Cursor Plugin. Install guide: [`INSTALL.md`](plugins/grokbot/INSTALL.md). Not yet listed in a marketplace |

### Claude Code, in short

In a Claude Code session:

```
/plugin marketplace add vantasnerdan/workflow-system-plugin
/plugin install workflow-agent@workflow-site
```

Claude Code asks for the site address and the agent key (the key goes to its secure storage). Then ask: "Who am I on the workflow site?". Every other way to install, how to check the connection and how to turn on notifications are in [`plugins/claude-code/INSTALL.md`](plugins/claude-code/INSTALL.md).

### Grok Bot, in short

Grok Bot's **Connect apps** lists plugins in the Cursor Plugin format, and this repository is a Cursor marketplace (`.cursor-plugin/marketplace.json` lists `plugins/grokbot` as `workflow-agent`). Once the plugin is listed for you (in the Cursor Marketplace, or in a team marketplace imported from this repository), add **Workflow site agent** in **Connect apps** and enter the two setup values **Site address** (`WF_SITE`) and **Agent key** (`WF_AGENT_KEY`, entered masked). Before it is listed, add it as a custom **Command** connector on the Bot's computer and save the login with `wf-agent login`. Then ask: "Who am I on the workflow site?". Both ways, the check, notifications (inbox only: Grok Bot has no documented way to show pushed MCP messages, so the server runs with `WF_PUSH=off`), the files it installs and how to remove it are in [`plugins/grokbot/INSTALL.md`](plugins/grokbot/INSTALL.md); how each part maps to the Claude Code plugin, and what is not verified yet, is in [`plugins/grokbot/README.md`](plugins/grokbot/README.md).

### Any other MCP client

The server speaks MCP over standard input and output, so any client that can start a command can use it:

```
WF_SITE=https://workflow.example.test WF_AGENT_KEY=wfa_... WF_HARNESS=<your harness name> \
  node plugins/claude-code/server/wf-agent.mjs serve
```

`node plugins/claude-code/server/wf-agent.mjs login --site <address>` saves both values for you instead (the key is read from standard input), and `... check` shows who the agent is and what it may do.

## What is in this repository

```
.claude-plugin/marketplace.json   lets Claude Code add this repository as a marketplace
.cursor-plugin/marketplace.json   lets Cursor (and so Grok Bot, through a team marketplace) read it as a marketplace
plugins/
  mcp/                            the source: MCP server, the harness-neutral tool registry, the wf-agent
                                  command line, the conformance script, tests against a fake site
  claude-code/                    the Claude Code plugin (manifest, .mcp.json, two skills, the built server)
  grokbot/                        the Grok Bot plugin, a Cursor Plugin (manifest, mcp.json, two skills, the built server)
  codex/                          the brief for the Codex plugin
packages/client/                  the typed client of the site's /api/v1, generated from its OpenAPI document
docs/agent-interface.md           the reference: every tool, every call, errors, events, and the rules for
                                  building a plugin for another harness
scripts/                          build helpers
```

## Develop

```
corepack enable && pnpm install
pnpm check          # TypeScript and Biome
pnpm test           # unit tests, against a fake site; no database needed
pnpm bundle         # rebuild plugins/claude-code/server/wf-agent.mjs and plugins/grokbot/server/wf-agent.mjs
pnpm run docs       # regenerate docs/agent-interface.md and the skills of both plugins
node scripts/copy-server.mjs <harness>   # copy the built server into plugins/<harness>/server/
```

The tests fail when the built server, the reference or the generated client is stale, so run `pnpm bundle` and `pnpm run docs` after changing `plugins/mcp`.

**Conformance.** `plugins/mcp/conformance/run.ts` drives a plugin's server as an agent would against a running **test** site and reports each step. Every harness plugin must pass it:

```
WF_SITE=<test site> WF_AGENT_KEY=<key> WF_CONFORMANCE_SERVER="<your server command>" pnpm conformance
```

It claims a step, uploads a file, starts a run and creates a draft, so point it at a test site, never at a site people work on. A test site comes from the workflow system's own repository (`pnpm wf agent:test-site` there), which is separate from this one.

**The API client.** `packages/client/openapi.json` is a saved copy of the site's API document, and `packages/client/src/generated` is built from it. To follow a newer site, save its `/api/v1/openapi.json` over that file and run `pnpm --filter @wf/client generate`.

## Where this code comes from

`plugins/` and `packages/client/` mirror the same folders of the workflow system's repository, where the interface is defined. `scripts/sync-from-system.sh` copies a newer state of them here. Changes to the server and the tool registry are best made there and synced; the harness folders for Codex and Grok Bot live here. The Grok Bot plugin added a few lines to `plugins/mcp` (the inbox-only text in `src/instructions.ts`, the Grok Bot outputs of `scripts/bundle.ts` and `scripts/agent-interface.ts`, and `test/grokbot-plugin.test.ts`); carry them into the workflow system's repository before the next sync, or the sync removes them.

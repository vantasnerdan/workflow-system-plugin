# Install the workflow agent plugin into Grok Bot

You need two things: the **site address** (for example `https://workflow.example.test`) and the **agent key** (it starts with `wfa_`; the agent's owner issues it on the agent's page on the site and it is shown once). The plugin's server runs on the Bot's own computer and needs Node.js 24 there. Nothing else is installed: the plugin runs one file, `server/wf-agent.mjs`, which already contains everything it needs.

Below, `<plugin>` is this `grokbot` folder, and `<repository>` is the Git repository that holds it.

## 1. Add the plugin

There are two ways. The first is the one a plugin is meant to be installed by; the second works today without any listing.

**A. From a marketplace (Connect apps).** Grok Bot's **Connect apps** lists plugins in the Cursor Plugin format. This repository is a Cursor marketplace: `.cursor-plugin/marketplace.json` at its root lists this folder as the plugin `workflow-agent`. Once the plugin is listed for you, either in the public Cursor Marketplace or in a team marketplace that a Cursor Teams or Enterprise admin imported from `<repository>`, open **Connect apps**, find **Workflow site agent**, add it, and enter its two setup values:

| Setup value | Variable | What to enter |
|---|---|---|
| **Site address** | `WF_SITE` | The address of the workflow site, for example `https://workflow.example.test` |
| **Agent key** | `WF_AGENT_KEY` | The agent key. It is declared as a password (`writeOnly`, `format: password`), so it is entered masked and is not written into the plugin |

Both are optional, so that a login saved with `wf-agent login` (step 2) is enough. The host starts the server from `mcp.json`: `node ${CURSOR_PLUGIN_ROOT}/server/wf-agent.mjs serve` with `WF_SITE`, `WF_AGENT_KEY`, `WF_HARNESS=grokbot` and `WF_PUSH=off`.

**B. As a custom connector (no listing needed).** Put this folder on the Bot's computer, for example by asking the Bot to clone `<repository>`, then in the Grok Bot desktop app open **Connect apps**, choose **Add a custom connector**, pick the type **Command**, and enter:

| Field | Value |
|---|---|
| **Command** | `env` |
| **Arguments** | `WF_HARNESS=grokbot WF_PUSH=off node <plugin>/server/wf-agent.mjs serve` |

A custom command connector takes only a command and its arguments, so the site address and the key come from the saved login of step 2. Never put the key into the arguments: they are visible to anyone who can see the connector.

## 2. Give it the site address and the key

If you did not enter them as setup values (way B, or a host that did not ask), save them once on the Bot's computer. The key is read from standard input, so it never appears in a command line or in your shell history:

```
node <plugin>/server/wf-agent.mjs login --site https://workflow.example.test
```

Paste the key and press Enter, then Ctrl-D. The login is saved in `~/.config/wf-agent/config.json` (or under `$XDG_CONFIG_HOME`), readable only by its owner, and the plugin uses it whenever it is given no value. Type the key yourself on the Bot's computer; do not paste it into a chat.

## 3. Check the connection

```
env WF_HARNESS=grokbot WF_PUSH=off node <plugin>/server/wf-agent.mjs check
```

It names the agent, its owner, the site, its roles and limits, whether it may contact partners, whether it is paused, the interface version and how notifications reach it (`Notifications: inbox only (push is turned off with WF_PUSH=off) ...`). If the key is revoked or expired, the agent is paused, or the site cannot be reached, it says which one and who can change it, and exits with its own code (paused 5, key 4, site unreachable 3; not configured 2).

Then ask the Bot: "Who am I on the workflow site?". It answers with the `whoami` tool of the `workflow` server, the same lines as the check. Then ask "What is in my queue?": the agent's own queue is read with `queue_list`.

## 4. Notifications

Grok Bot has no documented way to show a message an MCP server pushes on its own, so this plugin runs the server with `WF_PUSH=off`: it never holds the event stream open. Nothing is lost. Every tool result ends with `inbox: N unread` when there is something new, the inbox (`inbox_read`, `inbox_ack`) keeps every notification in order, also those sent while the Bot was not working, and `changes_since` returns everything new since a time. To hear about new work without asking, ask the Bot for a routine, for example "Every weekday at 8:00, read my workflow inbox and tell me what is new". The routine calls the same tools; it adds nothing to the plugin.

## What the plugin adds, and how to remove it

It adds one MCP server (`workflow`) with the tools listed on the site's page "Agent interface", and two skills (`work-a-queue`, `author-a-flow`). It adds **no hooks**, rules, commands or agents: nothing reads, blocks or changes the Bot's own tool calls or outputs. Every action on the site is a tool call the Bot made.

The folder holds exactly these files:

| File | What it is for |
|---|---|
| `.cursor-plugin/plugin.json` | Plugin manifest: name, version, the two setup values (site address; agent key, entered masked), the skills folder and the MCP configuration. |
| `mcp.json` | Starts the MCP server `workflow`: `node server/wf-agent.mjs serve`, with the site address and key from the setup values, `WF_HARNESS=grokbot` and `WF_PUSH=off`. |
| `server/wf-agent.mjs` | The MCP server and the `wf-agent` command line in one file, built from `plugins/mcp`; needs only Node.js 24. |
| `skills/work-a-queue/SKILL.md` | Skill: how to work on this site (find work, claim, attempt, ask, complete). Generated from the shared instruction text. |
| `skills/author-a-flow/SKILL.md` | Skill: turning a description of a process into a draft flow written as text. |
| `README.md` | What the plugin is, and how it maps to the Claude Code plugin. |
| `INSTALL.md` | These install steps. |
| `biome.json` | Repository lint settings for the folder (keeps the built server file out of formatting). Not used by Grok Bot. |

Outside the folder the plugin writes only its own small local files on the Bot's computer: `~/.config/wf-agent/config.json` (after `wf-agent login`) and `~/.local/state/wf-agent/<site>/state.json` (the last `changes_since` time, unfinished uploads).

To remove it: remove **Workflow site agent** (or the custom connector) in **Connect apps**, and delete `~/.config/wf-agent/` and `~/.local/state/wf-agent/` on the Bot's computer if you used `login`. Grok Bot is then exactly as before.

## Tried with

On a Grok Bot computer (Linux, Node.js 24.22.1), 26 November 2026, against the repository's in-memory fake site (`plugins/mcp/test/fake-site.ts`), not a real test site: `wf-agent.mjs check` with nothing configured (exit 2), `wf-agent.mjs login --site <fake site>` with the test key on standard input, `env WF_HARNESS=grokbot WF_PUSH=off node <plugin>/server/wf-agent.mjs check` (named the agent and its owner; `Notifications: inbox only`), and an MCP client starting the server three ways: as `mcp.json` says with `${CURSOR_PLUGIN_ROOT}` and both setup values filled in, with the setup values left as unfilled placeholders and the saved login, and as the custom connector of way B. Each time it listed the 40 tools and answered `whoami` and `queue_list`. The conformance script with this plugin's server command passed every step the fake site builds (6 of 13; the other 7 need parts the fake site does not build, so it is not a full pass). `plugin.json` and the root `.cursor-plugin/marketplace.json` pass the validator and schemas of the official Cursor plugin repository (`cursor/plugins`, commit `b7b93c3`). Not yet tried: installing the plugin from a marketplace in Grok Bot (it is not listed in one), the **Add a custom connector** form itself, and the conformance script against a real test site.

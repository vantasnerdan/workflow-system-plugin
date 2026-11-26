# Workflow site agent plugin for Grok Bot

This folder is the Grok Bot plugin of the workflow site. A Grok Bot that has it works on a workflow site as one **agent account**, with the same 40 tools, tool names, wording and two skills as the Claude Code plugin in [`../claude-code`](../claude-code). It is a Cursor Plugin (manifest `.cursor-plugin/plugin.json`), the plugin format Grok Bot's **Connect apps** catalogue is built from, and it also loads in Cursor itself.

Install steps, configuration and the connection check are in [`INSTALL.md`](INSTALL.md).

## What it adds

- One MCP (Model Context Protocol) server, `workflow`, started on the Bot's computer as `node server/wf-agent.mjs serve`. It is the same single-file server as the Claude Code plugin, built from `plugins/mcp`, and needs only Node.js 24.
- Two skills: `work-a-queue` (how to work on the site; generated from the shared instruction text) and `author-a-flow` (turning a description of a process into a draft flow).
- Two setup values: **Site address** (`WF_SITE`) and **Agent key** (`WF_AGENT_KEY`, marked as a password so it is entered masked).

It adds no hooks, rules, commands or agents, and nothing that reads, blocks or changes the Bot's other tool calls.

## Claude Code plugin and Grok Bot plugin, side by side

| Claude Code plugin | Grok Bot plugin | Notes |
|---|---|---|
| `.claude-plugin/plugin.json` | `.cursor-plugin/plugin.json` | Same name (`workflow-agent`) and version |
| `.mcp.json`, server `workflow`, `${CLAUDE_PLUGIN_ROOT}` | `mcp.json`, server `workflow`, `${CURSOR_PLUGIN_ROOT}` | Same command: `node <plugin>/server/wf-agent.mjs serve` |
| `userConfig.site` | variable `WF_SITE` | Optional in both, so a saved `wf-agent login` keeps working |
| `userConfig.agent_key` (`sensitive: true`) | variable `WF_AGENT_KEY` (`writeOnly`, `format: password`) | The key is never written into a file of the plugin |
| `WF_HARNESS=claude-code` | `WF_HARNESS=grokbot` | Names the harness in the `User-Agent` and in `whoami` |
| Channel `workflow` (push as `<channel>` messages) | `WF_PUSH=off`; the inbox, the unread line and, if wanted, a Grok Bot routine that reads the inbox | Grok Bot has no documented way to show an MCP server's pushed message |
| Skill `work-a-queue` | Skill `work-a-queue` | Same instruction text; the channel paragraph is replaced by the inbox-only paragraph |
| Skill `author-a-flow` | Skill `author-a-flow` | Identical copy (a test keeps them equal) |
| MCP server instructions | MCP server instructions | Sent by the same server |
| `wf-agent login`, `check` | `wf-agent login`, `check` | Same command line, run on the Bot's computer |
| No hooks | No hooks | Tested |
| `plugins/.claude-plugin/marketplace.json` and the root `.claude-plugin/marketplace.json` | Root `.cursor-plugin/marketplace.json` | Lets Cursor (and a team marketplace) read this repository as a marketplace |
| `INSTALL.md` | `INSTALL.md` | |

## The format this follows

- Cursor's plugin documentation, read on 26 November 2026: [Plugins](https://cursor.com/docs/plugins) and the [Plugins reference](https://cursor.com/docs/reference/plugins) (manifest fields, `variables`, `mcp.json`, `${CURSOR_PLUGIN_ROOT}`, folder discovery of skills, `.cursor-plugin/marketplace.json` for a repository with several plugins, the submission checklist).
- The schema and validator of Cursor's official plugin repository, `cursor/plugins` at commit `b7b93c3` (`schemas/plugin.schema.json`, `schemas/marketplace.schema.json`, `scripts/validate-plugins.mjs`). The schema's `minClientVersions` names Grok Bot (`grokbot`) as a client of the same plugins. Marking a secret variable with `writeOnly: true` and `format: password` follows plugins listed there.
- Grok Bot's documentation on docs.x.ai, read on 26 November 2026: "Use the computer and apps" (Bots work from a cloud computer; **Connect apps**; a custom connector of type **Command** takes a command and its arguments and runs on the Bot's computer) and "Skills and routines" (routines).

## Not verified yet

- **Installing from a marketplace in Grok Bot.** The plugin is not listed anywhere yet, so it has not been added through **Connect apps**. Cursor documents that `${CURSOR_PLUGIN_ROOT}` and the variables are filled in for a plugin's command server; that Grok Bot does the same for a marketplace plugin's command server on the Bot's computer is not documented, and the server startup was tested with the substitution done by the test, not by Grok Bot.
- **How setup values are shown in Grok Bot.** Whether Grok Bot asks for optional variables at install time, and whether it keeps a `writeOnly` variable in secret storage, is not documented.
- **Pushed notifications.** No documented way exists to show an MCP server's own notifications in a Grok Bot chat, so push is off. If Grok Bot adds one, the server already speaks it (`WF_PUSH` on, `notifications/claude/channel`) and only `mcp.json` and the skill text change.
- **Conformance against a real test site.** It was run against the repository's in-memory fake site only (see "Tried with" in `INSTALL.md`).
- **The Add a custom connector form.** Way B of `INSTALL.md` was run as the same command line on the Bot's computer, not entered through the form.

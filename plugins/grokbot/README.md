# Workflow site agent plugin for Grok Bot

This plugin connects a Grok Bot to a workflow site. The Bot then works there as one agent account. It can read its queue, claim steps, record work, ask questions and draft flows.

It gives the Bot the same 40 tools and the same two skills as the Claude Code plugin in [`../claude-code`](../claude-code). It is a Cursor Plugin, the plugin format Grok Bot uses, so it also works in Cursor.

To install it, follow [`INSTALL.md`](INSTALL.md).

## Claude Code plugin and Grok Bot plugin

| Feature | Claude Code plugin | Grok Bot plugin |
|---|---|---|
| Manifest | `.claude-plugin/plugin.json` | `.cursor-plugin/plugin.json` |
| Plugin name and version | `workflow-agent`, 1.0.0 | Same |
| Server | MCP (Model Context Protocol) server `workflow` | Same server, same file |
| Tools | 40 tools | Same 40 tools, same names |
| Site address | Option `site` | Setup value `WF_SITE` |
| Agent key | Option `agent_key`, kept secret | Setup value `WF_AGENT_KEY`, entered masked |
| Saved login (`wf-agent login`) | Yes | Yes |
| Connection check (`wf-agent check`) | Yes | Yes |
| Skill `work-a-queue` | Yes | Yes, with inbox text instead of push text |
| Skill `author-a-flow` | Yes | Yes, identical |
| New work pushed into the chat | Yes, as channel messages | No. Inbox only, plus an optional routine |
| Hooks, commands, agents | None | None |
| Marketplace file | `.claude-plugin/marketplace.json` | `.cursor-plugin/marketplace.json` at the repository root |

## Known limits

- No pushed messages. Grok Bot has no documented way to show a message a server sends on its own. The plugin runs with push off, and the Bot finds new work in the inbox.
- Not listed in any marketplace yet. Until it is, install it as a custom connector (Option 2 in `INSTALL.md`).
- A custom connector takes only a command and its arguments. So with Option 2 the site address and key come from a login saved on the Bot's computer.
- The agent key must be typed on the Bot's computer or in a masked setup field. Never send it in chat.

## Not yet verified

- Installing from **Connect apps**. The plugin is not listed, so this was not tried.
- How Grok Bot shows the two setup fields, and whether it keeps the key in secret storage.
- That Grok Bot fills in the plugin folder path (`${CURSOR_PLUGIN_ROOT}`) and the setup values when it starts the server. Cursor documents this for Cursor. Our tests do the same substitution themselves.
- The **Add a custom connector** form itself. The same command was run directly on a Grok Bot computer instead.
- How Grok Bot updates an installed marketplace plugin.
- The conformance script against a real test site. It was run only against the repository's fake test site.

## What was tested

On a Grok Bot computer with Node.js 24.22.1, on 26 November 2026, against the repository's in-memory fake site:

- `wf-agent login` and `wf-agent check` worked.
- The server started three ways: with the setup values filled in, with them empty and a saved login, and as the custom connector command. Each time it listed 40 tools and answered `whoami` and `queue_list`.
- The conformance script passed every step the fake site supports (6 of 13).
- The manifest and the marketplace file pass the validator of Cursor's official plugin repository.

## Sources for the plugin format

- Cursor: [Plugins](https://cursor.com/docs/plugins) and the [Plugins reference](https://cursor.com/docs/reference/plugins), read 26 November 2026.
- The official Cursor plugin repository `cursor/plugins`, commit `b7b93c3`: its plugin and marketplace schemas and its validator. The schema lists Grok Bot (`grokbot`) as a client of these plugins. Its listed plugins mark secret setup values with `writeOnly` and `format: password`.
- Grok Bot documentation on docs.x.ai, read 26 November 2026: "Use the computer and apps" (Connect apps, Add a custom connector, Command type, Bots work on a cloud computer) and "Skills and routines".

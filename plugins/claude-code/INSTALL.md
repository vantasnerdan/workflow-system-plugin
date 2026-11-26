# Install the workflow agent plugin into Claude Code

You need two things: the **site address** (for example `https://workflow.example.test`) and the **agent key** (it starts with `wfa_`; the agent's owner issues it on the agent's page on the site and it is shown once). You also need Node.js 24 on the machine. Nothing else is installed: the plugin runs one file, `server/wf-agent.mjs`, which already contains everything it needs.

Below, `<plugins>` is the folder that contains `.claude-plugin/marketplace.json` and this `claude-code` folder, and `<plugin>` is this `claude-code` folder.

## 1. Add the plugin

To keep it, add the plugins folder as a marketplace and install the plugin from it, in a Claude Code session:

```
/plugin marketplace add <plugins>
/plugin install workflow-agent@workflow-site
```

Claude Code then asks for the plugin's options: enter the **Site address** and the **Agent key**. The key is kept in Claude Code's secure storage, not in a settings file.

The same from a terminal, for one project only (the marketplace and the plugin are then declared in that project's `.claude/settings.json`; leave out `--scope project` to add them for you in every project):

```
cd <your project>
claude plugin marketplace add --scope project <plugins>
claude plugin install workflow-agent@workflow-site --scope project --config site=https://workflow.example.test --config agent_key=<agent key>
```

The plugin's server is started with the `node` that Claude Code finds on its `PATH`, and it needs Node.js 24: with an older `node` first on the `PATH`, `claude mcp list` shows the server as "Failed to connect".

To try the plugin without installing it, load it for one session:

```
claude --plugin-dir <plugin>
```

## 2. Give it the site address and the key

If Claude Code did not ask for them (a session started with `--plugin-dir` does not), save them once from a terminal. The key is read from standard input, so it never appears in your shell history:

```
node <plugin>/server/wf-agent.mjs login --site https://workflow.example.test
```

Paste the key and press Enter, then Ctrl-D. The login is saved in `~/.config/wf-agent/config.json` (or under `$XDG_CONFIG_HOME`), readable only by you, and the plugin uses it whenever Claude Code gives it no value.

## 3. Check the connection

```
node <plugin>/server/wf-agent.mjs check
```

It names the agent, its owner, the site, its roles and limits, whether it may contact partners, whether it is paused, the interface version and how notifications reach it. If the key is revoked or expired, the agent is paused, or the site cannot be reached, it says which one and who can change it, and exits with its own code (paused 5, key 4, site unreachable 3).

Then check that Claude Code started the plugin's server and can call it:

```
claude --plugin-dir <plugin> mcp list
claude -p "Call the whoami tool of the workflow MCP server and print its answer." --plugin-dir <plugin> --allowedTools mcp__plugin_workflow-agent_workflow__whoami
```

The first lists `plugin:workflow-agent:workflow: node <plugin>/server/wf-agent.mjs serve - ✔ Connected`; the second prints the same answer as the check. For an installed plugin, leave out `--plugin-dir <plugin>` and ask in a session: "Who am I on the workflow site?". Then ask "What is in my queue?": the agent's own queue is read right away.

## 4. Turn on notifications in the session (optional)

New assignments, answers and mentions can appear in the session as visible channel messages (`← workflow: ...`). Channels are a research preview in Claude Code and are enabled per session when you start it:

```
claude --dangerously-load-development-channels plugin:workflow-agent@workflow-site
```

(`plugin:workflow-agent@inline` together with `--plugin-dir <plugin>`.) Claude Code asks you to confirm that this is for local development. Once your organisation allows this plugin's channel, `claude --channels plugin:workflow-agent@workflow-site` does the same without the development flag.

Without a channel nothing is lost: every tool result ends with `inbox: N unread` when there is something new, and the inbox keeps every notification in order. Set the environment variable `WF_PUSH=off` to stop the plugin from holding the event stream open at all.

## What the plugin adds, and how to remove it

It adds one MCP server (`workflow`) with the tools listed on the site's page "Agent interface", two skills (`work-a-queue`, `author-a-flow`) and one channel. It adds **no hooks**: nothing reads, blocks or changes your own tool calls or outputs. Every action on the site is a tool call the agent made, or a visible notification.

To remove it: `/plugin uninstall workflow-agent@workflow-site`, and delete `~/.config/wf-agent/` and `~/.local/state/wf-agent/` if you used `login`. Claude Code is then exactly as before.

## Tried with

Claude Code 2.1.332 on Linux, against a local test site, in a scratch folder: `claude plugin validate <plugin>` (passed, with warnings for the missing licence and icon), `wf-agent.mjs login` and `check`, `claude --plugin-dir <plugin> mcp list` (connected), the `claude -p` call above (whoami answered, once from the saved login and once from options given in a `--settings` file under `pluginConfigs["workflow-agent@inline"].options`), and a session started with `--plugin-dir <plugin> --dangerously-load-development-channels plugin:workflow-agent@inline`, in which a mention by the agent's owner arrived as a channel message and the agent opened it with the plugin's tools. The marketplace install of step 1 was then run from a terminal (lane L9, Claude Code 2.1.332), in a scratch project with its own Claude Code settings folder (`CLAUDE_CONFIG_DIR`), against a local site: `claude plugin marketplace add --scope project <plugins>` and `claude plugin install workflow-agent@workflow-site --scope project --config site=... --config agent_key=...` both succeeded and wrote only the project's `.claude/settings.json`; `claude mcp list` in that project listed `plugin:workflow-agent:workflow` as connected once Node.js 24 was the `node` on the `PATH` (failed to connect with an older one), and `wf-agent.mjs check` named the agent and its owner.

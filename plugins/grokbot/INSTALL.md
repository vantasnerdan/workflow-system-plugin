# Install the workflow agent plugin in Grok Bot

This plugin lets a Grok Bot work on a workflow site as one agent account. It reads its queue, claims steps, records work and asks questions on the site.

## Before you start

You need two things: the **site address** and the **agent key**.

- [ ] **Site address.** The web address of your workflow site, for example `https://workflow.example.test`. Ask the person who runs the site if you do not know it.
- [ ] **Agent key.** A key that starts with `wfa_`. The agent's owner creates it on the agent's page on the site. The site shows it only once, so copy it then.
- [ ] **Keep the key private.** Never paste the key into a chat message.
- [ ] **Groups and roles.** When you create the agent on the site, do not add it to the Publisher group unless that bot should draft and publish flows. A bot in Publisher can publish a template for the whole organisation. Do not give a client bot Publisher membership unless it should draft and publish.

The plugin runs a small program on the Bot's own computer. That computer needs Node.js 24. The Grok Bot computer we tested had Node.js 24.22.1.

A computer keeps only one saved login (see [One login per computer](#one-login-per-computer)). Running `wf-agent login` again overwrites it.

## Option 1: from Connect apps

Use this when the plugin is listed for you, either in the Cursor Marketplace or in your team's marketplace. It is **not listed yet**, so today you need Option 2.

1. In Grok Bot, open **Connect apps** from the sidebar.
2. Search for `Workflow site agent`.
3. Add it.
4. When it asks for setup values, enter the site address in **Site address**:

   ```
   https://workflow.example.test
   ```

5. Enter the agent key in **Agent key**. The field is masked.

Not yet verified: how Grok Bot shows these two setup fields. If it does not ask for them, follow steps 5 to 7 of Option 2 to save them on the Bot's computer instead.

### Check it works

Start a new chat with the Bot and type:

```
Who am I on the workflow site?
```

A correct answer names the agent and its owner, and includes lines like these:

```
Site: https://workflow.example.test
Connected as: <agent name> (agent) in <organisation>
Owner: <owner name>
Notifications: inbox only (push is turned off with WF_PUSH=off); read it with inbox_read or changes_since
```

Then type `What is in my queue?`. The Bot answers with a line like `My work: 1 assigned, 2 in my queues, ...`.

## Option 2: custom connector

Use this today. You copy the plugin onto the Bot's computer, save the site address and key there, and add the plugin as a custom connector.

1. Ask your Bot:

   ```
   Clone https://github.com/vantasnerdan/workflow-system-plugin into your home folder and tell me the full path of its plugins/grokbot folder.
   ```

2. Write down the path it gives you, for example `/home/box/workflow-system-plugin/plugins/grokbot`. Below this is called `<plugin>`.
3. Ask your Bot:

   ```
   Run node --version and tell me the result.
   ```

   It must start with `v24` or higher.
4. Open the Bot's computer and start a terminal there. You type the key there yourself, so it never goes through the chat.
5. Run this command, with your own site address and `<plugin>` replaced by the path from step 2:

   ```
   node <plugin>/server/wf-agent.mjs login --site https://workflow.example.test
   ```

6. Paste the agent key and press Enter.
7. Press Ctrl-D. The command answers `Saved. This machine now acts as <agent name> ...`.
8. In the Grok Bot desktop app, open **Connect apps** and choose **Add a custom connector** at the bottom.
9. Enter the name:

   ```
   workflow
   ```

10. Pick the type **Command**.
11. The next fields have two forms that both work. Use the one that matches the form you see.

    **Form A.** If you have only a command field and an arguments field:

    - Command:

      ```
      env
      ```

    - Arguments, with `<plugin>` replaced by the path from step 2:

      ```
      WF_HARNESS=grokbot WF_PUSH=off node <plugin>/server/wf-agent.mjs serve
      ```

    **Form B.** If you also have an environment field (this is the form we used on a Grok Bot computer):

    - Command:

      ```
      node
      ```

    - Arguments, with `<plugin>` replaced by the path from step 2:

      ```
      <plugin>/server/wf-agent.mjs serve
      ```

    - Environment:

      - `WF_HARNESS`: `grokbot`
      - `WF_PUSH`: `off`

    Do not put the agent key in these fields. The site address and key come from the saved login.
12. Choose **Add plugin**.

Instead of steps 8 to 12 you can ask the Bot to add it. Grok Bot documents that a Bot can add a server that runs as a command on its computer. Give it one of the two forms below.

```
Add a custom Model Context Protocol (MCP) server named workflow.
If your tool has separate fields for command, arguments and environment, use:
Command: node
Arguments: <plugin>/server/wf-agent.mjs serve
Environment: WF_HARNESS=grokbot and WF_PUSH=off
If your tool has only command and arguments, use:
Command: env
Arguments: WF_HARNESS=grokbot WF_PUSH=off node <plugin>/server/wf-agent.mjs serve
Do not put the agent key in the command, the arguments, or the chat.
```

### Check it works

1. In the terminal from step 4, run:

   ```
   env WF_HARNESS=grokbot WF_PUSH=off node <plugin>/server/wf-agent.mjs check
   ```

   A correct answer starts with `Site:` and `Connected as:`, and the command ends without an error.
2. Start a new chat with the Bot and type:

   ```
   Who am I on the workflow site?
   ```

   The answer has the same lines as in Option 1: `Site`, `Connected as`, `Owner` and `Notifications: inbox only`.

## One login per computer

The command `wf-agent login` saves one site address and one agent key in `~/.config/wf-agent/config.json`. There is only one saved login per computer. Running login again overwrites that file. After an overwrite, every connector on that computer that uses the saved login (and does not set `WF_SITE` and `WF_AGENT_KEY` itself) will act as the new account.

To run a second agent account on the same computer, do not run login again for that account. Add a second custom connector and put the second site address and key in that connector's environment. Type the key in the environment field, never in a chat.

1. Ask the second agent's owner to create an agent key on the site. They must not paste it in chat.
2. In **Connect apps**, add a custom connector with a distinct name, for example `workflow-client`.
3. Use Form B from Option 2 (command `node`, arguments, and environment). Set all four environment values:

   - `WF_SITE`: the site address
   - `WF_AGENT_KEY`: the agent key (type it in the masked field, never in chat)
   - `WF_HARNESS`: `grokbot`
   - `WF_PUSH`: `off`

4. Leave the first bot's saved login as it is. The environment values on the second connector override the saved login for that connector only.

If you asked a Bot to add the second connector, give it this block, with `<plugin>` and the site address filled in. Do not put the agent key in the chat. Ask the user to type the key in the connector's environment field themselves:

```
Add a second custom MCP server with a distinct name, for example workflow-client.
Command: node
Arguments: <plugin>/server/wf-agent.mjs serve
Environment:
  WF_SITE=<site address>
  WF_AGENT_KEY= (ask the user to type the key in this field; do not accept it in chat)
  WF_HARNESS=grokbot
  WF_PUSH=off
Do not run wf-agent login for this second account. Login would overwrite the saved login the first bot uses.
```

## For Grok Bot agents

Follow these steps literally when your user asks you to install this plugin. Do not skip a step. Stop and report if a step fails.

1. Run:

   ```
   git clone https://github.com/vantasnerdan/workflow-system-plugin "$HOME/workflow-system-plugin"
   ```

   If the folder already exists, run `git -C "$HOME/workflow-system-plugin" pull` instead. If other bots on this computer already use that folder, tell your user before you pull, because a pull changes the plugin for all of them.
2. Run `echo "$HOME/workflow-system-plugin/plugins/grokbot"`. Use the printed path as `<plugin>` in every later step. Always use the full path, never `~`.
3. Run `node --version`. If it does not start with `v24` or a higher number, stop and tell your user that Node.js 24 is needed.
4. Ask your user for the **site address**. It is not secret. Check that it starts with `https://` (or `http://` for a test site).
5. Check whether `~/.config/wf-agent/config.json` already exists (look at the path and file mode only; never print the file). If it exists, another bot on this computer may already have a saved login. Do not run login, because login overwrites that file. Instead, add this bot's connector with `WF_SITE` and `WF_AGENT_KEY` in the connector's environment, as in [One login per computer](#one-login-per-computer), and skip to the check in step 6 after the user has typed the key in the environment field. If the file does not exist, continue with the login below.
6. Do **not** ask your user to send the agent key in chat. Tell your user exactly this, with `<plugin>` and the site address filled in:

   ```
   Please open a terminal on my computer and run:
   node <plugin>/server/wf-agent.mjs login --site <site address>
   Then paste your agent key, press Enter, then press Ctrl-D.
   Tell me when it says "Saved".
   ```

7. Wait until your user says it is saved. Then run:

   ```
   env WF_HARNESS=grokbot WF_PUSH=off node <plugin>/server/wf-agent.mjs check
   ```

   Exit code 0 means it worked. Any other code: look it up in the Troubleshooting table below, tell your user the fix, and stop.
8. Add a custom MCP (Model Context Protocol) server with your tool for adding MCP servers. Prefer the form that matches your tool.

   If your tool has separate fields for command, arguments and environment, use this form (this is the form we used):

   - Name: `workflow`
   - Command: `node`
   - Arguments: `<plugin>/server/wf-agent.mjs serve`
   - Environment: `WF_HARNESS=grokbot` and `WF_PUSH=off`

   If your tool has only command and arguments, use this form:

   - Name: `workflow`
   - Command: `env`
   - Arguments: `WF_HARNESS=grokbot WF_PUSH=off node <plugin>/server/wf-agent.mjs serve`

   Never put the agent key in the command, the arguments, or the chat. With this first connector, the site address and key come from the saved login.
9. The new tools are ready from your next message. Tell your user to send any message, for example `Check the workflow connection`.
10. On that next turn, call the `whoami` tool of the `workflow` server. Then call `queue_list`.
11. Report to your user:
    - the agent name and owner (the `Connected as` and `Owner` lines),
    - the site address,
    - the `Notifications` line,
    - how many items are in the queue,
    - that new work arrives in the inbox only, and that you can set up a routine to check it (see Getting new work).

    If this bot is for a client, remind your user not to add it to the Publisher group unless it should draft and publish.

## Getting new work

- The Bot does not get pushed messages from the site. Grok Bot has no documented way to show them, so the plugin runs with push off.
- Nothing is lost. Every answer from the plugin ends with `inbox: N unread` when there is something new.
- Ask the Bot `What is new in my workflow inbox?` at any time. It reads the inbox with `inbox_read`.
- To be told without asking, ask the Bot for a routine:

  ```
  Every weekday at 8:00, read my workflow inbox and tell me what is new. Do not claim or complete anything.
  ```

## Updating

- **Option 1:** not yet verified how Grok Bot updates a marketplace plugin.
- **Option 2:** ask your Bot:

  ```
  Run git pull in your workflow-system-plugin folder, then run the workflow check command again.
  ```

  The check shows the plugin version in the line `Interface version: ... (plugin 1.0.0)`. If the Bot still uses the old version, remove the custom connector and add it again.

  If more than one bot on this computer uses that folder, a pull changes the plugin for all of them. Tell your user before you pull.

## Removing

Bots that share one computer share the saved login (`~/.config/wf-agent`) and the cloned folder (`~/workflow-system-plugin`). Do not delete those folders while other bots still use them.

1. In **Connect apps**, remove only this bot's connector (**Workflow site agent**, or the `workflow` or `workflow-client` custom connector).
2. If other bots on this computer still use the plugin, stop here. Leave `~/.config/wf-agent`, `~/.local/state/wf-agent` and `~/workflow-system-plugin` in place.
3. If you used Option 2, and no other bot on this computer uses the plugin, ask your Bot:

   ```
   Delete the folders ~/.config/wf-agent, ~/.local/state/wf-agent and ~/workflow-system-plugin.
   ```

Grok Bot is then exactly as before. The plugin adds no hooks, so nothing else changed.

## Troubleshooting

| Symptom | Fix |
|---|---|
| The check says "No site address" or "No agent key" (exit code 2) | The login was not saved. Repeat steps 5 to 7 of Option 2. |
| The check says "not an agent key" | The key must start with `wfa_`. Ask the agent's owner for the key again. |
| The check says the site cannot be reached (exit code 3) | Check the site address. Run the login again with the right address. |
| The check says the key is revoked or expired (exit code 4) | Ask the agent's owner to issue a new key, then run the login again. |
| The check says the agent is paused (exit code 5) | The agent's owner must resume the agent on the site. |
| `node --version` shows a version below 24 | Install Node.js 24 on the Bot's computer. |
| The Bot says it has no workflow tools | Send one more message. New tools are ready from the next message. Then check the connector is listed in **Connect apps**. |
| The Bot answers "inbox: N unread" but you got no alert | This is expected. Push is off. Ask for the inbox, or set up the routine in Getting new work. |
| Two bots on the same computer suddenly show the same agent | Login was overwritten. Restore the first bot's login, then put the second account's site and key in that connector's environment (see [One login per computer](#one-login-per-computer)). |

## Files it installs

| File | What it is for |
|---|---|
| `.cursor-plugin/plugin.json` | Plugin manifest: name, version, the two setup values, the skills and the server. |
| `mcp.json` | Starts the server `workflow` with the setup values, `WF_HARNESS=grokbot` and `WF_PUSH=off`. |
| `server/wf-agent.mjs` | The server and the `wf-agent` command line in one file. Needs only Node.js 24. |
| `skills/work-a-queue/SKILL.md` | Skill: how to work on the site. Generated from the shared instruction text. |
| `skills/author-a-flow/SKILL.md` | Skill: turning a description of a process into a draft flow. |
| `README.md` | What the plugin is and how it compares to the Claude Code plugin. |
| `INSTALL.md` | This guide. |
| `biome.json` | Lint settings for this repository. Grok Bot does not use it. |

Outside this folder the plugin writes only `~/.config/wf-agent/config.json` (the saved login) and `~/.local/state/wf-agent/` (its small local state).

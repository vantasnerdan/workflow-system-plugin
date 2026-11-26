---
name: author-a-flow
description: Turn a person's description of a process into a draft flow on the workflow site, written as text in the site's notation, with every block's settings, checked and dry-run. Use when the user asks to create, draw, change or set up a workflow, template, process or flow on the workflow site.
---

# Authoring a flow as text

The person describes the process here, in this conversation. The site shows only the draft, its changes (each one attributed to this agent) and its notes. There is no chat on the site, so ask your questions here, and leave a note on the draft only for things the person should confirm there.

1. Read the notation first: `notation_reference` gives the notation (a mermaid flowchart profile that people see as a stack of blocks) and the catalogue of components with their inputs, outputs, settings and outcomes. Use only those components.
2. Ask before you draw when something is unknown: who does each step, what decides a branch, what must be true before a step may finish, which steps a partner does and in which language. Do not guess.
3. Create the draft: `draft_create` with a short `key` (lower case with dashes) and a `name` for a new template, or `template` to start a draft of an existing one.
4. Write the flow: `draft_edit` with `text` (the whole flow) the first time; later changes are block operations (`add_block`, `move_block`, `rename_block`, `add_path`, `set_ending`, ...) so the person sees each change on its own. Keep block ids stable: they tie settings, notes and history to the block.
5. Set every block's settings with `draft_settings_set`: the assignee (person, role, group or organisation), due date, gate rule, instructions, languages and translations of partner steps, the agent-approval mode of each approval, and the component's own settings. Each call is one recorded change.
6. Check it: `draft_validate` explains every problem in plain words and offers fixes. Apply a fix with `draft_edit`, or propose it for the person to accept with `draft_fix_propose`.
7. Try it: `draft_dry_run` with sample start inputs and the outcome to take at each decision or approval. It sends nothing and notifies nobody. Tell the person the path and who would get what when.
8. Leave notes with `draft_note_add` on a block (with `to_confirm` true) for each choice the person should confirm.
9. Publishing is the person's call: only members of the Publisher group can `draft_publish`. If this agent is not one, the site refuses and says so; tell the person the draft is ready for a publisher. A published version is never changed; later changes are a new draft.

When an edit is refused as changed meanwhile, someone else edited the draft: read it again with `draft_get`, then apply your change to the new revision.

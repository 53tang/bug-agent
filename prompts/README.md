# Prompts

## `code-review-system.txt`

System / instruction template for **PR code review** via Moonshot (Kimi). Loaded at runtime by [`src/moonshot/prompt-builder.ts`](../src/moonshot/prompt-builder.ts) using `PROMPT_PATH` from [`src/config/constants.ts`](../src/config/constants.ts).

**Placeholders** (replaced in `buildPrompt()`):

| Placeholder       | Source                                                       |
| ----------------- | ------------------------------------------------------------ |
| `{{PROMPT}}`      | Short task string from the analyzer (what to look for).      |
| `{{PR_TITLE}}`    | PR title.                                                    |
| `{{REPO}}`        | `workspace/repo` full name.                                  |
| `{{PR_ID}}`       | Pull request id.                                             |
| `{{CHANGE_LIST}}` | JSON of per-file diffs / content snippets sent to the model. |

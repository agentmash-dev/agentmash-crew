---
name: run-lab
description: Run a study with the agentmash lab from the main session. Use when the user says "run the lab", "test this hypothesis", "pre-register this", "is this result real" or asks for research work that needs several lab roles; walks through direction, data, pre-registration and the PI's lock, the run, controls, conformance, the verdict and the PI gate, with mash-coordinator as the conductor.
---

# Run the agentmash lab

This is the playbook for the main Claude Code session when it starts a study with the lab. The lab agents are `agentmash-lab:<name>`; each preloads the `lab-protocol` skill. Read it now if you have not: this playbook uses its study files, lock, provenance markers and gates without redefining them.

The conductor is mash-coordinator from the agentmash crew plugin (`agentmash-crew:mash-coordinator`). If the crew plugin is not installed, tell the user (`claude plugin install agentmash-crew@agentmash`) and lead the waves yourself with the same rules.

## When to use the lab

Use it when the work is a claim about the world that someone will rely on: a hypothesis, a benchmark result, a reanalysis, a score that "works". For product ML code, use the crew's batch-ml. For one question about a paper or a dataset, dispatch the single lab agent that owns it.

## 1. Set up the study

1. Pick a study id (`dtp-fate-transfer`) and a task id per run (`dtp-fate-transfer-run1`).
2. Find the study's source of truth (`STUDY.md` by default). If there is none, ask the PI for the question and what is already established and closed, and draft it for them to edit. The PI owns that file; no agent writes established facts into it.
3. Create the task folders and keep them out of git:

```bash
mkdir -p .agentmash-crew/{briefs,reports,ledger,work}/<task-id> .agentmash-crew/approvals
grep -qxF '.agentmash-crew/' .git/info/exclude 2>/dev/null || echo '.agentmash-crew/' >> .git/info/exclude
```

## 2. Hand the study to Mash

Dispatch `agentmash-crew:mash-coordinator` with a brief that carries the line `Lab: agentmash-lab`, the `Study` line (id and SSOT path), `Goal`, `Acceptance` and `Budget`. Mash runs the waves below, writes the briefs and stops at every PI gate. You relay its gate requests to the PI and record their answers.

## 3. The waves

| Wave | Agent | Needs | Produces |
|---|---|---|---|
| 1 | hunch-hypotheses (when the direction is open) | SSOT | ranked proposals with cross-field prior art |
| 1 | atlas-curator | candidate datasets | verified manifest, loaders, unit counts; no outcomes looked at |
| 2 | seal-prereg, mode `register` | proposal, manifest | pre-registration and its `sha256` |
| gate | **the PI locks it** | the pre-registration | approval recorded with the hash |
| 3 | bench-analyst | the lock | results per hypothesis, failed predictions included |
| 4 | foil-controls | bench results | `SURVIVES`, `REDUCES` or `INCONCLUSIVE` per claim |
| 5 | seal-prereg, mode `conform` | results, code | the per-quantity conformance table |
| 6 | assay-judge | everything above | `MERGE`, `REVISE`, `CLOSE` or `ESCALATE` per result |
| gate | **the PI** | verdicts | SSOT updates, posting, publishing |

The lock is the step people skip, so do not. Show the PI the whole pre-registration, not a summary. Record in `.agentmash-crew/approvals/<task-id>.md` their words verbatim, the path and `sha256: <hash>`. bench-analyst and foil-controls check that hash before a confirmatory run and refuse on a mismatch.

## 4. Branch on status

Status values and reason codes are the crew's. Lab specifics:

- `BLOCKED`, `approval-required` with a hash mismatch: someone edited a locked pre-registration. Ask seal-prereg for an amendment; never re-approve the edited file silently.
- A failed prediction is `DONE`, not a problem to fix. Route rescue ideas to hunch-hypotheses as new proposals.
- assay-judge `REVISE`: each fix names its owner; re-dispatch that agent with the judge's finding quoted. `CLOSE`: record the negative in `decisions.md` through seal-prereg and tell the PI it is a result.
- Three provenance violations of one class in one task stop that role; the PI decides whether to continue.

## 5. Close

Tell the PI, in this order: what was registered, which predictions held and which failed, what the controls left standing, the judge's verdicts, and what needs their decision: SSOT updates, amendments, posting or publishing. Every number you relay names its results file. Write nothing into the SSOT or `paper/`.

## Routing cheat sheet

| Need | Agent |
|---|---|
| What to test next; has this been done, under any field's name | hunch-hypotheses |
| Write, amend or check against a pre-registration; the decision log | seal-prereg |
| Find, download, verify a dataset; labels; split units; overlap with training corpora | atlas-curator |
| Run the registered analysis; regenerate figures and tables | bench-analyst |
| Baselines, nulls, confound partials; "is this just depth or gene count" | foil-controls |
| Is this claim supported; before the SSOT or a submission | assay-judge |
| Run a study end to end | mash-coordinator |
| Package installs for the analysis environment | bump-dependencies |

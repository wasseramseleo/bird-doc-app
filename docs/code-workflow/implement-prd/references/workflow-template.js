// Per-WAVE Workflow skeleton for /implement-prd.
//
// The orchestrator (the main loop) invokes this ONCE PER WAVE, passing the wave's
// ready issues + the project profile + the integration branch via `args`. Git
// integration (merging green sub-PRs into the integration branch, updating the
// local branch, recomputing the ready set, retry/park) happens in the orchestrator
// BETWEEN wave invocations — NOT here: Workflow agents run in isolated worktrees and
// can't safely mutate the shared integration branch in parallel. This script only
// implements + reviews + fixes each issue and returns structured results to
// integrate.
//
// Adapt freely — a starting point, not a fixed contract. The gate list is
// stack-agnostic: it renders whatever `profile.gates` the orchestrator discovered.

export const meta = {
  name: 'implement-prd-wave',
  description: 'Implement one topological wave of a PRD: per-issue TDD → review → fix',
  phases: [
    { title: 'Implement' },
    { title: 'Review' },
    { title: 'Fix' },
  ],
}

// args = {
//   branch: 'prd-113',
//   issues: [120],                       // ready issues for THIS wave only
//   profile: { gates: [...], labels: {...} },
//   maxAttempts: 2,
// }
const { branch, issues, profile, maxAttempts = 2 } = args
const gates = profile.gates || []

// Render the repo's gates (stack-agnostic) as prompt lines the agent can run.
const gateLines = gates
  .map((gate) => {
    const cond = gate.when && gate.when !== 'always' ? `  (only if ${gate.when})` : ''
    const iso = gate.isolate ? `  [isolate: ${gate.isolate}]` : ''
    return `  - ${gate.name}: ${gate.cmd}${cond}${iso}`
  })
  .join('\n')

const RESULT_SCHEMA = {
  type: 'object',
  required: ['issue', 'status'],
  properties: {
    issue: { type: 'number' },
    status: { type: 'string', enum: ['green', 'failed'] },
    prNumber: { type: 'number' },
    prUrl: { type: 'string' },
    branch: { type: 'string' },
    gates: { type: 'object' },          // { <gateName>: 'pass' | 'skipped' | 'fail' }
    review: { type: 'object' },
    attempts: { type: 'number' },
    failureReason: { type: ['string', 'null'] },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['clean'],
  properties: {
    clean: { type: 'boolean' },
    mustFix: { type: 'array', items: { type: 'string' } },
  },
}

// One independent pipeline per issue: implement → review → fix. No barrier between
// issues — issue A can be in Fix while issue B is still Implementing.
const results = await pipeline(
  issues,

  // Stage 1 — implement exactly one issue, test-first, in an isolated worktree.
  (issue) => agent(
    [
      `Implement issue #${issue} in this repository, test-first.`,
      `You are on integration branch "${branch}"; create and use branch "issue-${issue}".`,
      ``,
      `Use the /tdd skill against issue #${issue} only. Honour its acceptance criteria exactly;`,
      `do NOT edit the issue or reinterpret its scope. If it is too underspecified to implement`,
      `faithfully, stop and return status "failed" with a clear failureReason.`,
      ``,
      `Before opening a PR, get every applicable gate GREEN in this worktree (it is ephemeral —`,
      `unpushed work is lost):`,
      gateLines,
      `Apply each gate's [isolate] note so parallel worktrees don't collide on shared state.`,
      ``,
      `Then commit, push "issue-${issue}", and open a PR against "${branch}" whose body includes`,
      `"Closes #${issue}". Return the structured result — your final message IS the data.`,
    ].join('\n'),
    { label: `impl:#${issue}`, phase: 'Implement', schema: RESULT_SCHEMA, isolation: 'worktree' },
  ),

  // Stage 2 — independent code review of the resulting PR diff.
  (impl, issue) => {
    if (!impl || impl.status !== 'green' || !impl.prNumber) return impl // nothing to review
    return agent(
      [
        `Independently review the diff of PR #${impl.prNumber} (issue #${issue}, branch ${impl.branch}).`,
        `Run /code-review over the changed code. Report only genuine must-fix findings: correctness`,
        `bugs, security issues, or acceptance-criteria gaps. Style nits are not must-fix.`,
        `Return { clean, mustFix }.`,
      ].join('\n'),
      { label: `review:#${issue}`, phase: 'Review', schema: REVIEW_SCHEMA },
    ).then((review) => ({ ...impl, review }))
  },

  // Stage 3 — bounded fix cycle if review found must-fix issues.
  (r, issue) => {
    if (!r || r.status !== 'green') return r
    if (!r.review || r.review.clean) return r
    if ((r.attempts || 1) >= maxAttempts) {
      return { ...r, status: 'failed', failureReason: `review unresolved after ${maxAttempts} attempts` }
    }
    return agent(
      [
        `Address these review findings on branch ${r.branch} (issue #${issue}, PR #${r.prNumber}):`,
        r.review.mustFix.map((m) => `  - ${m}`).join('\n'),
        ``,
        `Fix them, then re-run the applicable gates:`,
        gateLines,
        `and push. Return the updated structured result with attempts incremented and review.clean`,
        `reflecting the new state.`,
      ].join('\n'),
      { label: `fix:#${issue}`, phase: 'Fix', schema: RESULT_SCHEMA },
    )
  },
)

// Hand the wave's results back to the orchestrator, which merges the green PRs,
// parks failures, and computes the next wave.
return results.filter(Boolean)

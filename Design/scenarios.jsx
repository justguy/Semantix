// Scenario data — 3 example runs a user might submit to Semantix
// Each scenario has: prompt, intent contract, nodes (graph), edges, diff (state effects)

const scenarios = {
  swe: {
    key: 'swe',
    label: 'Engineering',
    prompt: 'Add email verification to signup. Send a verification link, gate login until verified, and migrate existing users as pre-verified.',
    cli: `$ semantix run --prompt "Add email verification to signup..." \\
    --repo ./services/auth \\
    --policy ./policies/prod.yaml \\
    --approval required`,
    intent: {
      directive: 'Add email verification flow to the signup path in services/auth, gated on successful email delivery.',
      boundaries: [
        'Do not modify billing or payments code paths',
        'Do not send real emails from dev/staging credentials',
        'Migration must not lock the users table for more than 5s',
      ],
      success: 'New signups receive a verification email; login is blocked until verified; existing users are marked verified=true via reversible migration.',
    },
    nodes: [
      { id: 'n1', title: 'Parse intent', type: 'deterministic', status: 'passed', grounding: 'grounded', confidence: 'high', risk: 'green', owner: 'semantix', sources: 1, tools: 0, approval: false, sideEffect: false, x: 40, y: 40,
        purpose: 'Freeze the user request into an Intent Contract with boundaries and success state.',
        inputs: ['User prompt', 'Repo policy ./policies/prod.yaml'],
        constraints: { hard: ['Intent contract schema valid', 'Boundaries non-empty'], soft: [] },
        tools_visible: [],
        output: 'IntentContract { directive, boundaries[3], success }',
        critique: null,
      },
      { id: 'n2', title: 'Load repo context', type: 'deterministic', status: 'passed', grounding: 'grounded', confidence: 'high', risk: 'green', owner: 'phalanx', sources: 7, tools: 1, approval: false, sideEffect: false, x: 220, y: 40,
        purpose: 'Retrieve the minimal slice of services/auth needed to reason about signup & login.',
        inputs: ['services/auth/signup.ts', 'services/auth/login.ts', 'db/schema.sql', 'routes/auth.ts'],
        constraints: { hard: ['Scope limited to services/auth/**'], soft: ['Prefer files referenced in intent'] },
        tools_visible: ['repo.search', 'repo.read'],
        output: '7 files, 412 lines scoped',
        critique: null,
      },
      { id: 'n3', title: 'Draft migration', type: 'semantic', status: 'waiting_review', grounding: 'transformed', confidence: 'medium', risk: 'yellow', owner: 'semantix', sources: 2, tools: 0, approval: false, sideEffect: false, x: 40, y: 180,
        purpose: 'Generate SQL migration adding `email_verified` column and backfilling existing rows.',
        inputs: ['db/schema.sql', 'Intent.success'],
        constraints: { hard: ['No table lock > 5s', 'Reversible migration'], soft: ['Match existing migration style'] },
        tools_visible: [],
        output: '20250422_add_email_verified.sql (+14 lines)',
        critique: null,
      },
      { id: 'n4', title: 'Draft verify endpoint', type: 'semantic', status: 'waiting_review', grounding: 'bridged', confidence: 'low', risk: 'orange', owner: 'semantix', sources: 2, tools: 0, approval: false, sideEffect: false, x: 220, y: 180,
        purpose: 'Generate GET /auth/verify?token=… handler that marks email_verified=true.',
        inputs: ['routes/auth.ts', 'services/auth/signup.ts'],
        constraints: { hard: ['Token must be single-use', 'Rate-limit 10/min/ip'], soft: ['Reuse existing middleware'] },
        tools_visible: [],
        output: 'routes/auth.ts (+38 lines)',
        critique: {
          severity: 'weak-grounding',
          summary: 'No existing token-signing utility was retrieved; draft invents `signToken()`. Likely a bridged assumption.',
          suggestion: 'Add lib/crypto/tokens.ts to context, or mark node approval-required.',
        },
      },
      { id: 'n5', title: 'Gate login', type: 'semantic', status: 'waiting_review', grounding: 'transformed', confidence: 'medium', risk: 'yellow', owner: 'semantix', sources: 2, tools: 0, approval: false, sideEffect: false, x: 400, y: 180,
        purpose: 'Modify login handler to reject users with email_verified=false.',
        inputs: ['services/auth/login.ts', 'Intent.success'],
        constraints: { hard: ['Error code must be 403', 'Message must not leak user existence'], soft: [] },
        tools_visible: [],
        output: 'services/auth/login.ts (+9 / −2 lines)',
        critique: null,
      },
      { id: 'n6', title: 'Policy check', type: 'policy_gate', status: 'passed', grounding: 'grounded', confidence: 'high', risk: 'green', owner: 'hoplon', sources: 0, tools: 0, approval: false, sideEffect: false, x: 220, y: 320,
        purpose: 'Verify all planned mutations stay within services/auth/** and db/migrations/**.',
        inputs: ['4 proposed changes', 'prod.yaml scope rules'],
        constraints: { hard: ['Scope: services/auth/**, db/migrations/**', 'No billing/** touched'], soft: [] },
        tools_visible: [],
        output: 'PASS — 4 changes in scope',
        critique: null,
      },
      { id: 'n7', title: 'Send emails (SMTP)', type: 'tool', status: 'blocked', grounding: 'grounded', confidence: 'low', risk: 'red', owner: 'guardrail', sources: 1, tools: 1, approval: true, sideEffect: true, x: 400, y: 320,
        purpose: 'Call SMTP provider to send verification email. External, irreversible per-recipient.',
        inputs: ['SMTP_HOST=smtp.postmark.io', 'from=noreply@prod.example.com'],
        constraints: { hard: ['Approval required', 'Dry-run in non-prod'], soft: [] },
        tools_visible: ['smtp.send'],
        output: 'BLOCKED — approval required, prod credentials',
        critique: {
          severity: 'policy',
          summary: 'Production SMTP credentials; messages are irreversible once sent.',
          suggestion: 'Approve with dry-run recipient list, or require manual approval per batch.',
        },
      },
      { id: 'n8', title: 'Open PR', type: 'approval', status: 'waiting_review', grounding: 'grounded', confidence: 'high', risk: 'green', owner: 'phalanx', sources: 0, tools: 1, approval: true, sideEffect: true, x: 220, y: 460,
        purpose: 'Open a GitHub PR with the 4 file changes, linking the intent contract and review artifact.',
        inputs: ['4 file diffs', 'Intent contract hash'],
        constraints: { hard: ['Base branch = main', 'Draft = true'], soft: [] },
        tools_visible: ['github.pr.open'],
        output: 'Would open PR #— → main (draft)',
        critique: null,
      },
    ],
    edges: [
      ['n1', 'n2'], ['n1', 'n3'], ['n2', 'n3'], ['n2', 'n4'], ['n2', 'n5'],
      ['n3', 'n6'], ['n4', 'n6'], ['n5', 'n6'], ['n6', 'n7'], ['n6', 'n8'], ['n7', 'n8'],
    ],
    diff: [
      { id: 'd1', kind: 'file', op: 'create', target: 'db/migrations/20250422_add_email_verified.sql', summary: '+14 lines · reversible migration', node: 'n3', policy: 'pass', reversibility: 'reversible', owner: 'hoplon', approved: false,
        preview: `+ -- +migrate Up
+ ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT true;
+ ALTER TABLE users ALTER COLUMN email_verified SET DEFAULT false;
+ CREATE INDEX CONCURRENTLY idx_users_unverified ON users(id) WHERE email_verified = false;
+
+ -- +migrate Down
+ DROP INDEX IF EXISTS idx_users_unverified;
+ ALTER TABLE users DROP COLUMN email_verified;`,
        flags: [],
      },
      { id: 'd2', kind: 'file', op: 'modify', target: 'routes/auth.ts', summary: '+38 / −0 lines · new /verify route', node: 'n4', policy: 'review_required', reversibility: 'reversible', owner: 'hoplon', approved: false,
        preview: `  router.post('/signup', signupHandler);
  router.post('/login', loginHandler);
+ router.get('/verify', rateLimit('10/min'), async (req, res) => {
+   const { token } = req.query;
+!  const claims = signToken.verify(token);   // ⚠ signToken not found in repo
+   if (!claims) return res.status(400).json({ error: 'invalid_token' });
+   await db.users.update(claims.uid, { email_verified: true });
+   res.redirect('/login?verified=1');
+ });`,
        flags: ['Uses undefined `signToken` — bridged assumption from node n4'],
      },
      { id: 'd3', kind: 'file', op: 'modify', target: 'services/auth/login.ts', summary: '+9 / −2 lines · reject unverified', node: 'n5', policy: 'pass', reversibility: 'reversible', owner: 'hoplon', approved: false,
        preview: `  const user = await db.users.findByEmail(email);
  if (!user || !await bcrypt.compare(pw, user.pw_hash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
+ if (!user.email_verified) {
+   return res.status(403).json({ error: 'email_not_verified' });
+ }
  return issueSession(user);`,
        flags: [],
      },
      { id: 'd4', kind: 'api', op: 'call', target: 'smtp.postmark.io · send', summary: 'Send verification email to new signups · PROD credentials', node: 'n7', policy: 'block', reversibility: 'irreversible', owner: 'guardrail', approved: false,
        preview: `POST smtp.postmark.io/email
  From: noreply@prod.example.com
  To:   {{ signup.email }}
  Subject: Verify your email
  Body: <verification link>
  Scope: per-signup, triggered by POST /auth/signup`,
        flags: ['Production SMTP credentials in scope', 'Irreversible once delivered', 'Approval required per policy'],
      },
      { id: 'd5', kind: 'external', op: 'github.pr.open', target: 'github.com/acme/api → PR to main', summary: 'Draft PR with 3 file changes + migration', node: 'n8', policy: 'review_required', reversibility: 'reversible', owner: 'phalanx', approved: false,
        preview: `github.pr.open({
  base: 'main',
  head: 'semantix/email-verification',
  draft: true,
  files: 3,
  migration: 1,
  body: 'Auto-generated by Semantix run ' + runId
})`,
        flags: [],
      },
    ],
  },

  support: {
    key: 'support',
    label: 'Support',
    prompt: 'Draft empathetic replies to the 3 tickets tagged "billing-urgent" from the last hour. Do not promise refunds. Match the tone of our last 20 approved replies.',
    cli: `$ semantix run --prompt "Draft empathetic replies..." \\
    --tickets last_hour:billing-urgent \\
    --style-ref approved_replies.last_20 \\
    --dry-run emails`,
    intent: {
      directive: 'Generate one reply per billing-urgent ticket matching approved tone, without promising refunds.',
      boundaries: ['No refund promises', 'No mention of competitor products', 'No ETA commitments beyond 48h'],
      success: '3 draft replies produced, each passing tone and must-not checks, staged for human approval.',
    },
    nodes: [
      { id: 's1', title: 'Fetch tickets', type: 'tool', status: 'passed', grounding: 'grounded', confidence: 'high', risk: 'green', owner: 'phalanx', sources: 3, tools: 1, approval: false, sideEffect: false, x: 40, y: 40,
        purpose: 'Pull 3 tickets tagged billing-urgent from the last hour.',
        inputs: ['Zendesk API', 'filter: tag=billing-urgent, age<1h'],
        constraints: { hard: ['Max 10 tickets'], soft: [] },
        tools_visible: ['zendesk.search'],
        output: '3 tickets: #4812, #4815, #4817',
        critique: null,
      },
      { id: 's2', title: 'Load tone reference', type: 'deterministic', status: 'passed', grounding: 'grounded', confidence: 'high', risk: 'green', owner: 'semantix', sources: 20, tools: 0, approval: false, sideEffect: false, x: 220, y: 40,
        purpose: 'Embed the last 20 approved replies as tone reference.',
        inputs: ['approved_replies table'],
        constraints: { hard: [], soft: [] },
        tools_visible: [],
        output: '20 replies embedded, avg length 84 words',
        critique: null,
      },
      { id: 's3', title: 'Draft reply #4812', type: 'semantic', status: 'waiting_review', grounding: 'transformed', confidence: 'medium', risk: 'yellow', owner: 'semantix', sources: 21, tools: 0, approval: false, sideEffect: false, x: 40, y: 180,
        purpose: 'Draft empathetic reply matching approved tone.',
        inputs: ['ticket #4812 body', 'tone ref'],
        constraints: { hard: ['must_not: ["refund", "credit back", "reimburse"]', 'format: plain text'], soft: ['length ≤ 120 words', 'tone: empathetic + calm'] },
        tools_visible: [],
        output: 'Draft (98 words)',
        critique: null,
      },
      { id: 's4', title: 'Draft reply #4815', type: 'semantic', status: 'warning', grounding: 'bridged', confidence: 'low', risk: 'orange', owner: 'semantix', sources: 21, tools: 0, approval: false, sideEffect: false, x: 220, y: 180,
        purpose: 'Draft empathetic reply matching approved tone.',
        inputs: ['ticket #4815 body', 'tone ref'],
        constraints: { hard: ['must_not: ["refund", "credit back", "reimburse"]'], soft: ['tone: empathetic'] },
        tools_visible: [],
        output: 'Draft (112 words) — semantic near-miss',
        critique: {
          severity: 'semantic-match',
          summary: 'Draft says "we\'ll make this right financially" — semantically similar to a refund promise (score 0.78, threshold 0.70).',
          suggestion: 'Regenerate with tightened constraint, or mark for approval.',
        },
      },
      { id: 's5', title: 'Draft reply #4817', type: 'semantic', status: 'passed', grounding: 'transformed', confidence: 'high', risk: 'green', owner: 'semantix', sources: 21, tools: 0, approval: false, sideEffect: false, x: 400, y: 180,
        purpose: 'Draft empathetic reply matching approved tone.',
        inputs: ['ticket #4817 body', 'tone ref'],
        constraints: { hard: ['must_not: ["refund", "credit back"]'], soft: [] },
        tools_visible: [],
        output: 'Draft (76 words)',
        critique: null,
      },
      { id: 's6', title: 'Stage for approval', type: 'approval', status: 'waiting_review', grounding: 'grounded', confidence: 'high', risk: 'green', owner: 'phalanx', sources: 0, tools: 1, approval: true, sideEffect: true, x: 220, y: 320,
        purpose: 'Post drafts as internal notes on each ticket, awaiting human send.',
        inputs: ['3 drafts'],
        constraints: { hard: ['status = internal_note, not customer-visible'], soft: [] },
        tools_visible: ['zendesk.note.create'],
        output: '3 internal notes staged',
        critique: null,
      },
    ],
    edges: [['s1','s3'],['s1','s4'],['s1','s5'],['s2','s3'],['s2','s4'],['s2','s5'],['s3','s6'],['s4','s6'],['s5','s6']],
    diff: [
      { id: 'sd1', kind: 'message', op: 'draft', target: 'Ticket #4812 · internal note', summary: 'Draft reply · 98 words · tone-pass', node: 's3', policy: 'pass', reversibility: 'reversible', owner: 'phalanx', approved: false,
        preview: `Hi Maria,

Thanks for flagging this so quickly — I can see how frustrating it is
to see an unexpected charge on your statement. I want to make sure we
get this sorted for you today.

I'm pulling up your account now and will follow up within 2 hours with
a clear explanation of what happened and the options available to you.

If anything urgent comes up in the meantime, please reply here.

— Alex, Billing Support`,
        flags: [],
      },
      { id: 'sd2', kind: 'message', op: 'draft', target: 'Ticket #4815 · internal note', summary: 'Draft reply · 112 words · ⚠ refund-like phrase', node: 's4', policy: 'review_required', reversibility: 'reversible', owner: 'semantix', approved: false,
        preview: `Hi Dan,

I completely understand — seeing a duplicate charge is alarming,
especially when you weren't expecting it.

!We'll make this right financially and get you back to where you
!expected to be.

I've escalated your ticket to our billing team and you should hear
back within 24 hours with next steps.

Thanks for your patience while we dig in.

— Alex, Billing Support`,
        flags: ['Line 4-5: semantic match to "refund promise" (0.78 ≥ 0.70 threshold)'],
      },
      { id: 'sd3', kind: 'message', op: 'draft', target: 'Ticket #4817 · internal note', summary: 'Draft reply · 76 words · tone-pass', node: 's5', policy: 'pass', reversibility: 'reversible', owner: 'phalanx', approved: false,
        preview: `Hi Priya,

Thanks for reaching out. I can see the charge you're asking about and
I want to make sure we explain it properly rather than guess.

I'm looping in our billing specialist who handles these cases, and
they'll reply here within one business day with the full breakdown.

Appreciate your patience.

— Alex, Billing Support`,
        flags: [],
      },
    ],
  },

  compliance: {
    key: 'compliance',
    label: 'Compliance',
    prompt: 'Review yesterday\'s 14 high-value wire transfers for unusual patterns and notify compliance@ with a summary of any flagged items.',
    cli: `$ semantix run --prompt "Review yesterday's wire transfers..." \\
    --data warehouse:wires.yesterday \\
    --policy ./policies/sox.yaml \\
    --notify compliance@acme.com`,
    intent: {
      directive: 'Scan yesterday\'s wires ≥ $100k for anomaly patterns and email compliance@ with a flagged-items summary.',
      boundaries: ['Read-only on warehouse', 'No outbound notifications except compliance@', 'No PII in email body'],
      success: 'One email sent to compliance@ summarizing flagged items with links to the warehouse rows.',
    },
    nodes: [
      { id: 'c1', title: 'Pull wires', type: 'tool', status: 'passed', grounding: 'grounded', confidence: 'high', risk: 'green', owner: 'phalanx', sources: 1, tools: 1, approval: false, sideEffect: false, x: 40, y: 40,
        purpose: 'Query warehouse for wires ≥ $100k from yesterday.',
        inputs: ['warehouse.wires'],
        constraints: { hard: ['Read-only', 'Max 1000 rows'], soft: [] },
        tools_visible: ['warehouse.query'],
        output: '14 rows',
        critique: null,
      },
      { id: 'c2', title: 'Anomaly scan', type: 'hybrid', status: 'warning', grounding: 'transformed', confidence: 'medium', risk: 'orange', owner: 'ct_mcp', sources: 14, tools: 0, approval: false, sideEffect: false, x: 220, y: 40,
        purpose: 'Deterministic rule pass + semantic judge to flag unusual patterns.',
        inputs: ['14 wires', 'last-90-days baseline'],
        constraints: { hard: ['Rules: round-number, new-counterparty, weekend, offshore'], soft: ['Judge: novelty > 0.6'] },
        tools_visible: [],
        output: '3 flagged (W-8821, W-8834, W-8847)',
        critique: {
          severity: 'semantic-match',
          summary: 'W-8834 flagged for "round-number" but is a legitimate payroll pattern repeated weekly. Verifier disagreement: 2/3.',
          suggestion: 'Suppress W-8834 or mark for reviewer to confirm.',
        },
      },
      { id: 'c3', title: 'Strip PII', type: 'deterministic', status: 'passed', grounding: 'grounded', confidence: 'high', risk: 'green', owner: 'hoplon', sources: 3, tools: 0, approval: false, sideEffect: false, x: 40, y: 180,
        purpose: 'Redact counterparty names, account numbers. Replace with warehouse row URLs.',
        inputs: ['3 flagged wires'],
        constraints: { hard: ['No PAN, no counterparty name', 'URLs only'], soft: [] },
        tools_visible: [],
        output: '3 redacted summaries',
        critique: null,
      },
      { id: 'c4', title: 'Draft email', type: 'semantic', status: 'waiting_review', grounding: 'grounded', confidence: 'high', risk: 'green', owner: 'semantix', sources: 3, tools: 0, approval: false, sideEffect: false, x: 220, y: 180,
        purpose: 'Compose summary email for compliance@.',
        inputs: ['3 redacted summaries'],
        constraints: { hard: ['To: compliance@acme.com only', 'No PII'], soft: ['Length ≤ 200 words'] },
        tools_visible: [],
        output: 'Email draft (164 words)',
        critique: null,
      },
      { id: 'c5', title: 'Send email', type: 'tool', status: 'blocked', grounding: 'grounded', confidence: 'high', risk: 'red', owner: 'guardrail', sources: 1, tools: 1, approval: true, sideEffect: true, x: 220, y: 320,
        purpose: 'Deliver email to compliance@. Irreversible.',
        inputs: ['Email draft'],
        constraints: { hard: ['Recipient ∈ {compliance@acme.com}', 'Approval required'], soft: [] },
        tools_visible: ['smtp.send'],
        output: 'BLOCKED — approval required',
        critique: {
          severity: 'policy',
          summary: 'Outbound email is irreversible. Policy requires approval for any send.',
          suggestion: 'Approve to send, or require per-item confirmation.',
        },
      },
    ],
    edges: [['c1','c2'],['c2','c3'],['c3','c4'],['c4','c5']],
    diff: [
      { id: 'cd1', kind: 'message', op: 'draft', target: 'Email → compliance@acme.com', summary: 'Summary · 3 flagged wires · no PII', node: 'c4', policy: 'pass', reversibility: 'reversible', owner: 'semantix', approved: false,
        preview: `To: compliance@acme.com
Subject: [Semantix] 3 flagged wires — 2026-04-21

The overnight anomaly scan flagged 3 of 14 wire transfers ≥ $100k for review:

  • W-8821 — new counterparty, offshore routing
    → warehouse://wires/W-8821
  • W-8834 — round-number, weekend settlement ⚠ verifier disagreement
    → warehouse://wires/W-8834
  • W-8847 — novel counterparty pair, 3x typical size
    → warehouse://wires/W-8847

No personally identifying information is included in this summary.
Full rows are viewable in the warehouse links above.

— Semantix run srv_8f1c`,
        flags: [],
      },
      { id: 'cd2', kind: 'api', op: 'smtp.send', target: 'compliance@acme.com', summary: 'Send email · irreversible', node: 'c5', policy: 'block', reversibility: 'irreversible', owner: 'guardrail', approved: false,
        preview: `POST smtp.internal.acme/send
  To: compliance@acme.com
  From: semantix-runner@acme.com
  Subject: [Semantix] 3 flagged wires — 2026-04-21
  (body: see draft above)`,
        flags: ['Outbound email is irreversible once sent', 'Approval required per policy'],
      },
    ],
  },
};

window.SEMANTIX_SCENARIOS = scenarios;

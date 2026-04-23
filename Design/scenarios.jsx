(function attachSemantixExamples(root) {
  const SCENARIOS = {
    swe: {
      key: "swe",
      label: "Engineering",
      prompt:
        "Add email verification to signup. Send a verification link, gate login until verified, and migrate existing users as pre-verified.",
      intent: {
        directive:
          "Add email verification flow to the signup path in services/auth, gated on successful email delivery.",
        boundaries: [
          "Do not modify billing or payments code paths",
          "Do not send real emails from dev/staging credentials",
          "Migration must not lock the users table for more than 5s",
        ],
        success:
          "New signups receive a verification email; login is blocked until verified; existing users are marked verified=true via reversible migration.",
      },
    },
    support: {
      key: "support",
      label: "Support",
      prompt:
        'Draft empathetic replies to the 3 tickets tagged "billing-urgent" from the last hour. Do not promise refunds. Match the tone of our last 20 approved replies.',
      intent: {
        directive:
          "Generate one reply per billing-urgent ticket matching approved tone, without promising refunds.",
        boundaries: [
          "No refund promises",
          "No mention of competitor products",
          "No ETA commitments beyond 48h",
        ],
        success:
          "3 draft replies produced, each passing tone and must-not checks, staged for human approval.",
      },
    },
    compliance: {
      key: "compliance",
      label: "Compliance",
      prompt:
        "Review yesterday's 14 high-value wire transfers for unusual patterns and notify compliance@ with a summary of any flagged items.",
      intent: {
        directive:
          "Scan yesterday's wires ≥ $100k for anomaly patterns and email compliance@ with a flagged-items summary.",
        boundaries: [
          "Read-only on warehouse",
          "No outbound notifications except compliance@",
          "No PII in email body",
        ],
        success:
          "One email sent to compliance@ summarizing flagged items with links to the warehouse rows.",
      },
    },
  };

  root.SEMANTIX_SCENARIOS = SCENARIOS;
})(typeof window !== "undefined" ? window : globalThis);

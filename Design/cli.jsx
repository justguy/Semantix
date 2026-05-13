// CLI-first artboard — a terminal rendering of the same review loop
// Different interaction model, same primitives: plan, graph, state diff,
// approve. Shows how Semantix could live as a `stx` command.

function SemantixCLI({ width = 760, height = 560 }) {
  const term = {
    bg: '#0e0c0a',
    panel: '#18140f',
    border: '#2a241c',
    text: '#ebe4d7',
    dim: '#8c8070',
    faint: '#5a5244',
    accent: '#e8a868',   // amber prompt
    green: '#7fb069',
    red: '#e07a5f',
    orange: '#f2a65a',
    yellow: '#e8c97a',
    purple: '#a78bfa',
    blue: '#7cafc2',
  };
  const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  // Color helpers
  const C = (color) => ({ color });
  const B = { fontWeight: 600 };

  // A compact tree of the SWE scenario — mimics the graph panel as ascii
  const tree = [
    ['  ●', term.green, 'n1', 'Parse intent'],
    ['  │', term.faint, '', ''],
    ['  ●', term.green, 'n2', 'Load repo context'],
    ['  │', term.faint, '', ''],
    ['  ●', term.red,   'n4', 'Draft verify endpoint'],
    ['  ├─●', term.orange, 'n5', 'Draft email dispatch'],
    ['  └─●', term.green, 'n3', 'Plan schema migration'],
    ['     │', term.faint, '', ''],
    ['     ●', term.green, 'n6', 'Wire into /auth router'],
    ['     │', term.faint, '', ''],
    ['     ●', term.green, 'n7', 'Add integration tests'],
    ['     │', term.faint, '', ''],
    ['     ●', term.yellow, 'n8', 'Generate migration notes'],
  ];

  const Line = ({ children, style = {} }) => (
    <div style={{ whiteSpace: 'pre', ...style }}>{children}</div>
  );

  return (
    <div style={{
      width, height, background: term.bg, color: term.text,
      fontFamily: mono, fontSize: 12, lineHeight: 1.5,
      padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* window chrome */}
      <div style={{
        height: 28, background: term.panel, borderBottom: `1px solid ${term.border}`,
        display: 'flex', alignItems: 'center', padding: '0 10px', gap: 6, flexShrink: 0,
      }}>
        <div style={{ width: 10, height: 10, borderRadius: 999, background: '#e07a5f' }} />
        <div style={{ width: 10, height: 10, borderRadius: 999, background: '#f2a65a' }} />
        <div style={{ width: 10, height: 10, borderRadius: 999, background: '#7fb069' }} />
        <div style={{ flex: 1, textAlign: 'center', color: term.faint, fontSize: 11 }}>
          ~/acme  —  stx  —  80×36
        </div>
      </div>

      <div style={{ flex: 1, padding: '14px 18px', overflow: 'auto' }}>
        <Line><span style={C(term.accent)}>$</span> <span>stx run</span> <span style={C(term.dim)}>"add email verification to signup, gated on delivery"</span></Line>
        <Line style={{ height: 6 }}>{' '}</Line>
        <Line style={C(term.dim)}>▸ compiling plan from services/auth, db/migrations, lib/email…</Line>
        <Line style={C(term.dim)}>▸ 8 nodes · 11 edges · run_8f1c</Line>
        <Line style={{ height: 10 }}>{' '}</Line>

        <Line style={{ ...C(term.dim), ...B }}>◎ execution graph</Line>
        {tree.map((row, i) => (
          <Line key={i}>
            <span style={C(row[1])}>{row[0]}</span>
            {row[2] && <span>  <span style={C(term.faint)}>{row[2]}</span>  <span>{row[3]}</span></span>}
          </Line>
        ))}
        <Line style={{ height: 10 }}>{' '}</Line>

        <Line style={{ ...C(term.dim), ...B }}>◎ state diff · what becomes real</Line>
        <Line>  <span style={C(term.green)}>+</span> <span style={C(term.blue)}>db/migrations/20250422_add_verified.sql</span>   <span style={C(term.faint)}>from</span> <span style={C(term.dim)}>n3</span></Line>
        <Line>    <span style={C(term.faint)}>+14 lines · reversible migration · </span><span style={C(term.green)}>policy pass</span></Line>
        <Line>  <span style={C(term.orange)}>~</span> <span style={C(term.blue)}>routes/auth.ts</span>                           <span style={C(term.faint)}>from</span> <span style={C(term.dim)}>n4</span></Line>
        <Line>    <span style={C(term.faint)}>+38/-0 lines · new /verify route · </span><span style={C(term.orange)}>needs review</span></Line>
        <Line>  <span style={C(term.orange)}>+</span> <span style={C(term.blue)}>lib/email/verify.ts</span>                       <span style={C(term.faint)}>from</span> <span style={C(term.dim)}>n5</span></Line>
        <Line>    <span style={C(term.faint)}>+22 lines · uses real SMTP creds · </span><span style={C(term.orange)}>needs review</span></Line>
        <Line>  <span style={C(term.red)}>✉</span> <span style={C(term.blue)}>smtp://mail.acme.internal</span>                  <span style={C(term.faint)}>from</span> <span style={C(term.dim)}>n5</span></Line>
        <Line>    <span style={C(term.faint)}>1 email to </span><span>reviewer@acme.dev </span><span style={C(term.red)}>· blocked by policy</span></Line>
        <Line>  <span style={C(term.green)}>+</span> <span style={C(term.blue)}>tests/auth.verify.test.ts</span>                 <span style={C(term.faint)}>from</span> <span style={C(term.dim)}>n7</span></Line>
        <Line>    <span style={C(term.faint)}>+47 lines · 4 cases</span></Line>
        <Line style={{ height: 10 }}>{' '}</Line>

        <Line style={{ ...C(term.orange), ...B }}>⚠ n4 · weak grounding</Line>
        <Line style={C(term.dim)}>  No existing token-signing utility was retrieved; draft invents</Line>
        <Line style={C(term.dim)}>  <span style={{ fontFamily: mono }}>signToken()</span>. Likely a bridged assumption.</Line>
        <Line style={C(term.blue)}>  → <span style={{ textDecoration: 'underline' }}>stx intervene n4 --add-source lib/crypto/tokens.ts</span></Line>
        <Line style={{ height: 14 }}>{' '}</Line>

        <Line style={C(term.faint)}>actions:</Line>
        <Line>  <span style={C(term.green)}>stx approve --all-unblocked</span>   <span style={C(term.dim)}>approve 4 of 5 changes</span></Line>
        <Line>  <span style={C(term.orange)}>stx review n4</span>                 <span style={C(term.dim)}>open diff in editor</span></Line>
        <Line>  <span style={C(term.red)}>stx revoke smtp</span>                <span style={C(term.dim)}>drop the blocked side effect</span></Line>
        <Line style={{ height: 10 }}>{' '}</Line>

        <Line>
          <span style={C(term.accent)}>$</span>{' '}
          <span style={{ background: term.text, color: term.bg, padding: '0 3px' }}>stx approve n3 n6 n7</span>
          <span style={{ display: 'inline-block', width: 7, height: 13, background: term.text, marginLeft: 2, verticalAlign: 'text-bottom', animation: 'stx-blink 1s steps(2) infinite' }} />
        </Line>
      </div>

      <style>{`@keyframes stx-blink { 0%, 50% { opacity: 1 } 50.01%, 100% { opacity: 0 } }`}</style>
    </div>
  );
}

Object.assign(window, { SemantixCLI });

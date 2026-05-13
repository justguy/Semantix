// Semantix Control Surface — main app
// Flow: prompt → compile → review (graph + inspector + diff) → approve → running → done
// Tweaks: theme (light/dark), graph layout (horizontal/vertical/radial)

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ---- Tokens ----
const THEMES = {
  light: {
    bg: '#fafaf9', panel: '#ffffff', panelAlt: '#f7f7f5',
    border: '#e7e5e0', borderStrong: '#d6d3cc',
    text: '#1c1b18', textDim: '#6b6a65', textFaint: '#9c9a94',
    accent: '#6b5cff', accentSoft: '#efeeff', accentText: '#4338ca',
    green: '#16a34a', greenSoft: '#dcfce7',
    yellow: '#ca8a04', yellowSoft: '#fef9c3',
    orange: '#ea580c', orangeSoft: '#ffedd5',
    red: '#dc2626', redSoft: '#fee2e2',
    shadow: '0 1px 2px rgba(20,19,17,.04), 0 1px 1px rgba(20,19,17,.02)',
    shadowLg: '0 4px 24px rgba(20,19,17,.06), 0 1px 2px rgba(20,19,17,.04)',
  },
  dark: {
    bg: '#14130f', panel: '#1c1b17', panelAlt: '#242320',
    border: '#2e2c28', borderStrong: '#3e3c37',
    text: '#f0eee8', textDim: '#9c9a94', textFaint: '#6b6a65',
    accent: '#8b7cff', accentSoft: '#2a2554', accentText: '#b5abff',
    green: '#4ade80', greenSoft: '#14321f',
    yellow: '#eab308', yellowSoft: '#3a2e0a',
    orange: '#fb923c', orangeSoft: '#3a1f0a',
    red: '#f87171', redSoft: '#3a1414',
    shadow: '0 1px 2px rgba(0,0,0,.3)',
    shadowLg: '0 4px 24px rgba(0,0,0,.4)',
  }
};

const RISK_TOKEN = (t, risk) => {
  const map = { green: [t.green, t.greenSoft], yellow: [t.yellow, t.yellowSoft], orange: [t.orange, t.orangeSoft], red: [t.red, t.redSoft] };
  const [fg, bg] = map[risk] || [t.textDim, t.panelAlt];
  return { fg, bg };
};

// ---- Small primitives ----
function Pill({ children, t, risk, strong, style }) {
  const { fg, bg } = risk ? RISK_TOKEN(t, risk) : { fg: t.textDim, bg: t.panelAlt };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, fontWeight: 500, letterSpacing: 0.1,
      padding: '2px 8px', borderRadius: 999,
      background: strong ? fg : bg,
      color: strong ? '#fff' : fg,
      border: `1px solid ${strong ? fg : 'transparent'}`,
      ...style,
    }}>{children}</span>
  );
}

function RiskDot({ t, risk, size = 8 }) {
  const { fg } = RISK_TOKEN(t, risk);
  return <span style={{ width: size, height: size, borderRadius: 999, background: fg, display: 'inline-block', flexShrink: 0 }} />;
}

function Btn({ t, children, onClick, variant = 'ghost', disabled, icon, style, title }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer', border: '1px solid transparent',
    transition: 'all 120ms', opacity: disabled ? 0.5 : 1,
    lineHeight: 1, whiteSpace: 'nowrap',
  };
  const variants = {
    primary: { background: t.accent, color: '#fff' },
    approve: { background: t.green, color: '#fff' },
    danger: { background: t.red, color: '#fff' },
    ghost: { background: 'transparent', color: t.text, border: `1px solid ${t.border}` },
    solid: { background: t.panelAlt, color: t.text, border: `1px solid ${t.border}` },
    link: { background: 'transparent', color: t.accent, padding: '4px 0' },
  };
  return (
    <button onClick={disabled ? undefined : onClick} title={title} style={{ ...base, ...variants[variant], ...style }}>
      {icon}{children}
    </button>
  );
}

function Card({ t, children, style, pad = 14 }) {
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, padding: pad, ...style }}>
      {children}
    </div>
  );
}

function Divider({ t, style }) {
  return <div style={{ height: 1, background: t.border, ...style }} />;
}

// ---- Icons (simple, hand-picked) ----
const Icon = {
  Spark: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>,
  Check: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12l5 5L20 7"/></svg>,
  X: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>,
  Block: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><circle cx="12" cy="12" r="9"/><path d="M5.5 5.5l13 13"/></svg>,
  Edit: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M16 3l5 5-11 11H5v-5L16 3z"/></svg>,
  Play: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M7 5v14l12-7z"/></svg>,
  Chevron: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><path d="M9 6l6 6-6 6"/></svg>,
  File: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/></svg>,
  Api: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M4 12h6M14 12h6M10 8v8M14 8v8"/></svg>,
  Mail: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 7 9-7"/></svg>,
  Ext: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M7 7h10v10"/><path d="M7 17L17 7"/></svg>,
  Alert: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" {...p}><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>,
  Lock: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>,
  Refresh: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><path d="M4 11a8 8 0 0114-5l2 2"/><path d="M20 13a8 8 0 01-14 5l-2-2"/><path d="M20 4v4h-4M4 20v-4h4"/></svg>,
  Dot: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...p}><circle cx="12" cy="12" r="3"/></svg>,
};

const KIND_ICON = {
  file: Icon.File, api: Icon.Api, external: Icon.Ext, message: Icon.Mail, database: Icon.Api, command: Icon.Ext,
};

Object.assign(window, { THEMES, RISK_TOKEN, Pill, RiskDot, Btn, Card, Divider, Icon, KIND_ICON });

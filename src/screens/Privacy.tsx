import { T } from '../design/tokens';

const LAST_UPDATED = 'May 11, 2026';

export function Privacy() {
  return (
    <main
      className="responsive-pad"
      style={{
        maxWidth: 760,
        margin: '0 auto',
        paddingTop: 48,
        paddingBottom: 96,
        color: T.ink,
      }}
    >
      <a
        href="/"
        style={{
          fontFamily: T.mono,
          fontSize: 12,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: T.muted,
          textDecoration: 'none',
          display: 'inline-block',
          marginBottom: 24,
        }}
      >
        ← Home
      </a>

      <h1
        style={{
          fontFamily: T.sans,
          fontSize: 'clamp(32px, 6vw, 48px)',
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: '-0.025em',
          margin: '0 0 8px',
        }}
      >
        Privacy Policy
      </h1>
      <p style={{ fontSize: 13, color: T.muted, fontFamily: T.mono, letterSpacing: '0.1em', marginBottom: 36 }}>
        LAST UPDATED · {LAST_UPDATED.toUpperCase()}
      </p>

      <Section title="What we collect">
        <ul style={listStyle}>
          <li><strong>Account info</strong>: email address (and optionally first name + profile photo) via Clerk.</li>
          <li><strong>Walkthrough content</strong>: math problems you submit and the walkthroughs produced in response.</li>
          <li><strong>Usage data</strong>: which topics you open, daily walkthrough counts (for rate-limit accounting).</li>
          <li><strong>Subscription state</strong>: tier, plan interval, renewal date, Stripe customer ID. Card numbers are handled by Stripe and never touch our servers.</li>
          <li><strong>Technical</strong>: standard request metadata (IP, user-agent) for rate-limiting anonymous users and basic abuse prevention.</li>
        </ul>
      </Section>

      <Section title="How we use it">
        <ul style={listStyle}>
          <li>Deliver walkthroughs (sending your problem text to AI providers — see below).</li>
          <li>Maintain your account and subscription.</li>
          <li>Show your walkthrough history (you control retention via the History screen).</li>
          <li>Enforce daily usage limits.</li>
          <li>Diagnose errors and improve the Service (aggregated, not identifying you individually).</li>
        </ul>
      </Section>

      <Section title="Third parties we share with">
        <ul style={listStyle}>
          <li><strong>Anthropic</strong> — your problem text is sent to Claude to produce walkthroughs.</li>
          <li><strong>Clerk</strong> — handles authentication. Stores your email and profile data.</li>
          <li><strong>Stripe</strong> — processes payments. Stores your card and billing details.</li>
          <li><strong>Cloudflare</strong> — hosts our worker and stores your walkthrough history (KV).</li>
          <li><strong>Vercel</strong> — hosts the frontend.</li>
        </ul>
        We don't sell your data, don't share it with advertisers, and don't use it for any purpose beyond delivering the Service.
      </Section>

      <Section title="Retention">
        Walkthrough history is retained for 90 days, then auto-deleted. You can delete individual entries any time from the History screen. Account and subscription data is retained while your account is active and for a reasonable period afterward for billing/legal records.
      </Section>

      <Section title="Your rights">
        You can: view and delete walkthrough history any time; cancel your subscription via Settings; close your account (contact us); request a copy of your data; request deletion of personal data. We aim to respond to data requests within 30 days.
      </Section>

      <Section title="Cookies and storage">
        We use localStorage for small preferences (walkthrough pace setting, dismissed install prompt). Clerk uses cookies for authentication. We do not use third-party analytics or advertising cookies.
      </Section>

      <Section title="Security">
        All traffic is over HTTPS. Secrets are stored as Cloudflare Worker secrets (not in source). Payment data is handled by Stripe and never reaches our servers. We rotate keys when needed and aim to remediate any vulnerability promptly.
      </Section>

      <Section title="Children">
        MathIQ is intended for college students. We don't knowingly collect data from children under 13. If you believe a child has provided personal data, contact us and we'll delete it.
      </Section>

      <Section title="Changes">
        We may update this policy. Material changes will be announced via email or in-app notice at least 14 days before they take effect.
      </Section>

      <Section title="Contact">
        For questions about this Privacy Policy, contact <a href="mailto:math.iq.support@gmail.com" style={{ color: T.accent }}>math.iq.support@gmail.com</a>.
      </Section>

      <p style={{ marginTop: 56, padding: '14px 18px', border: `1px solid ${T.hair}`, fontSize: 13, color: T.muted, fontFamily: T.mono, lineHeight: 1.55 }}>
        This policy is a starting draft. Before relying on it at scale, have a lawyer review for your jurisdiction (especially GDPR / CCPA / state-level requirements).
      </p>
    </main>
  );
}

const listStyle: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.7,
  margin: '0 0 0 18px',
  padding: 0,
  color: T.ink,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2
        style={{
          fontFamily: T.sans,
          fontSize: 17,
          fontWeight: 700,
          margin: '0 0 8px',
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h2>
      <div style={{ fontSize: 15, lineHeight: 1.6, color: T.ink }}>{children}</div>
    </section>
  );
}

import { T } from '../design/tokens';

const LAST_UPDATED = 'May 11, 2026';

export function Terms() {
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
        Terms of Service
      </h1>
      <p style={{ fontSize: 13, color: T.muted, fontFamily: T.mono, letterSpacing: '0.1em', marginBottom: 36 }}>
        LAST UPDATED · {LAST_UPDATED.toUpperCase()}
      </p>

      <Section title="1. Acceptance">
        By creating an account or using MathIQ ("the Service"), you agree to these Terms. If you do not agree, do not use the Service.
      </Section>

      <Section title="2. The service">
        MathIQ provides AI-generated step-by-step walkthroughs of college math problems. Walkthroughs are produced by third-party language models and may contain errors. You are responsible for verifying any answer you rely on for academic, professional, or other consequential use.
      </Section>

      <Section title="3. Accounts">
        You must provide a valid email to create an account. You are responsible for activity on your account. We may suspend accounts that violate these Terms, abuse the Service, or attempt to disrupt other users.
      </Section>

      <Section title="4. Subscriptions, billing, and cancellation">
        Paid plans (MathIQ+ and MathIQ Pro) are billed monthly or annually via Stripe. By subscribing, you authorize recurring charges until you cancel. You can cancel at any time from Settings → Manage subscription; access continues until the end of the paid period. Refunds for partial periods are at our discretion. Prices may change with at least 30 days' notice.
      </Section>

      <Section title="5. Acceptable use">
        Don't use the Service to: (a) generate content that violates law; (b) reverse-engineer, scrape, or resell the Service; (c) attempt to bypass usage limits or extract bulk data; (d) impersonate others. We may terminate accounts that violate this section.
      </Section>

      <Section title="6. Content">
        The math problems you submit, and the walkthroughs the Service produces in response, belong to you. You grant us a limited license to process them for the purpose of delivering the Service (sending to AI providers, storing your walkthrough history). We may use aggregated, anonymized usage statistics to improve the Service.
      </Section>

      <Section title="7. Intellectual property">
        MathIQ's design, codebase, brand, course catalog, and curated content (strategic anchors, example problems) are our property. You may not copy, redistribute, or build a competing product from them without permission.
      </Section>

      <Section title="8. Disclaimers and limits">
        The Service is provided "as is" without warranty of any kind. We make no guarantee that walkthroughs are correct, complete, or suitable for any particular use. To the maximum extent permitted by law, our liability for any claim arising out of the Service is limited to the amount you paid us in the 12 months before the claim.
      </Section>

      <Section title="9. Changes">
        We may update these Terms. Material changes will be announced via email or in-app notice at least 14 days before they take effect. Continued use after the effective date is acceptance.
      </Section>

      <Section title="10. Contact">
        For questions about these Terms, contact <a href="mailto:support@mathiq.app" style={{ color: T.accent }}>support@mathiq.app</a>.
      </Section>

      <p style={{ marginTop: 56, padding: '14px 18px', border: `1px solid ${T.hair}`, fontSize: 13, color: T.muted, fontFamily: T.mono, lineHeight: 1.55 }}>
        These terms are a starting draft. Before relying on them for production at scale, have a lawyer review and tailor them to your jurisdiction.
      </p>
    </main>
  );
}

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
      <p style={{ fontSize: 15, lineHeight: 1.6, margin: 0, color: T.ink }}>{children}</p>
    </section>
  );
}

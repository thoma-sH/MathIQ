/**
 * Pricing — the public marketing page for the three tiers.
 *
 * Lives at /pricing as a real URL (not internal route state) so links
 * shared in tweets / docs / Stripe redirects work. Layout: tier comparison
 * with monthly / annual toggle and a feature matrix below. CTAs route
 * through startCheckout for signed-in users and Clerk's SignInButton
 * for anonymous visitors.
 *
 * Reuse note: prices come from the same PLAN_PRICES table that Settings
 * shows, just presented as marketing-shaped cards instead of "your
 * current plan" rows.
 */
import { useState } from 'react';
import { SignedIn, SignedOut, SignInButton, useAuth } from '@clerk/clerk-react';
import { CheckIcon } from '../design/icons';
import { T } from '../design/tokens';
import { startCheckout, type Interval, type Tier as PaidTier } from '../billing/client';

interface PricingProps {
  /** Used by the "← Home" link. When undefined the link routes to "/" via
   *  window.location for users who landed on /pricing directly. */
  onBack?: () => void;
}

const PLAN_PRICES: Record<PaidTier, Record<Interval, { display: string; sub: string }>> = {
  plus: {
    monthly: { display: '$7.99', sub: 'per month' },
    semester: { display: '$25.99', sub: 'one-time · 4 months · $6.50/mo · 19% off' },
    annual: { display: '$5.99', sub: '/ month · billed $71.88 annually · save 25%' },
  },
  pro: {
    monthly: { display: '$12.99', sub: 'per month' },
    semester: { display: '$41.99', sub: 'one-time · 4 months · $10.50/mo · 19% off' },
    annual: { display: '$9.99', sub: '/ month · billed $119.88 annually · save 23%' },
  },
};

interface FeatureRow {
  label: string;
  detail?: string;
  free: string | boolean;
  plus: string | boolean;
  pro: string | boolean;
}

const FEATURES: FeatureRow[] = [
  {
    label: 'Daily walkthroughs',
    detail: 'Type a problem; Iris walks you through every move',
    free: '3 / day',
    plus: '25 / day',
    pro: '38 / day',
  },
  {
    label: 'Premium model',
    detail: 'Claude Opus 4.6 — best for hard problems',
    free: false,
    plus: '5 / day · 100 / mo',
    pro: '8 / day · 150 / mo',
  },
  {
    label: 'Why & how reflection',
    detail: 'Tap any step for the strategic motivation behind it',
    free: false,
    plus: true,
    pro: true,
  },
  {
    label: 'Photo input',
    detail: 'Snap a textbook problem instead of typing',
    free: false,
    plus: true,
    pro: true,
  },
  {
    label: 'Walkthrough history',
    detail: '90 days of past work, searchable',
    free: false,
    plus: true,
    pro: true,
  },
  {
    label: 'Save walkthrough as PDF',
    detail: 'Browser print → clean printable record',
    free: false,
    plus: true,
    pro: true,
  },
  {
    label: 'Handwritten to PDF',
    detail: 'Upload your handwritten work, get a transcribed PDF',
    free: false,
    plus: true,
    pro: true,
  },
  {
    label: 'LaTeX Mode',
    detail: 'Compile your handwriting into a Computer Modern-typeset PDF',
    free: false,
    plus: false,
    pro: true,
  },
  {
    label: 'Exam Mode',
    detail: 'Generate full college exams, 10–15 problems each',
    free: false,
    plus: false,
    pro: true,
  },
  {
    label: 'Exam grading',
    detail: 'Upload your handwritten attempt, get per-problem scores',
    free: false,
    plus: false,
    pro: true,
  },
  {
    label: 'Daily Challenge LaTeX',
    detail: 'Render your Daily Challenge work as a typeset PDF, 1 / day',
    free: false,
    plus: false,
    pro: true,
  },
];

export function Pricing({ onBack }: PricingProps) {
  const { getToken } = useAuth();
  const [interval, setInterval] = useState<Interval>('annual');
  const [pending, setPending] = useState<PaidTier | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubscribe(tier: PaidTier) {
    setError(null);
    setPending(tier);
    try {
      await startCheckout({ tier, interval, getToken });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
      setPending(null);
    }
  }

  function goHome() {
    if (onBack) onBack();
    else window.location.assign('/');
  }

  return (
    <main
      className="responsive-pad"
      style={{
        maxWidth: 1080,
        margin: '0 auto',
        paddingTop: 32,
        paddingBottom: 96,
      }}
    >
      <button
        type="button"
        onClick={goHome}
        className="btn-press"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          fontSize: 13,
          fontFamily: T.mono,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: T.muted,
          cursor: 'pointer',
          marginBottom: 24,
        }}
      >
        ← MathIQ
      </button>

      <h1
        style={{
          fontFamily: T.sans,
          fontSize: 'clamp(36px, 7vw, 56px)',
          fontWeight: 700,
          lineHeight: 1.0,
          letterSpacing: '-0.025em',
          margin: '0 0 12px',
        }}
      >
        Plans built for math students.
      </h1>
      <p
        style={{
          fontSize: 17,
          color: T.muted,
          lineHeight: 1.55,
          margin: '0 0 32px',
          maxWidth: 620,
        }}
      >
        Start free. Upgrade when you outgrow it. Plus adds Opus 4.6, photo
        input, and the Handwritten to PDF feature. Pro adds LaTeX Mode and
        Exam Mode — the things you actually pay for.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, alignItems: 'center' }}>
        <span
          style={{
            fontSize: 11,
            fontFamily: T.mono,
            letterSpacing: '0.14em',
            color: T.muted,
            textTransform: 'uppercase',
            marginRight: 4,
          }}
        >
          Billing
        </span>
        <IntervalChip
          value="annual"
          current={interval}
          onSelect={setInterval}
          label="Annual"
          badge="save 23%+"
        />
        <IntervalChip
          value="semester"
          current={interval}
          onSelect={setInterval}
          label="Semester"
          badge="4 mo · 19% off"
        />
        <IntervalChip
          value="monthly"
          current={interval}
          onSelect={setInterval}
          label="Monthly"
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 14,
          marginBottom: 36,
        }}
      >
        <TierCard
          tierLabel="Free"
          headline="$0"
          subline="forever"
          blurb="Three daily walkthroughs on Haiku 4.5. No card required."
          highlights={[
            '3 walkthroughs / day',
            'Haiku 4.5 model',
            'Step-by-step explanations',
          ]}
        >
          <SignedIn>
            <span
              style={{
                fontSize: 12,
                fontFamily: T.mono,
                letterSpacing: '0.1em',
                color: T.muted,
              }}
            >
              You're already signed in.
            </span>
          </SignedIn>
          <SignedOut>
            <SignInButton mode="modal">
              <button
                className="btn-press chamfer"
                style={{
                  background: 'transparent',
                  color: T.ink,
                  border: `1px solid ${T.ink}`,
                  padding: '10px 18px',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: T.sans,
                  width: '100%',
                }}
              >
                Sign in for free
              </button>
            </SignInButton>
          </SignedOut>
        </TierCard>

        <TierCard
          tierLabel="MathIQ+"
          headline={PLAN_PRICES.plus[interval].display}
          subline={PLAN_PRICES.plus[interval].sub}
          blurb="The premium model, photo input, why-how, and Handwritten to PDF."
          highlights={[
            '25 walkthroughs / day (5 Opus + 20 Sonnet)',
            'Why & how reflection',
            'Photo input',
            'Handwritten to PDF',
            'Walkthrough history + PDF export',
          ]}
          accent
        >
          <SubscribeButton
            label="Start MathIQ+"
            pending={pending === 'plus'}
            onClick={() => onSubscribe('plus')}
          />
        </TierCard>

        <TierCard
          tierLabel="MathIQ Pro"
          headline={PLAN_PRICES.pro[interval].display}
          subline={PLAN_PRICES.pro[interval].sub}
          blurb="Everything in Plus, plus LaTeX Mode, Exam Mode, and grading."
          highlights={[
            '38 walkthroughs / day (8 Opus + 30 Sonnet)',
            'LaTeX Mode — typeset PDFs',
            'Exam Mode — generate full exams',
            'Exam grading',
            'Daily Challenge LaTeX render',
            'Everything in Plus',
          ]}
          ribbon="Best for serious students"
        >
          <SubscribeButton
            label="Start MathIQ Pro"
            pending={pending === 'pro'}
            onClick={() => onSubscribe('pro')}
          />
        </TierCard>
      </div>

      {error && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginBottom: 24,
            padding: '10px 14px',
            border: `1px solid ${T.ink}`,
            background: T.paper2,
            fontSize: 13,
            color: T.ink,
            fontFamily: T.mono,
          }}
        >
          {error}
        </div>
      )}

      <LatexShowcase />

      <h2
        style={{
          fontFamily: T.sans,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          margin: '40px 0 14px',
        }}
      >
        What's included
      </h2>

      <div
        style={{
          border: `1px solid ${T.ink}`,
          background: T.paper,
          overflowX: 'auto',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: T.sans,
            fontSize: 14,
          }}
        >
          <thead>
            <tr>
              <th style={featureMatrixHeaderCell} aria-label="Feature">
                Feature
              </th>
              <th style={featureMatrixHeaderCellCenter}>Free</th>
              <th style={featureMatrixHeaderCellCenter}>MathIQ+</th>
              <th style={featureMatrixHeaderCellCenter}>MathIQ Pro</th>
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f, i) => (
              <tr
                key={f.label}
                style={{
                  borderTop: `1px solid ${T.hair}`,
                  background: i % 2 === 0 ? 'transparent' : T.paper2,
                }}
              >
                <td style={featureMatrixCell}>
                  <div style={{ fontWeight: 600 }}>{f.label}</div>
                  {f.detail && (
                    <div
                      style={{
                        fontSize: 12,
                        color: T.muted,
                        marginTop: 2,
                        lineHeight: 1.4,
                      }}
                    >
                      {f.detail}
                    </div>
                  )}
                </td>
                <td style={featureMatrixCellCenter}>{renderCell(f.free)}</td>
                <td style={featureMatrixCellCenter}>{renderCell(f.plus)}</td>
                <td style={featureMatrixCellCenter}>{renderCell(f.pro)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p
        style={{
          marginTop: 24,
          fontSize: 13,
          color: T.muted,
          lineHeight: 1.55,
          fontFamily: T.mono,
          letterSpacing: '0.04em',
        }}
      >
        Cancel anytime from your Settings page. No prorated refunds; your tier
        is active through the end of the current billing period.
      </p>
    </main>
  );
}

function LatexShowcase() {
  const [flipped, setFlipped] = useState(false);
  return (
    <section style={{ margin: '48px 0 12px' }}>
      <div
        style={{
          fontSize: 11,
          fontFamily: T.mono,
          letterSpacing: '0.18em',
          color: T.muted,
          textTransform: 'uppercase',
          marginBottom: 10,
        }}
      >
        Pro · LaTeX Mode
      </div>
      <h2
        style={{
          fontFamily: T.sans,
          fontSize: 'clamp(24px, 4vw, 32px)',
          fontWeight: 700,
          letterSpacing: '-0.015em',
          margin: '0 0 8px',
        }}
      >
        Hand it in. Typed.
      </h2>
      <p
        style={{
          fontSize: 15,
          color: T.muted,
          lineHeight: 1.55,
          margin: '0 0 20px',
          maxWidth: 560,
        }}
      >
        Snap your handwritten work. Iris reads it, fixes notation, and renders a
        Computer Modern PDF in the exact LaTeX a professor expects. Tap the
        page to see it transform.
      </p>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={
          flipped
            ? 'Show original handwritten page'
            : 'Show typeset LaTeX result'
        }
        className="btn-press"
        style={{
          position: 'relative',
          display: 'block',
          width: '100%',
          maxWidth: 720,
          margin: '0 auto',
          aspectRatio: '4 / 5',
          background: T.paper,
          border: `1px solid ${T.ink}`,
          padding: 0,
          cursor: 'pointer',
          overflow: 'hidden',
        }}
      >
        <img
          src="/latex-before.jpg"
          alt="Handwritten homework on lined paper"
          loading="lazy"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            objectPosition: 'center',
            opacity: flipped ? 0 : 1,
            transition: 'opacity 700ms ease',
            background: T.paper,
          }}
        />
        <img
          src="/latex-after.jpg"
          alt="Same homework typeset as a Computer Modern LaTeX PDF"
          loading="lazy"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            objectPosition: 'center',
            opacity: flipped ? 1 : 0,
            transition: 'opacity 700ms ease',
            background: T.paper,
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            bottom: 14,
            right: 14,
            background: T.accent,
            color: T.paper,
            padding: '8px 14px',
            fontSize: 11,
            fontFamily: T.mono,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            boxShadow: '0 2px 8px rgba(26, 43, 26, 0.25)',
            transition: 'transform 300ms ease',
            transform: flipped ? 'translateX(-2px)' : 'translateX(0)',
          }}
        >
          {flipped ? '← Original' : 'Typeset →'}
        </div>
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 14,
            left: 14,
            background: 'rgba(255, 255, 255, 0.92)',
            color: T.ink,
            padding: '6px 12px',
            fontSize: 10,
            fontFamily: T.mono,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            border: `1px solid ${T.ink}`,
            opacity: flipped ? 1 : 0,
            transition: 'opacity 700ms ease',
          }}
        >
          After
        </div>
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 14,
            left: 14,
            background: 'rgba(255, 255, 255, 0.92)',
            color: T.ink,
            padding: '6px 12px',
            fontSize: 10,
            fontFamily: T.mono,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            border: `1px solid ${T.ink}`,
            opacity: flipped ? 0 : 1,
            transition: 'opacity 700ms ease',
          }}
        >
          Before
        </div>
      </button>
    </section>
  );
}

function TierCard({
  tierLabel,
  headline,
  subline,
  blurb,
  highlights,
  accent,
  ribbon,
  children,
}: {
  tierLabel: string;
  headline: string;
  subline: string;
  blurb: string;
  highlights: string[];
  accent?: boolean;
  ribbon?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: 'relative',
        padding: '24px 22px',
        border: `1px solid ${T.ink}`,
        background: accent ? T.paper2 : T.paper,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {ribbon && (
        <div
          style={{
            position: 'absolute',
            top: -1,
            right: 14,
            background: T.accent,
            color: T.paper,
            fontFamily: T.mono,
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            padding: '4px 10px',
          }}
        >
          {ribbon}
        </div>
      )}
      <div
        style={{
          fontSize: 11,
          fontFamily: T.mono,
          letterSpacing: '0.18em',
          color: T.muted,
          textTransform: 'uppercase',
        }}
      >
        {tierLabel}
      </div>
      <div>
        <div
          style={{
            fontFamily: T.sans,
            fontSize: 36,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1,
          }}
        >
          {headline}
        </div>
        <div
          style={{
            fontSize: 12,
            fontFamily: T.mono,
            color: T.muted,
            letterSpacing: '0.06em',
            marginTop: 4,
          }}
        >
          {subline}
        </div>
      </div>
      <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.5 }}>{blurb}</div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          fontSize: 13,
          color: T.ink,
          lineHeight: 1.5,
        }}
      >
        {highlights.map((h) => (
          <li key={h} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span
              aria-hidden
              style={{
                color: T.accent3,
                fontSize: 14,
                lineHeight: 1.4,
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <CheckIcon size="14px" />
            </span>
            <span>{h}</span>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 'auto', paddingTop: 8 }}>{children}</div>
    </div>
  );
}

function SubscribeButton({
  label,
  pending,
  onClick,
}: {
  label: string;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">
          <button
            className="btn-press chamfer"
            style={{
              background: T.accent,
              color: T.paper,
              border: 'none',
              padding: '12px 18px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: T.sans,
              width: '100%',
            }}
          >
            Sign in to {label.toLowerCase()}
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className="btn-press chamfer"
          style={{
            background: T.accent,
            color: T.paper,
            border: 'none',
            padding: '12px 18px',
            fontSize: 14,
            fontWeight: 600,
            cursor: pending ? 'wait' : 'pointer',
            fontFamily: T.sans,
            width: '100%',
            opacity: pending ? 0.7 : 1,
          }}
        >
          {pending ? 'Starting checkout…' : label + ' →'}
        </button>
      </SignedIn>
    </>
  );
}

function IntervalChip({
  value,
  current,
  onSelect,
  label,
  badge,
}: {
  value: Interval;
  current: Interval;
  onSelect: (v: Interval) => void;
  label: string;
  badge?: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className="btn-press"
      style={{
        background: active ? T.ink : 'transparent',
        color: active ? T.paper : T.ink,
        border: `1px solid ${T.ink}`,
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 500,
        fontFamily: T.mono,
        letterSpacing: '0.06em',
        cursor: 'pointer',
        display: 'inline-flex',
        gap: 6,
        alignItems: 'center',
      }}
    >
      {label}
      {badge && (
        <span
          style={{
            fontSize: 10,
            padding: '1px 5px',
            border: `1px solid ${active ? T.paper : T.ink}`,
            opacity: active ? 1 : 0.7,
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function renderCell(value: string | boolean): React.ReactNode {
  if (value === true) {
    return (
      <span
        style={{ color: T.accent3, fontSize: 16, display: 'inline-flex', alignItems: 'center' }}
        aria-label="Included"
      >
        <CheckIcon size="16px" />
      </span>
    );
  }
  if (value === false) {
    return (
      <span style={{ color: T.muted, fontSize: 16 }} aria-label="Not included">
        —
      </span>
    );
  }
  return <span style={{ fontWeight: 500, fontSize: 13 }}>{value}</span>;
}

const featureMatrixHeaderCell: React.CSSProperties = {
  padding: '12px 16px',
  textAlign: 'left',
  fontFamily: T.mono,
  fontSize: 11,
  letterSpacing: '0.14em',
  color: T.muted,
  textTransform: 'uppercase',
  fontWeight: 500,
  borderBottom: `1.5px solid ${T.ink}`,
};

const featureMatrixHeaderCellCenter: React.CSSProperties = {
  ...featureMatrixHeaderCell,
  textAlign: 'center',
  width: '14%',
  minWidth: 90,
};

const featureMatrixCell: React.CSSProperties = {
  padding: '14px 16px',
  textAlign: 'left',
  verticalAlign: 'top',
};

const featureMatrixCellCenter: React.CSSProperties = {
  ...featureMatrixCell,
  textAlign: 'center',
  verticalAlign: 'middle',
};

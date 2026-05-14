/**
 * Global upgrade prompt.
 *
 * A single modal that appears whenever a user tries to use a feature their
 * current tier doesn't grant. Instead of routing to Settings or letting them
 * land on a screen where every CTA is greyed out, we surface the value prop
 * + pricing inline and trigger Stripe checkout right from the modal.
 *
 * Usage from any component:
 *
 *   const { requireUpgrade } = useUpgradePrompt();
 *
 *   <button onClick={() => {
 *     if (!isPaid(tier)) {
 *       requireUpgrade('walkthrough-pdf');
 *       return;
 *     }
 *     doTheThing();
 *   }} />
 *
 * Anonymous users see a sign-in CTA first; signed-in users see plans + price
 * + an annual/monthly toggle and can check out without leaving the modal.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  SignedIn,
  SignedOut,
  SignInButton,
  useAuth,
} from '@clerk/clerk-react';
import { T } from '../design/tokens';
import {
  startCheckout,
  fetchSubscriptionState,
  type Interval,
  type Tier as PaidTier,
} from '../billing/client';

// ── Feature catalog ─────────────────────────────────────────────────────────

export type LockedFeature =
  | 'exam-mode'
  | 'exam-grade'
  | 'walkthrough-pdf'
  | 'homework-plain'
  | 'homework-latex'
  | 'why-how'
  | 'photo-input';

interface FeatureMeta {
  /** Small label above the title — e.g. "EXAM MODE · PRO". */
  kicker: string;
  /** One-line headline. */
  title: string;
  /** 1-2 sentence value prop. */
  blurb: string;
  /** Lowest tier that grants this feature. */
  requiredTier: PaidTier;
}

const FEATURE_META: Record<LockedFeature, FeatureMeta> = {
  'exam-mode': {
    kicker: 'EXAM MODE · PRO',
    title: 'Generate real college exams.',
    blurb:
      'Four exams per course, freshly generated each time — print-ready, no hints, professionally formatted. Includes Iris-graded uploads of your handwritten attempts.',
    requiredTier: 'pro',
  },
  'exam-grade': {
    kicker: 'EXAM GRADING · PRO',
    title: 'Grade your handwritten attempts.',
    blurb:
      'Upload a photo or PDF of your completed exam. Iris transcribes every line via Mathpix, scores each problem with partial credit, and flags topics to review.',
    requiredTier: 'pro',
  },
  'walkthrough-pdf': {
    kicker: 'WALKTHROUGH PDF · PLUS',
    title: 'Save walkthroughs as print-ready PDFs.',
    blurb:
      "Open any past walkthrough from your history and export it as a clean PDF. Math renders properly, and the layout is paginated for easy reading offline.",
    requiredTier: 'plus',
  },
  'homework-plain': {
    kicker: 'HANDWRITTEN TO PDF · PLUS',
    title: 'Turn handwriting into a clean PDF.',
    blurb:
      'Upload a photo or scan of your handwritten work. Iris transcribes the math, formats it neatly, and outputs a PDF you can actually turn in. Pro includes this plus LaTeX Mode.',
    requiredTier: 'plus',
  },
  'homework-latex': {
    kicker: 'LATEX MODE · PRO',
    title: 'Typeset your homework in real LaTeX.',
    blurb:
      'Pro includes Handwritten to PDF and adds LaTeX Mode on top — your handwriting compiled into a Computer Modern-typeset PDF, indistinguishable from an Overleaf paper.',
    requiredTier: 'pro',
  },
  'why-how': {
    kicker: 'WHY & HOW · PLUS',
    title: 'See the strategy behind every step.',
    blurb:
      "Tap 'Why & how' on any step in a walkthrough and Iris explains the strategic motivation — when this technique is the right move and how it works under the hood.",
    requiredTier: 'plus',
  },
  'photo-input': {
    kicker: 'PHOTO INPUT · PLUS',
    title: 'Snap a photo instead of typing.',
    blurb:
      "Take a picture of a textbook problem or your own handwriting. Iris extracts the LaTeX automatically — no more retyping integrals.",
    requiredTier: 'plus',
  },
};

// ── Pricing ─────────────────────────────────────────────────────────────────

const PLAN_PRICES: Record<PaidTier, Record<Interval, { display: string; tagline: string }>> = {
  plus: {
    monthly: { display: '$7.99 / mo', tagline: 'billed monthly' },
    annual: { display: '$4.99 / mo', tagline: 'billed $59.88 / year' },
  },
  pro: {
    monthly: { display: '$29.99 / mo', tagline: 'billed monthly' },
    annual: { display: '$19.99 / mo', tagline: 'billed $239.88 / year' },
  },
};

const PLAN_LABEL: Record<PaidTier, string> = {
  plus: 'MathIQ+',
  pro: 'MathIQ Pro',
};

const SAVINGS_BADGE: Record<PaidTier, string> = {
  plus: 'save 37%',
  pro: 'save 33%',
};

// ── Context ─────────────────────────────────────────────────────────────────

interface UpgradePromptContextValue {
  requireUpgrade: (feature: LockedFeature) => void;
  close: () => void;
}

const UpgradePromptContext = createContext<UpgradePromptContextValue | null>(null);

export function useUpgradePrompt(): UpgradePromptContextValue {
  const ctx = useContext(UpgradePromptContext);
  if (!ctx) throw new Error('useUpgradePrompt must be used inside <UpgradeProvider>');
  return ctx;
}

export function UpgradeProvider({ children }: { children: ReactNode }) {
  const [feature, setFeature] = useState<LockedFeature | null>(null);

  const requireUpgrade = useCallback((f: LockedFeature) => setFeature(f), []);
  const close = useCallback(() => setFeature(null), []);

  // Esc to close.
  useEffect(() => {
    if (!feature) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFeature(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [feature]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!feature) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [feature]);

  const value = useMemo(() => ({ requireUpgrade, close }), [requireUpgrade, close]);

  return (
    <UpgradePromptContext.Provider value={value}>
      {children}
      {feature && <UpgradeModal feature={feature} onClose={close} />}
    </UpgradePromptContext.Provider>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────────

function UpgradeModal({ feature, onClose }: { feature: LockedFeature; onClose: () => void }) {
  const meta = FEATURE_META[feature];
  const { getToken } = useAuth();
  const [interval, setIntervalChoice] = useState<Interval>('annual');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTier, setCurrentTier] = useState<PaidTier | null>(null);

  // Resolve the user's current tier so we don't show "Upgrade to Plus" when
  // they already have Plus. Pro users will never see this modal since every
  // feature is unlocked.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sub = await fetchSubscriptionState({ getToken });
      if (!cancelled) setCurrentTier(sub?.tier ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  // If the feature requires Plus but the user is already on Plus (or higher),
  // they must have hit this modal due to a stale tier read — close it.
  useEffect(() => {
    if (currentTier === 'pro') onClose();
    if (currentTier === 'plus' && meta.requiredTier === 'plus') onClose();
  }, [currentTier, meta.requiredTier, onClose]);

  // If the user has Plus and the feature requires Pro, pitch Pro (not Plus).
  const pitchTier: PaidTier = meta.requiredTier;
  const price = PLAN_PRICES[pitchTier][interval];

  async function onSubscribe() {
    setError(null);
    setPending(true);
    try {
      await startCheckout({ tier: pitchTier, interval, getToken });
      // startCheckout redirects on success; if it returns we got back fast.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
      setPending(false);
    }
  }

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-title"
      className="upgrade-backdrop"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="upgrade-card"
        style={{
          background: T.paper,
          border: `1px solid ${T.ink}`,
          color: T.ink,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="btn-press"
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            background: 'transparent',
            border: 'none',
            padding: 6,
            cursor: 'pointer',
            color: T.muted,
            fontSize: 20,
            lineHeight: 1,
          }}
        >
          ×
        </button>

        <div
          style={{
            fontSize: 11,
            fontFamily: T.mono,
            letterSpacing: '0.16em',
            color: T.muted,
            marginBottom: 10,
          }}
        >
          {meta.kicker}
        </div>

        <h2
          id="upgrade-title"
          style={{
            fontFamily: T.sans,
            fontSize: 'clamp(22px, 4.4vw, 28px)',
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
            margin: '0 0 12px',
          }}
        >
          {meta.title}
        </h2>

        <p
          style={{
            fontSize: 15,
            color: T.muted,
            lineHeight: 1.55,
            margin: '0 0 22px',
          }}
        >
          {meta.blurb}
        </p>

        {/* Signed in: plan card + interval toggle + checkout CTA */}
        <SignedIn>
          <div
            style={{
              padding: '16px 18px',
              border: `1px solid ${T.ink}`,
              background: T.paper2,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 4,
              }}
            >
              <span style={{ fontSize: 17, fontWeight: 700 }}>{PLAN_LABEL[pitchTier]}</span>
              <span
                style={{
                  fontSize: 18,
                  fontFamily: T.mono,
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                }}
              >
                {price.display}
              </span>
            </div>
            <div style={{ fontSize: 12, color: T.muted, fontFamily: T.mono, letterSpacing: '0.04em' }}>
              {price.tagline}
            </div>

            <button
              type="button"
              onClick={onSubscribe}
              disabled={pending}
              className="btn-press chamfer"
              style={{
                marginTop: 14,
                width: '100%',
                background: T.accent,
                color: T.paper,
                border: 'none',
                padding: '12px 18px',
                fontSize: 15,
                fontWeight: 600,
                cursor: pending ? 'wait' : 'pointer',
                fontFamily: T.sans,
                opacity: pending ? 0.7 : 1,
              }}
            >
              {pending ? 'Starting checkout…' : `Start ${PLAN_LABEL[pitchTier]} →`}
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              fontSize: 13,
              color: T.muted,
            }}
          >
            <IntervalChip
              value="monthly"
              current={interval}
              onSelect={setIntervalChoice}
              label="Monthly"
            />
            <IntervalChip
              value="annual"
              current={interval}
              onSelect={setIntervalChoice}
              label="Annual"
              badge={SAVINGS_BADGE[pitchTier]}
            />
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, fontFamily: T.mono, letterSpacing: '0.06em' }}>
              cancel anytime
            </span>
          </div>

          {error && (
            <div
              role="status"
              aria-live="polite"
              style={{
                marginTop: 12,
                padding: '8px 12px',
                border: `1px solid ${T.ink}`,
                background: T.paper2,
                fontSize: 13,
                fontFamily: T.mono,
              }}
            >
              {error}
            </div>
          )}
        </SignedIn>

        {/* Anonymous: sign in first */}
        <SignedOut>
          <div
            style={{
              padding: '16px 18px',
              border: `1px solid ${T.ink}`,
              background: T.paper2,
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.55, marginBottom: 12 }}>
              Sign in first to start your subscription — takes 10 seconds.
            </div>
            <SignInButton mode="modal">
              <button
                className="btn-press chamfer"
                style={{
                  width: '100%',
                  background: T.accent,
                  color: T.paper,
                  border: 'none',
                  padding: '12px 18px',
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: T.sans,
                }}
              >
                Sign in →
              </button>
            </SignInButton>
          </div>
          <div style={{ fontSize: 13, color: T.muted, fontFamily: T.mono, letterSpacing: '0.04em' }}>
            {PLAN_LABEL[pitchTier]} from {PLAN_PRICES[pitchTier].annual.display}
          </div>
        </SignedOut>
      </div>
    </div>
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
        padding: '5px 12px',
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

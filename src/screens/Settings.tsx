import { useEffect, useRef, useState } from 'react';
import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignOutButton,
  useAuth,
  useUser,
} from '@clerk/clerk-react';
import { T } from '../design/tokens';
import { usePromptFlow, type PromptFlow } from '../state/promptFlow';
import {
  fetchSubscriptionState,
  openCustomerPortal,
  startCheckout,
  type Interval,
  type SubscriptionStateResponse,
  type Tier as BillingTier,
} from '../billing/client';
import type { Route } from '../router';

interface SettingsProps {
  onNavigate: (route: Route) => void;
}

export function Settings({ onNavigate }: SettingsProps) {
  return (
    <main
      className="responsive-pad"
      style={{
        maxWidth: 720,
        margin: '0 auto',
        paddingTop: 32,
        paddingBottom: 96,
      }}
    >
      <h1
        className="reveal reveal-1"
        style={{
          fontFamily: T.sans,
          fontSize: 'clamp(32px, 7vw, 48px)',
          fontWeight: 700,
          lineHeight: 1.0,
          letterSpacing: '-0.025em',
          margin: '0 0 12px',
        }}
      >
        Settings
      </h1>
      <p
        className="reveal reveal-2"
        style={{
          fontSize: 16,
          color: T.muted,
          lineHeight: 1.55,
          margin: '0 0 32px',
          maxWidth: 540,
        }}
      >
        Sign in for 5 walkthroughs per day. Paid plans add deeper models and the Why & how reflection on every step.
      </p>

      <SignedIn>
        <AccountCard />
      </SignedIn>
      <SignedOut>
        <SignedOutCard />
      </SignedOut>

      <SignedIn>
        <NavCard onNavigate={onNavigate} />
      </SignedIn>

      <PromptFlowCard />

      <SignedIn>
        <TrustIrisCard />
      </SignedIn>
    </main>
  );
}

function TrustIrisCard() {
  const [trustIris, setTrustIris] = useState<boolean>(() => readBoolPref('mathiq:trustIris'));

  function onChange(next: boolean) {
    setTrustIris(next);
    writeBoolPref('mathiq:trustIris', next);
    // Notify the Homework screen if it's mounted on a different tab.
    try {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'mathiq:trustIris',
          newValue: next ? '1' : '0',
        }),
      );
    } catch {
      // Browsers vary on whether StorageEvent can be constructed manually;
      // localStorage write alone is enough for the same-tab case.
    }
  }

  return (
    <section
      className="reveal reveal-3"
      style={{
        padding: '18px 22px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
        marginTop: 14,
      }}
    >
      <div style={kicker()}>HANDWRITTEN TO PDF</div>
      <h2
        style={{
          fontFamily: T.sans,
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          margin: '8px 0 6px',
        }}
      >
        Trust Iris
      </h2>
      <p style={{ fontSize: 14, color: T.muted, lineHeight: 1.55, margin: '0 0 14px' }}>
        Skip the &ldquo;Did you mean…?&rdquo; review on every upload and
        auto-accept Iris&apos;s suggested corrections. Faster, recommended
        after you&apos;ve run a few uploads and seen the quality. You can
        flip this off any time to verify again.
      </p>
      <label
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          cursor: 'pointer',
          fontFamily: T.mono,
          fontSize: 13,
          letterSpacing: '0.06em',
          color: T.ink,
        }}
      >
        <input
          type="checkbox"
          checked={trustIris}
          onChange={(e) => onChange(e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        {trustIris ? 'Trust Iris is ON' : 'Trust Iris is OFF'}
      </label>
    </section>
  );
}

function readBoolPref(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeBoolPref(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // ignore — private mode etc.
  }
}

function NavCard({ onNavigate }: { onNavigate: (route: Route) => void }) {
  return (
    <section
      className="reveal reveal-3"
      style={{
        padding: '18px 22px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
        marginTop: 14,
      }}
    >
      <button
        type="button"
        onClick={() => onNavigate({ name: 'history' })}
        className="btn-press"
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: 0,
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'inherit',
          color: T.ink,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span>
          <span style={{ fontSize: 15, fontWeight: 600, display: 'block', marginBottom: 2 }}>
            Walkthrough history
          </span>
          <span style={{ fontSize: 13, color: T.muted }}>
            Revisit anything you've solved in the last 90 days.
          </span>
        </span>
        <span className="arrow-nudge" style={{ color: T.ink, fontSize: 18 }}>→</span>
      </button>
    </section>
  );
}

function PromptFlowCard() {
  const [flow, setFlow] = usePromptFlow();
  return (
    <section
      className="reveal reveal-4"
      style={{
        padding: '24px 22px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
        marginTop: 14,
      }}
    >
      <div style={kicker()}>WALKTHROUGH PACE</div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          marginTop: 6,
        }}
      >
        <FlowOption
          value="step"
          label="Step by step"
          description="Iris emits one step at a time. You decide when to advance."
          current={flow}
          onSelect={setFlow}
        />
        <FlowOption
          value="all"
          label="All at once"
          description="The full walkthrough streams end-to-end in one go."
          current={flow}
          onSelect={setFlow}
        />
      </div>
    </section>
  );
}

function FlowOption({
  value,
  label,
  description,
  current,
  onSelect,
}: {
  value: PromptFlow;
  label: string;
  description: string;
  current: PromptFlow;
  onSelect: (v: PromptFlow) => void;
}) {
  const selected = current === value;
  return (
    <button
      onClick={() => onSelect(value)}
      className="btn-press"
      style={{
        background: selected ? T.paper : 'transparent',
        border: `1px solid ${selected ? T.ink : T.hair}`,
        padding: '12px 14px',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: T.ink,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 16,
          height: 16,
          flexShrink: 0,
          marginTop: 2,
          border: `1px solid ${T.ink}`,
          borderRadius: '50%',
          background: selected ? T.ink : 'transparent',
          boxShadow: selected ? `inset 0 0 0 3px ${T.paper}` : 'none',
        }}
      />
      <span>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.45 }}>{description}</div>
      </span>
    </button>
  );
}

function AccountCard() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? '(no email on file)';
  const initial = (email[0] ?? '?').toUpperCase();
  const hasImageData = !!user?.hasImage && !!user.imageUrl;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [imageBroken, setImageBroken] = useState(false);
  // If the imageUrl changes (after upload), reset the broken flag.
  useEffect(() => {
    setImageBroken(false);
  }, [user?.imageUrl]);

  const showImage = hasImageData && !imageBroken;

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    setUploadErr(null);
    try {
      await user.setProfileImage({ file });
      await user.reload();
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function clearPhoto() {
    if (!user) return;
    setUploading(true);
    setUploadErr(null);
    try {
      await user.setProfileImage({ file: null });
      await user.reload();
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <section
      className="reveal reveal-3"
      style={{
        padding: '24px 22px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
        marginBottom: 14,
      }}
    >
      <div style={kicker()}>SIGNED IN</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
        <div
          aria-label={showImage ? 'Your profile picture' : `Initial ${initial}`}
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            border: `1px solid ${T.ink}`,
            background: T.ink,
            color: T.paper,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: T.sans,
            fontSize: 26,
            fontWeight: 700,
            overflow: 'hidden',
            flexShrink: 0,
            position: 'relative',
          }}
        >
          {showImage ? (
            <img
              src={user!.imageUrl}
              alt=""
              onError={() => setImageBroken(true)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          ) : (
            initial
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.35, marginBottom: 2, wordBreak: 'break-word' }}>
            {email}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="btn-press chamfer"
              style={{
                background: 'transparent',
                color: T.ink,
                border: `1px solid ${T.ink}`,
                padding: '7px 14px',
                fontSize: 13,
                fontWeight: 500,
                cursor: uploading ? 'not-allowed' : 'pointer',
                fontFamily: T.sans,
              }}
            >
              {uploading ? 'Uploading…' : hasImageData ? 'Change photo' : 'Upload photo'}
            </button>
            {hasImageData && !uploading && (
              <button
                type="button"
                onClick={clearPhoto}
                className="btn-press"
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  fontSize: 12,
                  color: T.muted,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                remove
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onFileSelected}
          />
          {uploadErr && (
            <div role="status" aria-live="polite" style={{ marginTop: 8, fontSize: 12, color: T.muted, fontFamily: T.mono }}>
              {uploadErr}
            </div>
          )}
        </div>
      </div>

      <SignOutButton>
        <button
          className="btn-press chamfer"
          style={{
            background: 'transparent',
            color: T.ink,
            border: `1px solid ${T.ink}`,
            padding: '9px 17px',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: T.sans,
          }}
        >
          Sign out
        </button>
      </SignOutButton>

      <div
        style={{
          marginTop: 20,
          paddingTop: 18,
          borderTop: `1px solid ${T.hair}`,
        }}
      >
        <BillingSection />
      </div>
    </section>
  );
}

const PLAN_PRICES: Record<BillingTier, Record<Interval, { display: string; tagline: string }>> = {
  plus: {
    monthly: { display: '$7.99 / mo', tagline: '' },
    annual: { display: '$4.99 / mo', tagline: 'billed $59.88 / year · save 37%' },
  },
  pro: {
    monthly: { display: '$29.99 / mo', tagline: '' },
    annual: { display: '$19.99 / mo', tagline: 'billed $239.88 / year · save 33%' },
  },
};

const PLAN_BLURBS: Record<BillingTier, string> = {
  plus: '20 Opus 4.6 walkthroughs, then 50 Sonnet 4.6. Why & how on every step.',
  pro: '70 Opus 4.6 walkthroughs daily, no degradation. Why & how on every step.',
};

const PLAN_LABELS: Record<BillingTier, string> = {
  plus: 'MathIQ+',
  pro: 'MathIQ Pro',
};

function BillingSection() {
  const { getToken } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<SubscriptionStateResponse | null>(null);
  const [interval, setInterval] = useState<Interval>('annual');
  const [pending, setPending] = useState<BillingTier | 'portal' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchSubscriptionState({ getToken });
        if (!cancelled) {
          setState(res);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  async function upgrade(tier: BillingTier) {
    setErr(null);
    setPending(tier);
    try {
      await startCheckout({ tier, interval, getToken });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Checkout failed');
      setPending(null);
    }
  }

  async function manage() {
    setErr(null);
    setPending('portal');
    try {
      await openCustomerPortal({ getToken });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Portal failed');
      setPending(null);
    }
  }

  if (!loaded) {
    return (
      <>
        <div style={kicker()}>PAID PLANS</div>
        <div style={{ fontSize: 13, color: T.muted, marginTop: 6 }}>Loading…</div>
      </>
    );
  }

  // Active or granted plan — Stripe sub OR dev/comp whitelist
  if (state?.tier) {
    const stripeActive = state.status === 'active' || state.status === 'trialing';
    const renew = stripeActive && state.currentPeriodEnd
      ? new Date(state.currentPeriodEnd * 1000).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : null;
    return (
      <>
        <div style={kicker()}>CURRENT PLAN</div>
        <div style={{ fontSize: 17, fontWeight: 600, marginTop: 6 }}>
          {PLAN_LABELS[state.tier]}{state.interval ? ` (${state.interval})` : ''}
        </div>
        {!stripeActive && (
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4, fontFamily: T.mono, letterSpacing: '0.1em' }}>
            GRANTED · NO BILLING
          </div>
        )}
        {renew && (
          <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>
            Renews {renew}
          </div>
        )}
        {state.manageable && stripeActive && (
          <button
            type="button"
            onClick={() => void manage()}
            disabled={pending === 'portal'}
            className="btn-press chamfer"
            style={{
              marginTop: 14,
              background: 'transparent',
              color: T.ink,
              border: `1px solid ${T.ink}`,
              padding: '9px 17px',
              fontSize: 14,
              fontWeight: 500,
              cursor: pending === 'portal' ? 'not-allowed' : 'pointer',
              fontFamily: T.sans,
            }}
          >
            {pending === 'portal' ? 'Opening…' : 'Manage subscription'}
          </button>
        )}
        {err && (
          <div role="status" aria-live="polite" style={{ marginTop: 10, fontSize: 12, color: T.muted, fontFamily: T.mono }}>
            {err}
          </div>
        )}
      </>
    );
  }

  // Upgrade path
  return (
    <>
      <div style={kicker()}>PAID PLANS</div>
      <div style={{ display: 'flex', gap: 4, marginTop: 8, marginBottom: 18 }}>
        <IntervalChip current={interval} value="annual" label="Annual" badge="−37%" onSelect={setInterval} />
        <IntervalChip current={interval} value="monthly" label="Monthly" onSelect={setInterval} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PlanCard
          tier="plus"
          interval={interval}
          blurb={PLAN_BLURBS.plus}
          pending={pending === 'plus'}
          onUpgrade={() => void upgrade('plus')}
        />
        <PlanCard
          tier="pro"
          interval={interval}
          blurb={PLAN_BLURBS.pro}
          pending={pending === 'pro'}
          onUpgrade={() => void upgrade('pro')}
        />
      </div>
      {err && (
        <div role="status" aria-live="polite" style={{ marginTop: 12, fontSize: 12, color: T.muted, fontFamily: T.mono }}>
          {err}
        </div>
      )}
    </>
  );
}

function IntervalChip({
  current,
  value,
  label,
  badge,
  onSelect,
}: {
  current: Interval;
  value: Interval;
  label: string;
  badge?: string;
  onSelect: (v: Interval) => void;
}) {
  const selected = current === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className="btn-press"
      style={{
        background: selected ? T.ink : 'transparent',
        color: selected ? T.paper : T.ink,
        border: `1px solid ${T.ink}`,
        padding: '6px 14px',
        fontFamily: T.mono,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {label}
      {badge && (
        <span style={{ opacity: 0.85, fontSize: 10, fontWeight: 600 }}>{badge}</span>
      )}
    </button>
  );
}

function PlanCard({
  tier,
  interval,
  blurb,
  pending,
  onUpgrade,
}: {
  tier: BillingTier;
  interval: Interval;
  blurb: string;
  pending: boolean;
  onUpgrade: () => void;
}) {
  const price = PLAN_PRICES[tier][interval];
  return (
    <div
      style={{
        border: `1px solid ${T.ink}`,
        background: T.paper,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
          {PLAN_LABELS[tier]}
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, fontFamily: T.mono }}>{price.display}</div>
      </div>
      {price.tagline && (
        <div style={{ fontSize: 12, color: T.muted }}>{price.tagline}</div>
      )}
      <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.5 }}>{blurb}</div>
      <button
        type="button"
        onClick={onUpgrade}
        disabled={pending}
        className="btn-press chamfer"
        style={{
          marginTop: 4,
          alignSelf: 'flex-start',
          background: pending ? T.hair : T.accent,
          color: pending ? T.muted : T.paper,
          border: 'none',
          padding: '10px 18px',
          fontSize: 14,
          fontWeight: 500,
          cursor: pending ? 'not-allowed' : 'pointer',
          fontFamily: T.sans,
        }}
      >
        {pending ? 'Opening checkout…' : `Upgrade to ${PLAN_LABELS[tier]}`}
      </button>
    </div>
  );
}

function SignedOutCard() {
  return (
    <section
      className="reveal reveal-3"
      style={{
        padding: '24px 22px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
        marginBottom: 14,
      }}
    >
      <div style={kicker()}>NOT SIGNED IN</div>
      <div style={{ fontSize: 19, fontWeight: 500, lineHeight: 1.35, marginBottom: 8 }}>
        You get 1 free walkthrough per day.
      </div>
      <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.5, marginBottom: 16 }}>
        Sign in (email magic link, no password) for 5 walkthroughs/day.
      </div>
      <SignInButton mode="modal">
        <button
          className="btn-press chamfer"
          style={{
            background: T.accent,
            color: T.paper,
            border: 'none',
            padding: '10px 18px',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: T.sans,
          }}
        >
          Sign in
        </button>
      </SignInButton>
    </section>
  );
}

function kicker(): React.CSSProperties {
  return {
    fontFamily: T.mono,
    fontSize: 11,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: T.muted,
    marginBottom: 10,
  };
}

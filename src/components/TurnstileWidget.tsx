/**
 * Cloudflare Turnstile widget wrapper.
 *
 * Renders a Turnstile challenge on demand and surfaces the resulting token
 * via the onSuccess callback. The Turnstile script is loaded once globally
 * in index.html with `async defer`, so we wait for `window.turnstile` to
 * become available before rendering.
 *
 * Used in the anonymous Daily Challenge grade flow to ensure each photo
 * grade is a real human and not a script.
 */
import { useEffect, useRef, useState } from 'react';
import { T } from '../design/tokens';

// Public site key — safe to commit. Configured in Cloudflare dashboard.
export const TURNSTILE_SITE_KEY = '0x4AAAAAADPsiOBUPVIoKAk4';

// How long to keep waiting for the script. A blocked or unreachable script
// never arrives at all, and without a cap the poll ran forever behind a
// blank box that never explained itself.
const SCRIPT_WAIT_MS = 10_000;
const POLL_MS = 150;

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          'error-callback'?: () => void;
          'expired-callback'?: () => void;
          'timeout-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
          size?: 'normal' | 'flexible' | 'compact';
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

interface TurnstileWidgetProps {
  onSuccess: (token: string) => void;
  onError?: () => void;
}

export function TurnstileWidget({ onSuccess, onError }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptMissing, setScriptMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let pollHandle: number | null = null;
    const deadline = Date.now() + SCRIPT_WAIT_MS;

    const tryRender = () => {
      if (cancelled) return;
      if (!containerRef.current) return;
      if (typeof window === 'undefined' || !window.turnstile) {
        if (Date.now() >= deadline) {
          setScriptMissing(true);
          onError?.();
          return;
        }
        // Turnstile script hasn't loaded yet — poll briefly.
        pollHandle = window.setTimeout(tryRender, POLL_MS);
        return;
      }
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => onSuccess(token),
        'error-callback': () => onError?.(),
        'expired-callback': () => onError?.(),
        theme: 'auto',
        size: 'flexible',
      });
    };

    tryRender();

    return () => {
      cancelled = true;
      if (pollHandle !== null) window.clearTimeout(pollHandle);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Silent — widget already removed or script unloaded.
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (scriptMissing) {
    return (
      <div
        role="alert"
        style={{
          minHeight: 65,
          width: '100%',
          padding: '12px 14px',
          border: `1px solid ${T.ink}`,
          background: T.paper2,
          fontSize: 13,
          lineHeight: 1.5,
          color: T.ink,
        }}
      >
        The verification check couldn't load. If you use an ad blocker, allow
        challenges.cloudflare.com, then reload the page — or sign in, which skips
        the check.
      </div>
    );
  }

  return <div ref={containerRef} style={{ minHeight: 65, width: '100%' }} />;
}

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
import { useEffect, useRef } from 'react';

// Public site key — safe to commit. Configured in Cloudflare dashboard.
export const TURNSTILE_SITE_KEY = '0x4AAAAAADPsiOBUPVIoKAk4';

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

  useEffect(() => {
    let cancelled = false;
    let pollHandle: number | null = null;

    const tryRender = () => {
      if (cancelled) return;
      if (!containerRef.current) return;
      if (typeof window === 'undefined' || !window.turnstile) {
        // Turnstile script hasn't loaded yet — poll briefly.
        pollHandle = window.setTimeout(tryRender, 150);
        return;
      }
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => onSuccess(token),
        'error-callback': () => onError?.(),
        'expired-callback': () => onError?.(),
        theme: 'light',
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

  return <div ref={containerRef} style={{ minHeight: 65, width: '100%' }} />;
}

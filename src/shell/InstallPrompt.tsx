/**
 * Listens for the browser's `beforeinstallprompt` event and surfaces a tiny
 * banner inviting the user to install MathIQ as an app. We show it once per
 * device (suppression key in localStorage), and only when the browser
 * actually offers an install — never as marketing copy that lies about it.
 *
 * iOS Safari fallback: Apple gives no programmatic install API and never
 * fires `beforeinstallprompt`, so on iPhone/iPad Safari we render a
 * text-only instruction banner instead. The copy points at the Share
 * icon (a square with an up arrow) by shape because users often don't
 * recognize it by name — and its location differs between iPhone Safari
 * (bottom toolbar) and iPad Safari (top toolbar).
 * The PWA tags in index.html make sure the manually-installed app still
 * lands with the right icon and full-screen behavior.
 */
import { useEffect, useState } from 'react';
import { T } from '../design/tokens';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const STORAGE_KEY = 'mathiq:installPromptDismissed';

function isIosSafariNeedingPrompt(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIosDevice = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
  if (!isIosDevice) return false;
  // Already running as an installed PWA — nothing to prompt about.
  const standaloneNav = (navigator as Navigator & { standalone?: boolean }).standalone;
  if (standaloneNav) return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return false;
  // iOS-Chrome/Firefox/Edge can't add to home screen at all; only show this
  // hint to actual iOS Safari, which uses Safari without a Cri/Fx/Edg prefix.
  if (/CriOS|FxiOS|EdgiOS/.test(ua)) return false;
  return /Safari/.test(ua);
}

export function InstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosVisible, setIosVisible] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      // ignore
    }
    if (dismissed) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
      setHidden(false);
    };
    const onAppInstalled = () => {
      setEvent(null);
      setHidden(true);
      try {
        localStorage.setItem(STORAGE_KEY, '1');
      } catch {
        // ignore
      }
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);

    if (isIosSafariNeedingPrompt()) {
      setIosVisible(true);
      setHidden(false);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  function dismiss() {
    setHidden(true);
    setIosVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // ignore
    }
  }

  async function install() {
    if (!event) return;
    await event.prompt();
    const choice = await event.userChoice;
    setEvent(null);
    setHidden(true);
    if (choice.outcome === 'dismissed') {
      try {
        localStorage.setItem(STORAGE_KEY, '1');
      } catch {
        // ignore
      }
    }
  }

  if (hidden) return null;
  if (!event && !iosVisible) return null;

  const isIos = !event && iosVisible;

  return (
    <div
      role="dialog"
      aria-label="Install MathIQ as an app"
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        right: 16,
        maxWidth: 440,
        margin: '0 auto',
        zIndex: 50,
        background: T.paper2,
        border: `1px solid ${T.ink}`,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: isIos ? 'column' : 'row',
        alignItems: isIos ? 'stretch' : 'center',
        gap: isIos ? 8 : 14,
        boxShadow: '0 6px 20px rgba(26, 43, 26, 0.18)',
      }}
    >
      {isIos ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>
            Add MathIQ to your home screen
          </div>
          <ol
            style={{
              margin: 0,
              padding: '0 0 0 18px',
              fontSize: 13,
              lineHeight: 1.55,
              color: T.ink,
            }}
          >
            <li>
              Tap the <strong>Share</strong> button (⬆︎ icon) in Safari
            </li>
            <li>
              Then choose <strong>Add to Home Screen</strong>
            </li>
          </ol>
          <button
            type="button"
            onClick={dismiss}
            className="btn-press"
            style={{
              alignSelf: 'flex-end',
              marginTop: 2,
              background: 'transparent',
              border: 'none',
              padding: '4px 0 0',
              fontSize: 12,
              fontFamily: T.mono,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: T.muted,
              cursor: 'pointer',
            }}
          >
            Don’t show again
          </button>
        </>
      ) : (
        <>
          <span style={{ flex: 1, fontSize: 14, lineHeight: 1.4, color: T.ink }}>
            Install MathIQ on this device for one-tap access.
          </span>
          <button
            type="button"
            onClick={() => void install()}
            className="btn-press chamfer"
            style={{
              background: T.accent,
              color: T.paper,
              border: 'none',
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: T.sans,
              flexShrink: 0,
            }}
          >
            Install
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss install prompt"
            className="btn-press"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '4px 8px',
              fontSize: 18,
              lineHeight: 1,
              cursor: 'pointer',
              color: T.muted,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}

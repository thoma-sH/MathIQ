/**
 * Web Speech API recognition wrapper. Returns a stable start/stop pair
 * plus the latest transcript. Gracefully degrades to `supported: false`
 * on browsers that don't ship the API (Firefox, older Safari).
 *
 * Browsers expose either `SpeechRecognition` or the prefixed
 * `webkitSpeechRecognition` — the hook picks whichever is available.
 *
 * Note: SR requires HTTPS in production (or `localhost` for dev) and
 * triggers a one-time mic-permission prompt the first time it's used.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// The browser API is webkit-prefixed and not in the standard DOM lib;
// we treat it loosely typed and isolate `any` to this file.
type SRConstructor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: ((e: Event) => void) | null;
  onresult: ((e: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: ((e: Event) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string; confidence: number };
  }>;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

declare global {
  interface Window {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed':         'Microphone blocked. Click the lock icon in your address bar to allow it.',
  'service-not-allowed': 'Microphone blocked by your browser or OS. Allow mic access and try again.',
  'audio-capture':       'No microphone found. Plug one in and try again.',
  'no-speech':           "Didn't catch anything — tap the mic and try again.",
  'aborted':             '',
  'network':             'Network error — speech recognition needs internet.',
  'language-not-supported': 'This language isn\'t supported by your browser.',
};

function getCtor(): SRConstructor | null {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export interface UseSpeechRecognitionResult {
  start: () => void;
  stop: () => void;
  listening: boolean;
  transcript: string;
  /** Last text the engine actually heard, even if SR ended without
   *  firing a "final" result. Useful for showing the user what landed. */
  lastHeard: string;
  supported: boolean;
  error: string | null;
}

export function useSpeechRecognition(opts?: {
  lang?: string;
  onFinal?: (text: string) => void;
}): UseSpeechRecognitionResult {
  const { lang = 'en-US', onFinal } = opts ?? {};
  const Ctor = useRef<SRConstructor | null>(getCtor());
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [lastHeard, setLastHeard] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      try { recRef.current?.abort(); } catch { /* ignore */ }
    };
  }, []);

  const start = useCallback(() => {
    const C = Ctor.current;
    if (!C) {
      setError('Speech recognition is not supported in this browser. Try Chrome, Edge, or Safari.');
      return;
    }
    try { recRef.current?.abort(); } catch { /* ignore */ }
    setError(null);
    setTranscript('');
    const rec = new C();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;

    let submittedFinal = false;
    let lastHeardText = '';
    rec.onstart = () => setListening(true);
    rec.onresult = (e) => {
      let text = '';
      let isFinal = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        text += r[0].transcript;
        if (r.isFinal) isFinal = true;
      }
      setTranscript(text);
      if (text.trim()) lastHeardText = text.trim();
      if (isFinal && text.trim()) {
        submittedFinal = true;
        setLastHeard(text.trim());
        onFinal?.(text.trim());
      }
    };
    rec.onerror = (event) => {
      const e = event as SpeechRecognitionErrorEvent;
      const code = e.error ?? '';
      const msg = code in ERROR_MESSAGES ? ERROR_MESSAGES[code]! : `Recognition error: ${code || 'unknown'}`;
      if (msg) setError(msg);
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      // Salvage: Chrome's SR routinely closes the session before firing
      // a final result, especially on short utterances. If we have an
      // interim transcript but never got isFinal, treat the interim as
      // the answer rather than throwing it away.
      if (!submittedFinal && lastHeardText) {
        setLastHeard(lastHeardText);
        onFinal?.(lastHeardText);
        return;
      }
      if (!submittedFinal) {
        setError((current) => current ?? "Didn't catch that — tap the mic and try again.");
      }
    };
    try {
      rec.start();
      recRef.current = rec;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start recognition');
      setListening(false);
    }
  }, [lang, onFinal]);

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
  }, []);

  return { start, stop, listening, transcript, lastHeard, supported: !!Ctor.current, error };
}

/**
 * Thin wrapper around the browser's `SpeechSynthesis` API. Returns a
 * stable `speak`/`cancel` pair plus a live `speaking` flag so React
 * components can drive UI off real TTS state instead of fake timers.
 *
 * - `voices` updates when the browser fires `voiceschanged` (Chromium
 *   loads voices async on first call).
 * - `cancel` runs on unmount so navigating away from a drill doesn't
 *   leave Iris talking to herself.
 */
import { useCallback, useEffect, useState } from 'react';

const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  voice?: SpeechSynthesisVoice | null;
  volume?: number;
  onEnd?: () => void;
  onStart?: () => void;
}

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  // Track voices. Some browsers populate the list synchronously; Chromium
  // populates it after `voiceschanged` fires.
  useEffect(() => {
    if (!isSupported) return;
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh();
    window.speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refresh);
  }, []);

  // Cancel anything pending when the component using the hook unmounts.
  useEffect(() => {
    return () => {
      if (isSupported) window.speechSynthesis.cancel();
    };
  }, []);

  const speak = useCallback((text: string, opts?: SpeakOptions) => {
    if (!isSupported || !text.trim()) {
      opts?.onEnd?.();
      return;
    }
    // Cancel queue so newer utterances replace older ones immediately.
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts?.rate ?? 0.95;
    u.pitch = opts?.pitch ?? 1;
    u.volume = opts?.volume ?? 1;
    if (opts?.voice) u.voice = opts.voice;
    u.onstart = () => { setSpeaking(true); opts?.onStart?.(); };
    u.onend = () => { setSpeaking(false); opts?.onEnd?.(); };
    u.onerror = () => { setSpeaking(false); opts?.onEnd?.(); };
    window.speechSynthesis.speak(u);
  }, []);

  const cancel = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { speak, cancel, speaking, voices, supported: isSupported };
}

/**
 * Pick the best-sounding default voice from the browser's catalogue.
 * Prefers high-quality natural voices first, then the default English
 * voice, then anything English.
 */
export function pickDefaultVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const pref = [
    /Google US English/i,
    /Google UK English Female/i,
    /Microsoft.*Aria/i,
    /Microsoft.*Jenny/i,
    /Samantha/i,           // macOS / iOS
    /Microsoft.*Zira/i,
  ];
  for (const re of pref) {
    const v = voices.find((v) => re.test(v.name) && /^en/i.test(v.lang));
    if (v) return v;
  }
  return voices.find((v) => v.default && /^en/i.test(v.lang))
      ?? voices.find((v) => /^en/i.test(v.lang))
      ?? voices[0]
      ?? null;
}

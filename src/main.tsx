import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';
import { applyTheme, resolveTheme } from './state/theme';
import { T } from './design/tokens';
import './index.css';

// Not in the shell: App.tsx routes /pricing, /privacy, /terms, /daily and
// /share/:id down a branch that never renders MathIQApp, so anything mounted
// there would leave those pages unthemed.
applyTheme(resolveTheme());

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env');
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    {/* Without this every `mode="modal"` sign-in renders Clerk's stock white
        card onto whatever palette is active. Passing `var()` strings follows
        the precedent in Header.tsx and means Clerk re-colors on a theme
        change without remounting the provider. */}
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      appearance={{
        variables: {
          colorPrimary: T.ink,
          colorBackground: T.paper,
          colorText: T.ink,
          colorTextSecondary: T.muted,
          colorTextOnPrimaryBackground: T.paper,
          colorInputBackground: T.paper,
          colorInputText: T.ink,
          colorNeutral: T.ink,
          fontFamily: '"DM Sans", sans-serif',
          borderRadius: '0',
        },
        elements: {
          card: { background: T.paper, border: `1px solid ${T.ink}`, boxShadow: 'none' },
          modalContent: { boxShadow: 'none' },
          headerTitle: { color: T.ink },
          headerSubtitle: { color: T.muted },
          socialButtonsBlockButton: { border: `1px solid ${T.ink}`, color: T.ink },
          formFieldInput: { border: `1px solid ${T.ink}`, background: T.paper },
          footer: { background: T.paper2 },
        },
      }}
    >
      <App />
    </ClerkProvider>
  </StrictMode>,
);

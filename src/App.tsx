import { TryMode } from '@/modes/TryMode';
import { PilotMode } from '@/modes/PilotMode';
import { findPilot } from '@/labs/_pilots/registry';

/**
 * Entry point. Default route renders the public free lab (the `/try` surface).
 *
 * Local-only escape hatch (DEV ONLY): `?pilot=<slug>` loads a registered pilot
 * lab in a minimal dev view (no analytics, no marketing CTA, no brief screen).
 * The branch is gated behind `import.meta.env.DEV`; Vite replaces that flag
 * with `false` at build time and tree-shakes the dead branch — including the
 * pilot registry, PilotMode, and every pilot lab they transitively pull in.
 * Production bundles cannot reach `?pilot=…`.
 *
 * The `/embed` Pro route (JWT auth + postMessage) is Ship Milestone 2, gated
 * on CertHead reaching 300+ paid subscribers — not built yet.
 */
export default function App() {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const slug = new URLSearchParams(window.location.search).get('pilot');
    const lab = findPilot(slug);
    if (lab) return <PilotMode lab={lab} />;
  }
  return <TryMode />;
}

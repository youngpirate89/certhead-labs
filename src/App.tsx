import { TryMode } from '@/modes/TryMode';
import { PilotMode } from '@/modes/PilotMode';
import { pilot2Router } from '@/labs/_pilots/pilot-2-router';

/**
 * Entry point. Default route renders the public free lab (the `/try` surface).
 *
 * Local-only escape hatch: `?pilot=<id>` loads a non-catalog pilot lab in a
 * minimal dev view (no analytics, no marketing CTA, no brief screen). The
 * deployed site never links to these — they exist for engine verification.
 *
 * The `/embed` Pro route (JWT auth + postMessage) is Ship Milestone 2, gated
 * on CertHead reaching 300+ paid subscribers — not built yet.
 */
export default function App() {
  if (typeof window !== 'undefined') {
    const pilot = new URLSearchParams(window.location.search).get('pilot');
    if (pilot === '2-router') return <PilotMode lab={pilot2Router} />;
  }
  return <TryMode />;
}

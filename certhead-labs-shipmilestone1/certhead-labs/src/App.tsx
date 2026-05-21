import { TryMode } from '@/modes/TryMode';

/**
 * Entry point. For now this renders the public free lab (the `/try` surface).
 * The `/embed` Pro route (JWT auth + postMessage) is Ship Milestone 2, gated on
 * CertHead reaching 300+ paid subscribers — not built yet.
 */
export default function App() {
  return <TryMode />;
}

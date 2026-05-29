import { TryMode } from '@/modes/TryMode';
import { PilotMode } from '@/modes/PilotMode';
import { findPilot } from '@/labs/_pilots/registry';
import { getLabById } from '@/labs/catalog';

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
 * Local-only escape hatch (DEV ONLY): `?lab=<id>` loads any catalog lab by id
 * through the same minimal `PilotMode` host, so Pro-tier labs can be cold-run
 * locally before the `/embed` route exists. Same tree-shake guarantee: gated
 * behind `import.meta.env.DEV`, and `getLabById`/the catalog are side-effect
 * free, so the branch and its imports drop out of production builds.
 *
 * The `/embed` Pro route (JWT auth + postMessage) is Ship Milestone 2, gated
 * on CertHead reaching 300+ paid subscribers — not built yet.
 */
export default function App() {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);

    const slug = params.get('pilot');
    const pilot = findPilot(slug);
    if (pilot) return <PilotMode lab={pilot} />;

    const labId = params.get('lab');
    if (labId) {
      const lab = getLabById(labId);
      if (lab) return <PilotMode lab={lab} />;
    }
  }
  return <TryMode />;
}

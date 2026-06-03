import { lazy, Suspense } from 'react';
import { TryMode } from '@/modes/TryMode';
import { resolveDevLabSelection } from '@/routing/devLabSelection';

const DevLabMode = import.meta.env.DEV
  ? lazy(() => import('@/modes/DevLabMode').then((module) => ({ default: module.DevLabMode })))
  : null;

const EmbedMode = lazy(() => import('@/modes/EmbedMode').then((module) => ({ default: module.EmbedMode })));

/**
 * Entry point. Default route renders the public free lab (the `/try` surface).
 *
 * Local-only escape hatches (DEV ONLY):
 * - `?pilot=<slug>` loads a registered pilot lab.
 * - `?lab=<id>` loads any catalog lab by id for Pro-lab cold-runs before the
 *   `/embed` route exists.
 *
 * Production safety: App has no static imports of `PilotMode`, the pilot
 * registry, or the full catalog. Those modules live behind a DEV-only dynamic
 * import so the production `/try` bundle remains free-lab-only.
 *
 * `/embed/:labId?token=...` is the Pro iframe surface. It verifies the
 * short-lived token with the CertHead API before importing the full catalog.
 */
export default function App() {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/embed/')) {
    return (
      <Suspense fallback={null}>
        <EmbedMode />
      </Suspense>
    );
  }

  if (typeof window !== 'undefined' && DevLabMode) {
    const selection = resolveDevLabSelection(window.location.search, import.meta.env.DEV);

    if (selection) {
      return (
        <Suspense fallback={null}>
          <DevLabMode pilotSlug={selection.pilotSlug} labId={selection.labId} />
        </Suspense>
      );
    }
  }

  return <TryMode />;
}

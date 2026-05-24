/**
 * Pilot lab registry.
 *
 * Pilot labs are engine-validation fixtures used during development to prove
 * out new layers (3a multi-device, 3b reachability, 3c L2, ...). They are
 * NEVER part of the deployed catalog. Each pilot is registered here with a
 * URL slug (`?pilot=<slug>`) and is only resolvable when the app runs in dev.
 *
 * Production-gating works by reading {@link findPilot} only inside a
 * `import.meta.env.DEV` branch in App.tsx — Vite replaces that flag with
 * `false` at build time, so the branch (and every import reachable only
 * through it) is tree-shaken out of the production bundle. The registry plus
 * its labs and the PilotMode view component all disappear from prod.
 *
 * Adding a new pilot = drop it into this array. No other wiring needed.
 *
 * The three `tshoot-*` slugs reference labs that have been promoted into
 * `src/labs/ccna/` (real catalog members served via `getLabById` once the
 * `/embed` route lands). Their dev access stays here because, until `/embed`
 * exists, `?pilot=…` is the only way to hand-run them in dev — and the
 * DEV gate keeps them out of the prod bundle either way.
 */
import type { Lab } from '@/engine/types';
import { tshootReturnRoute } from '@/labs/ccna/tshoot-return-route';
import { tshootWrongNextHop } from '@/labs/ccna/tshoot-wrong-next-hop';
import { tshootWanSubnetMismatch } from '@/labs/ccna/tshoot-wan-subnet-mismatch';
import { pilot2Router } from './pilot-2-router';
import { pilot3bStaticRouting } from './pilot-3b-static-routing';

interface PilotRegistration {
  /** URL slug — accessed via `?pilot=<slug>` in dev. */
  readonly slug: string;
  readonly lab: Lab;
}

const PILOTS: readonly PilotRegistration[] = [
  { slug: '2-router', lab: pilot2Router },
  { slug: 'static-routing', lab: pilot3bStaticRouting },
  { slug: 'tshoot-return-route', lab: tshootReturnRoute },
  { slug: 'tshoot-wrong-next-hop', lab: tshootWrongNextHop },
  { slug: 'tshoot-wan-subnet-mismatch', lab: tshootWanSubnetMismatch },
];

/** Resolve a pilot slug to its lab, or undefined if not registered. */
export function findPilot(slug: string | null | undefined): Lab | undefined {
  if (!slug) return undefined;
  return PILOTS.find((p) => p.slug === slug)?.lab;
}

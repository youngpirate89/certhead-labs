import { TryMode } from '@/modes/TryMode';
import { PilotMode } from '@/modes/PilotMode';
import { findPilot } from '@/labs/_pilots/registry';
import { getLabById } from '@/labs/catalog';

interface DevLabModeProps {
  readonly pilotSlug: string | null;
  readonly labId: string | null;
}

/** DEV-only lab launcher. Do not statically import this from production routes. */
export function DevLabMode({ pilotSlug, labId }: DevLabModeProps) {
  const pilot = findPilot(pilotSlug);
  if (pilot) return <PilotMode lab={pilot} />;

  if (labId) {
    const lab = getLabById(labId);
    if (lab) return <PilotMode lab={lab} />;
  }

  return <TryMode />;
}

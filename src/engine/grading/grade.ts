import type { Lab } from '@/engine/types';
import type { Session } from '@/engine/adapters/ios/state';

export interface ObjectiveStatus {
  readonly id: string;
  readonly text: string;
  readonly met: boolean;
}

export interface GradeResult {
  readonly objectives: ObjectiveStatus[];
  readonly allMet: boolean;
}

/**
 * Evaluate every lab objective against the current session. Pure and
 * deterministic: same session always grades the same.
 */
export function grade(lab: Lab, session: Session): GradeResult {
  const state = { [session.device.id]: session.device };
  const objectives = lab.objectives.map((o) => ({
    id: o.id,
    text: o.text,
    met: o.check(state, session.history),
  }));
  return { objectives, allMet: objectives.every((o) => o.met) };
}

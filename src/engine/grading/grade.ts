import type { Lab, HistoryView, LabState } from '@/engine/types';
import type { Session } from '@/engine/adapters/ios/state';
import type { LabSession } from '@/engine/lab-session';

export interface ObjectiveStatus {
  readonly id: string;
  readonly text: string;
  readonly met: boolean;
}

export interface GradeResult {
  readonly objectives: ObjectiveStatus[];
  readonly allMet: boolean;
}

/** A multi-device LabSession has `devices` — a single Session does not. */
function isLabSession(s: Session | LabSession): s is LabSession {
  return 'devices' in s && 'activeDeviceId' in s;
}

/**
 * Evaluate every lab objective against the current session(s). Pure and
 * deterministic.
 *
 * Accepts either a multi-device LabSession (the 3a+ path) or a single-device
 * IOS Session (legacy convenience for existing engine-level tests). State is
 * keyed by device id; history is keyed by device id too — multi-device labs
 * may inspect any device's history.
 */
export function grade(lab: Lab, source: Session | LabSession): GradeResult {
  const lab1: LabSession = isLabSession(source)
    ? source
    : {
        devices: { [source.device.id]: source },
        activeDeviceId: source.device.id,
        links: [],
      };

  const state: LabState = {};
  const history: Record<string, { raw: readonly string[]; resolved: readonly string[] }> = {};
  for (const [id, sess] of Object.entries(lab1.devices)) {
    // 3a: only routers exist. Switch/PC adapters (3b/3c) will project their
    // own state into LabState the same way.
    if (sess.kind === 'router') {
      state[id] = sess.device;
      history[id] = { raw: sess.history, resolved: sess.resolvedHistory };
    }
  }

  const view: HistoryView = history;
  const objectives = lab.objectives.map((o) => ({
    id: o.id,
    text: o.text,
    met: o.check(state, view),
  }));
  return { objectives, allMet: objectives.every((o) => o.met) };
}

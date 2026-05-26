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
    // Routers project their full DeviceState into LabState so router-shape
    // checks read them off `state`. Switch and PC state lives behind the
    // `session` argument — switch ports + VLAN database via `session.devices`,
    // PC IP/lastPing the same way — so they don't appear here.
    if (sess.kind === 'router') {
      state[id] = sess.device;
      history[id] = { raw: sess.history, resolved: sess.resolvedHistory };
    }
  }

  // History includes every kind that tracks it. Switch + PC both record
  // commands the same way as routers; without this loop, a switch-only or
  // PC-only history-check (e.g. lab-07's "did the learner run show vlan brief
  // on SW1") would silently never match.
  for (const [id, sess] of Object.entries(lab1.devices)) {
    if ((sess.kind === 'pc' || sess.kind === 'switch') && !(id in history)) {
      history[id] = { raw: sess.history, resolved: sess.resolvedHistory };
    }
  }

  const view: HistoryView = history;
  const objectives = lab.objectives.map((o) => ({
    id: o.id,
    text: o.text,
    met: o.check(state, view, lab1),
  }));
  return { objectives, allMet: objectives.every((o) => o.met) };
}

/**
 * Router device adapter.
 *
 * The router adapter is the first DeviceAdapter implementation
 * (docs/MULTI_DEVICE_TOPOLOGY.md Model section). It wraps the IOS engine
 * (`./ios/*`) and exposes the device-kind-agnostic DeviceAdapter surface so
 * the multi-device LabSession can drive routers, switches (3c), and PCs (3b)
 * uniformly without knowing each kind's internals.
 *
 * No behavior change vs. the previous single-device IOS path — this is a
 * reshape, not a rewrite.
 */
import { applyCommand as iosApply, contextHelp, tabComplete } from './ios/interpret';
import {
  buildDevice as iosBuildDevice,
  createSession,
  prompt as iosPrompt,
  type Session,
} from './ios/state';
import { grammarFor as iosGrammarFor } from './ios/grammar';
import type { LabDevice } from '@/engine/types';
import type {
  ApplyOptions,
  DeviceAdapter,
  DeviceTopologyView,
  InterfaceStatus,
} from './types';

/** Status derivation for a router interface — agnostic of the view's caller.
 *
 *  Order matters: `admin-down` dominates (the local config is explicit).
 *  Otherwise the line-protocol drop (peer admin-down on a P2P link, set by
 *  the lab-session refresh pass) takes priority over the `no-ip` warning —
 *  a learner needs to see the carrier fault before noticing they forgot
 *  the IP. Final fall-through is the normal up / no-ip distinction. */
function interfaceStatus(
  adminUp: boolean,
  protocolUp: boolean,
  ip: string | null,
): InterfaceStatus {
  if (!adminUp) return 'admin-down';
  if (!protocolUp) return 'protocol-down';
  return ip ? 'up' : 'no-ip';
}

export const routerAdapter: DeviceAdapter<Session> = {
  kind: 'router',

  buildDevice(spec: LabDevice): Session {
    return createSession(
      iosBuildDevice({
        id: spec.id,
        platform: spec.platform,
        interfaces: spec.interfaces,
      }),
    );
  },

  applyCommand(session, raw, _ctx, opts?: ApplyOptions) {
    return iosApply(session, raw, opts);
  },

  prompt(session) {
    return iosPrompt(session);
  },

  grammarFor(session) {
    return iosGrammarFor(session.mode);
  },

  contextHelp(session, partialLine) {
    return contextHelp(session, partialLine);
  },

  tabComplete(session, partialLine) {
    return tabComplete(session, partialLine);
  },

  toTopologyView(session): DeviceTopologyView {
    const d = session.device;
    return {
      id: d.id,
      kind: 'router',
      hostname: d.hostname,
      platform: d.platform,
      interfaces: Object.values(d.interfaces).map((i) => ({
        id: i.id,
        name: i.name,
        status: interfaceStatus(i.adminUp, i.protocolUp, i.ip),
        ip: i.ip,
        mask: i.mask,
      })),
    };
  },
};

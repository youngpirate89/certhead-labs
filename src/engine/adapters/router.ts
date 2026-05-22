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
  DeviceAdapter,
  DeviceTopologyView,
  InterfaceStatus,
} from './types';

/** Status derivation for a router interface — agnostic of the view's caller. */
function interfaceStatus(adminUp: boolean, ip: string | null): InterfaceStatus {
  if (!adminUp) return 'admin-down';
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

  applyCommand(session, raw) {
    return iosApply(session, raw);
  },

  prompt(session) {
    return iosPrompt(session);
  },

  grammarFor(session) {
    return iosGrammarFor(session.mode);
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
        status: interfaceStatus(i.adminUp, i.ip),
        ip: i.ip,
      })),
    };
  },
};

// Re-export the router-specific helpers the terminal layer needs for `?` + Tab.
// These will land on the DeviceAdapter interface itself in a later commit when
// switch/pc adapters need them — keeping the surface minimal for 3a.
export { contextHelp as routerContextHelp, tabComplete as routerTabComplete };

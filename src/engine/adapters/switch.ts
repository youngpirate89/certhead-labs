/**
 * Switch device adapter.
 *
 * Mirrors routerAdapter (router.ts). Wraps the switch IOS engine
 * (`./ios/switch-*`) and exposes the device-kind-agnostic DeviceAdapter
 * surface so the multi-device LabSession can drive switches, routers, and
 * PCs uniformly.
 *
 * Session 1 of the switch build: VLAN database + access ports + VLAN-aware
 * L2 forwarding (the latter wired in reachability.ts, not here).
 */
import {
  applySwitchCommand,
  contextHelpSwitch,
  tabCompleteSwitch,
} from './ios/switch-interpret';
import {
  buildSwitchDevice,
  createSwitchSession,
  switchPrompt,
  type SwitchSession,
} from './ios/switch-state';
import { switchGrammarFor } from './ios/switch-grammar';
import type { LabDevice } from '@/engine/types';
import type {
  ApplyOptions,
  DeviceAdapter,
  DeviceTopologyView,
  InterfaceStatus,
} from './types';

/** Status derivation for a switchport. Switches don't have IPs on access
 *  ports so the `no-ip` state is irrelevant — every up port renders as 'up'. */
function switchportStatus(adminUp: boolean, protocolUp: boolean): InterfaceStatus {
  if (!adminUp) return 'admin-down';
  if (!protocolUp) return 'protocol-down';
  return 'up';
}

export const switchAdapter: DeviceAdapter<SwitchSession> = {
  kind: 'switch',

  buildDevice(spec: LabDevice): SwitchSession {
    return createSwitchSession(
      buildSwitchDevice({
        id: spec.id,
        platform: spec.platform,
        interfaces: spec.interfaces,
      }),
    );
  },

  applyCommand(session, raw, _ctx, opts?: ApplyOptions) {
    return applySwitchCommand(session, raw, opts);
  },

  prompt(session) {
    return switchPrompt(session);
  },

  grammarFor(session) {
    return switchGrammarFor(session.mode);
  },

  contextHelp(session, partialLine) {
    return contextHelpSwitch(session, partialLine);
  },

  tabComplete(session, partialLine) {
    return tabCompleteSwitch(session, partialLine);
  },

  toTopologyView(session): DeviceTopologyView {
    const d = session.device;
    return {
      id: d.id,
      kind: 'switch',
      hostname: d.hostname,
      platform: d.platform,
      interfaces: Object.values(d.switchports).map((port) => ({
        id: port.id,
        name: port.name,
        status: switchportStatus(port.adminUp, port.protocolUp),
        // Switchports never carry an IP; the topology canvas hides the CIDR
        // label when both endpoints return null here.
        ip: null,
        mask: null,
        adminUp: port.adminUp,
        protocolUp: port.protocolUp,
      })),
    };
  },
};

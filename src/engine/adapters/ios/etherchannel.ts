import type { Link } from '@/engine/types';
import type { LacpMode, SwitchSession, Switchport } from './switch-state';

export function lacpModesBundle(a: LacpMode, b: LacpMode): boolean {
  if (a === 'on' || b === 'on') return a === 'on' && b === 'on';
  return a === 'active' || b === 'active';
}

function member(session: SwitchSession | undefined, iface: string): Switchport | null {
  const port = session?.device.switchports[iface];
  if (!port || port.channelGroup === null || port.lacpMode === null) return null;
  return port;
}

export function recomputeEtherchannel(
  switches: ReadonlyMap<string, SwitchSession>,
  links: readonly Link[],
): Map<string, SwitchSession> {
  const bundledMembers = new Set<string>();

  for (const link of links) {
    const aSession = switches.get(link.a.deviceId);
    const bSession = switches.get(link.b.deviceId);
    const a = member(aSession, link.a.iface);
    const b = member(bSession, link.b.iface);
    if (!a || !b || !a.adminUp || !b.adminUp) continue;
    if (a.channelGroup !== b.channelGroup) continue;
    if (!lacpModesBundle(a.lacpMode!, b.lacpMode!)) continue;
    bundledMembers.add(`${link.a.deviceId}|${link.a.iface}`);
    bundledMembers.add(`${link.b.deviceId}|${link.b.iface}`);
  }

  const result = new Map<string, SwitchSession>();
  for (const [deviceId, session] of switches) {
    let changed = false;
    const switchports: Record<string, Switchport> = { ...session.device.switchports };
    const groupUp = new Map<number, boolean>();

    for (const [iface, port] of Object.entries(session.device.switchports)) {
      const shouldBundle = port.channelGroup !== null && bundledMembers.has(`${deviceId}|${iface}`);
      if (port.bundled !== shouldBundle) {
        switchports[iface] = { ...port, bundled: shouldBundle };
        changed = true;
      }
      if (port.channelGroup !== null) {
        groupUp.set(port.channelGroup, (groupUp.get(port.channelGroup) ?? false) || shouldBundle);
      }
    }

    const portChannels = new Map(session.device.portChannels);
    for (const [id, po] of session.device.portChannels) {
      const bundled = groupUp.get(id) ?? false;
      if (po.bundled !== bundled) {
        portChannels.set(id, { ...po, bundled });
        changed = true;
      }
    }

    result.set(
      deviceId,
      changed ? { ...session, device: { ...session.device, switchports, portChannels } } : session,
    );
  }
  return result;
}

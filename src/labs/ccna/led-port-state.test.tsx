import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { initLabSession, applyToDevice } from '@/engine/lab-session';
import { lab09IntervlanRouting } from './lab-09-intervlan-routing';
import { lab01InterfaceIp } from './lab-01-interface-ip';
import { routerAdapter } from '@/engine/adapters/router';
import { switchAdapter } from '@/engine/adapters/switch';
import { pcAdapter } from '@/engine/adapters/pc';
import { TopologyPanel, type DeviceTopologyView } from '@/components/TopologyPanel';
import type { DeviceSession } from '@/engine/lab-session';
import type { Lab } from '@/engine/types';

function viewFor(s: DeviceSession): DeviceTopologyView {
  switch (s.kind) {
    case 'router': return routerAdapter.toTopologyView(s);
    case 'switch': return switchAdapter.toTopologyView(s);
    case 'pc': return pcAdapter.toTopologyView(s);
  }
}

function ledMap(lab: Lab, session = initLabSession(lab)): Record<string, string> {
  const devices = Object.values(session.devices).map(viewFor);
  const positions = new Map<string, { x: number; y: number }>();
  for (const d of lab.topology.devices) {
    if (d.position) positions.set(d.id, d.position);
  }
  const { container } = render(
    <TopologyPanel
      devices={devices}
      activeDeviceId={lab.topology.devices[0].id}
      links={lab.topology.links}
      positions={positions}
    />,
  );
  const leds = container.querySelectorAll('[data-led-endpoint]');
  const status: Record<string, string> = {};
  leds.forEach((el) => {
    status[el.getAttribute('data-led-endpoint')!] = el.getAttribute('data-led-up')!;
  });
  return status;
}

describe('LED state derives from starting state on lab load', () => {
  it('Lab 09 at load: PC↔SW1 cables are green, R1↔SW1 is red (R1 admin-down)', () => {
    const status = ledMap(lab09IntervlanRouting);
    // PC-A ↔ SW1.Gi0/1 — both adminUp+protocolUp → GREEN
    expect(status['PC-A:Eth0']).toBe('true');
    expect(status['SW1:Gi0/1']).toBe('true');
    // PC-B ↔ SW1.Gi0/2 — both adminUp+protocolUp → GREEN
    expect(status['PC-B:Eth0']).toBe('true');
    expect(status['SW1:Gi0/2']).toBe('true');
    // R1.Gi0/0 ↔ SW1.Gi0/0 — R1 starts admin-down, so the either-end-down rule
    // pulls both to red (matches Packet-Tracer behavior).
    expect(status['R1:Gi0/0']).toBe('false');
    expect(status['SW1:Gi0/0']).toBe('false');
  });

  it('Lab 01 at load: no LEDs at all (free lab has no links — N=1 topology)', () => {
    const status = ledMap(lab01InterfaceIp);
    // Single-device lab has no cables, so no LEDs render. This is the
    // "no regression" check the work order asks for — bottom-row PortIndicators
    // (which still use the richer 'status' palette) remain unaffected.
    expect(Object.keys(status)).toEqual([]);
  });

  it('no shutdown on a peer-up but IP-less router port flips LED to green', () => {
    // The pre-fix bug: after `no shutdown` on R1.Gi0/0 in Lab 09, the port is
    // adminUp + protocolUp (SW1 peer is admin-up) but has no IP yet — status
    // resolves to 'no-ip', and the old `linkUp = status === 'up'` rule kept
    // BOTH ends RED. The new `adminUp && protocolUp` rule lights the cable
    // green the moment L1/L2 is up, regardless of L3 config.
    let session = initLabSession(lab09IntervlanRouting);
    for (const line of ['enable', 'configure terminal', 'interface gi0/0', 'no shutdown']) {
      session = applyToDevice(session, 'R1', line).session;
    }
    const status = ledMap(lab09IntervlanRouting, session);
    expect(status['R1:Gi0/0']).toBe('true');
    expect(status['SW1:Gi0/0']).toBe('true');
  });

  it('shutdown on an up port still flips BOTH LEDs to red (PT either-end-down rule unbroken)', () => {
    // Start from the "no shutdown" state above, then shutdown — both ends red.
    let session = initLabSession(lab09IntervlanRouting);
    for (const line of [
      'enable', 'configure terminal', 'interface gi0/0', 'no shutdown', 'shutdown',
    ]) {
      session = applyToDevice(session, 'R1', line).session;
    }
    const status = ledMap(lab09IntervlanRouting, session);
    expect(status['R1:Gi0/0']).toBe('false');
    expect(status['SW1:Gi0/0']).toBe('false');
  });
});

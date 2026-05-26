import { describe, it, expect } from 'vitest';
import { switchAdapter } from './switch';
import { applySwitchCommand } from './ios/switch-interpret';
import {
  createSwitchSession,
  buildSwitchDevice,
  type SwitchSession,
} from './ios/switch-state';

const SPEC = {
  id: 'SW1',
  kind: 'switch' as const,
  platform: 'C2960',
  interfaces: ['Fa0/1', 'Fa0/2', 'Fa0/3'],
};

function fresh(): SwitchSession {
  return switchAdapter.buildDevice(SPEC);
}

function run(start: SwitchSession, lines: string[]): SwitchSession {
  return lines.reduce((s, line) => applySwitchCommand(s, line).session, start);
}

describe('switch — initialization defaults', () => {
  it('exposes kind = switch and a fresh session at the user prompt', () => {
    expect(switchAdapter.kind).toBe('switch');
    const s = fresh();
    expect(s.kind).toBe('switch');
    expect(s.mode).toBe('user');
    expect(switchAdapter.prompt(s)).toBe('SW1>');
    expect(s.history).toEqual([]);
  });

  it('seeds VLAN 1 (default) in the database and cannot be removed', () => {
    const s = fresh();
    expect(s.device.vlans.get(1)).toEqual({ id: 1, name: 'default', active: true });
  });

  it('seeds every switchport in access mode, VLAN 1, admin-up', () => {
    const s = fresh();
    for (const id of SPEC.interfaces) {
      const port = s.device.switchports[id];
      expect(port).toBeDefined();
      expect(port.mode).toBe('access');
      expect(port.accessVlan).toBe(1);
      expect(port.adminUp).toBe(true);
    }
  });

  it('exposes a device-kind-agnostic topology view', () => {
    const s = fresh();
    const view = switchAdapter.toTopologyView(s);
    expect(view.kind).toBe('switch');
    expect(view.hostname).toBe('SW1');
    expect(view.interfaces).toHaveLength(3);
    // No IPs on switchports.
    expect(view.interfaces.every((i) => i.ip === null && i.mask === null)).toBe(true);
    // adminUp + protocolUp default true → status 'up'.
    expect(view.interfaces.every((i) => i.status === 'up')).toBe(true);
  });
});

describe('switch — VLAN database commands', () => {
  it('vlan <id> creates the VLAN and enters config-vlan submode', () => {
    const s = run(fresh(), ['enable', 'configure terminal', 'vlan 10']);
    expect(s.mode).toBe('config-vlan');
    expect(s.currentVlan).toBe(10);
    expect(switchAdapter.prompt(s)).toBe('SW1(config-vlan)#');
    const v = s.device.vlans.get(10);
    expect(v).toEqual({ id: 10, name: 'VLAN0010', active: true });
  });

  it('name <string> renames the active VLAN', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
    ]);
    expect(s.device.vlans.get(10)?.name).toBe('Sales');
  });

  it('exit from config-vlan returns to (config)#; end returns to priv', () => {
    const after = run(fresh(), [
      'enable',
      'configure terminal',
      'vlan 10',
      'exit',
    ]);
    expect(after.mode).toBe('config');
    expect(after.currentVlan).toBeNull();

    const ended = applySwitchCommand(
      run(fresh(), ['enable', 'configure terminal', 'vlan 10']),
      'end',
    ).session;
    expect(ended.mode).toBe('priv');
  });

  it('no vlan <id> deletes a non-reserved VLAN', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'no vlan 10',
    ]);
    expect(s.device.vlans.has(10)).toBe(false);
  });

  it('refuses to delete VLAN 1 with an explanatory error', () => {
    const res = applySwitchCommand(
      run(fresh(), ['enable', 'configure terminal']),
      'no vlan 1',
    );
    expect(res.output.some((o) => o.kind === 'error' && /Default VLAN 1/.test(o.text))).toBe(true);
    expect(res.session.device.vlans.has(1)).toBe(true);
  });

  it('refuses to configure VLANs in the reserved 1002-1005 range', () => {
    const res = applySwitchCommand(
      run(fresh(), ['enable', 'configure terminal']),
      'vlan 1002',
    );
    expect(res.output.some((o) => o.kind === 'error' && /reserved/i.test(o.text))).toBe(true);
    expect(res.session.device.vlans.has(1002)).toBe(false);
  });

  it('deleting a VLAN reverts any port assigned to it back to VLAN 1', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'interface fa0/1',
      'switchport access vlan 10',
      'exit',
      'no vlan 10',
    ]);
    expect(s.device.switchports['Fa0/1'].accessVlan).toBe(1);
  });
});

describe('switch — switchport configuration', () => {
  it('switchport mode access keeps the port in access mode', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/1',
      'switchport mode access',
    ]);
    expect(s.device.switchports['Fa0/1'].mode).toBe('access');
  });

  it('switchport access vlan <id> assigns the port to that VLAN', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'interface fa0/1',
      'switchport access vlan 10',
    ]);
    expect(s.device.switchports['Fa0/1'].accessVlan).toBe(10);
  });

  it('switchport access vlan <id> silently creates the VLAN when missing (with the IOS message)', () => {
    const result = applySwitchCommand(
      run(fresh(), ['enable', 'configure terminal', 'interface fa0/1']),
      'switchport access vlan 20',
    );
    expect(result.output.some((o) => /Access VLAN does not exist/.test(o.text))).toBe(true);
    expect(result.session.device.vlans.has(20)).toBe(true);
    expect(result.session.device.switchports['Fa0/1'].accessVlan).toBe(20);
  });

  it('no switchport access vlan resets the port to VLAN 1', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/1',
      'switchport access vlan 20',
      'no switchport access vlan',
    ]);
    expect(s.device.switchports['Fa0/1'].accessVlan).toBe(1);
  });

  it('rejects ip address on a switchport with the L2 sentence', () => {
    const result = applySwitchCommand(
      run(fresh(), ['enable', 'configure terminal', 'interface fa0/1']),
      'ip address 10.0.0.1 255.255.255.0',
    );
    expect(
      result.output.some(
        (o) =>
          o.kind === 'error' && /IP addresses may not be configured on L2 links/.test(o.text),
      ),
    ).toBe(true);
  });

  it('Gi and Fa interface forms both resolve', () => {
    const sw = createSwitchSession(
      buildSwitchDevice({
        id: 'SW1',
        platform: 'C2960',
        interfaces: ['Fa0/1', 'Gi0/1'],
      }),
    );
    const a = applySwitchCommand(
      run(sw, ['enable', 'configure terminal']),
      'interface fa0/1',
    ).session;
    expect(a.currentInterface).toBe('Fa0/1');
    const b = applySwitchCommand(
      run(sw, ['enable', 'configure terminal']),
      'interface gi0/1',
    ).session;
    expect(b.currentInterface).toBe('Gi0/1');
  });

  it('interface <new> from config-if hops directly without an exit', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/1',
      'interface fa0/2',
    ]);
    expect(s.mode).toBe('config-if');
    expect(s.currentInterface).toBe('Fa0/2');
  });
});

describe('switch — show commands', () => {
  it('show vlan brief renders the default VLAN with all unassigned ports', () => {
    const s = run(fresh(), ['enable']);
    const text = applySwitchCommand(s, 'show vlan brief')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/VLAN\s+Name\s+Status\s+Ports/);
    expect(text).toMatch(/1\s+default\s+active\s+Fa0\/1, Fa0\/2, Fa0\/3/);
  });

  it('show vlan brief lists assigned ports under the right VLAN', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'vlan 20',
      'name Engineering',
      'exit',
      'interface fa0/1',
      'switchport access vlan 10',
      'exit',
      'interface fa0/2',
      'switchport access vlan 20',
      'end',
    ]);
    const text = applySwitchCommand(s, 'show vlan brief')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/1\s+default\s+active\s+Fa0\/3/);
    expect(text).toMatch(/10\s+Sales\s+active\s+Fa0\/1/);
    expect(text).toMatch(/20\s+Engineering\s+active\s+Fa0\/2/);
  });

  it('show interfaces <iface> switchport renders the expected block', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'interface fa0/1',
      'switchport mode access',
      'switchport access vlan 10',
      'end',
    ]);
    const text = applySwitchCommand(s, 'show interfaces fa0/1 switchport')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/^Name: Fa0\/1$/m);
    expect(text).toMatch(/^Switchport: Enabled$/m);
    expect(text).toMatch(/^Administrative Mode: static access$/m);
    expect(text).toMatch(/^Operational Mode: static access$/m);
    expect(text).toMatch(/^Access Mode VLAN: 10 \(Sales\)$/m);
    expect(text).toMatch(/^Trunking Native Mode VLAN: 1 \(default\)$/m);
  });

  it('show running-config includes vlan and switchport stanzas', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'vlan 10',
      'name Sales',
      'exit',
      'interface fa0/1',
      'switchport mode access',
      'switchport access vlan 10',
      'end',
    ]);
    const text = applySwitchCommand(s, 'show running-config')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/^vlan 10$/m);
    expect(text).toMatch(/^ name Sales$/m);
    expect(text).toMatch(/^interface FastEthernet0\/1$/m);
    expect(text).toMatch(/^ switchport mode access$/m);
    expect(text).toMatch(/^ switchport access vlan 10$/m);
  });
});

describe('switch — prefix-match parser', () => {
  it('resolves abbreviated forms used by CCNA workflows', () => {
    // sh vl br → show vlan brief
    const s = run(fresh(), ['enable']);
    const sho = applySwitchCommand(s, 'sh vl br');
    expect(sho.output.some((o) => /VLAN\s+Name\s+Status\s+Ports/.test(o.text))).toBe(true);
    // sw mo ac → switchport mode access
    const swMo = run(fresh(), [
      'enable',
      'conf t',
      'int fa0/1',
      'sw mo ac',
    ]);
    expect(swMo.device.switchports['Fa0/1'].mode).toBe('access');
    // sw ac vl 10 → switchport access vlan 10
    const swAc = run(fresh(), [
      'enable',
      'conf t',
      'int fa0/1',
      'sw ac vl 10',
    ]);
    expect(swAc.device.switchports['Fa0/1'].accessVlan).toBe(10);
  });
});

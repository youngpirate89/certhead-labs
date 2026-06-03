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

  it('supports narrow port-security configuration and stale sticky MAC cleanup', () => {
    let s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/1',
      'switchport mode access',
      'switchport port-security',
      'switchport port-security maximum 1',
      'switchport port-security mac-address sticky 0011.2233.4455',
    ]);

    expect(s.device.switchports['Fa0/1'].portSecurity).toMatchObject({
      enabled: true,
      maximum: 1,
      violationMode: 'shutdown',
      sticky: true,
      secureMac: '0011.2233.4455',
    });

    s = run(s, ['no switchport port-security mac-address sticky 0011.2233.4455']);
    expect(s.device.switchports['Fa0/1'].portSecurity).toMatchObject({
      enabled: true,
      maximum: 1,
      violationMode: 'shutdown',
      sticky: false,
      secureMac: null,
      violation: false,
      lastSourceAddress: null,
    });
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

  it('show interfaces status renders connected and err-disabled access ports', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/1',
      'description User-desk-move',
      'switchport access vlan 20',
      'switchport port-security',
      'switchport port-security maximum 1',
      'switchport port-security mac-address sticky 0011.2233.4455',
      'shutdown',
      'end',
    ]);
    const text = applySwitchCommand(s, 'show interfaces status')
      .output.map((o) => o.text)
      .join('\n');

    expect(text).toMatch(/Port\s+Name\s+Status\s+Vlan\s+Duplex\s+Speed\s+Type/);
    expect(text).toMatch(/Fa0\/1\s+User-desk-move\s+err-disabled\s+20\s+auto\s+auto\s+10\/100BaseTX/);
    expect(text).toMatch(/Fa0\/2\s+\s+connected\s+1\s+auto\s+auto\s+10\/100BaseTX/);
  });

  it('show port-security interface renders secure-shutdown state', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/1',
      'switchport access vlan 20',
      'switchport port-security',
      'switchport port-security maximum 1',
      'switchport port-security mac-address sticky 0011.2233.4455',
      'end',
    ]);
    s.device.switchports['Fa0/1'].adminUp = false;
    s.device.switchports['Fa0/1'].portSecurity!.violation = true;
    s.device.switchports['Fa0/1'].portSecurity!.lastSourceAddress = '00aa.bbbb.cccc';

    const text = applySwitchCommand(s, 'show port-security interface Fa0/1')
      .output.map((o) => o.text)
      .join('\n');

    expect(text).toMatch(/Port Security\s+: Enabled/);
    expect(text).toMatch(/Port Status\s+: Secure-shutdown/);
    expect(text).toMatch(/Violation Mode\s+: Shutdown/);
    expect(text).toMatch(/Maximum MAC Addresses\s+: 1/);
    expect(text).toMatch(/Sticky MAC Addresses\s+: 1/);
    expect(text).toMatch(/Last Source Address:Vlan\s+: 00aa\.bbbb\.cccc:20/);
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

  it('resolves trunk-specific abbreviations: sw mo tr, sw tr al vl, sh int tr', () => {
    // sw mo tr → switchport mode trunk
    const trMode = run(fresh(), [
      'enable',
      'conf t',
      'int fa0/1',
      'sw mo tr',
    ]);
    expect(trMode.device.switchports['Fa0/1'].mode).toBe('trunk');

    // sw tr al vl 10,20 → switchport trunk allowed vlan 10,20
    const trAllowed = run(fresh(), [
      'enable',
      'conf t',
      'int fa0/1',
      'sw mo tr',
      'sw tr al vl 10,20',
    ]);
    const allowed = trAllowed.device.switchports['Fa0/1'].trunkAllowedVlans;
    expect(allowed).toEqual([10, 20]);

    // sh int tr → show interfaces trunk (here: no trunks)
    const blank = applySwitchCommand(run(fresh(), ['enable']), 'sh int tr');
    expect(blank.output.some((o) => /There are no trunk interfaces\./.test(o.text))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Session 2: trunk links + VLAN-aware forwarding
// ---------------------------------------------------------------------------

describe('switch — trunk mode + allowed VLAN configuration', () => {
  it('switchport mode trunk flips the port to trunk mode', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
    ]);
    expect(s.device.switchports['Fa0/3'].mode).toBe('trunk');
  });

  it('default trunk allowed list is the IOS "all" sentinel and native VLAN is 1', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
    ]);
    const port = s.device.switchports['Fa0/3'];
    expect(port.trunkAllowedVlans).toBe('all');
    expect(port.nativeVlan).toBe(1);
  });

  it('switchport trunk allowed vlan <list> REPLACES the allowed list', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
      'switchport trunk allowed vlan 10,20',
    ]);
    expect(s.device.switchports['Fa0/3'].trunkAllowedVlans).toEqual([10, 20]);
  });

  it('allowed vlan accepts hyphen ranges and mixes', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
      'switchport trunk allowed vlan 10,20-22,30',
    ]);
    expect(s.device.switchports['Fa0/3'].trunkAllowedVlans).toEqual([10, 20, 21, 22, 30]);
  });

  it('switchport trunk allowed vlan add APPENDS to existing list', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
      'switchport trunk allowed vlan 10,20',
      'switchport trunk allowed vlan add 30',
    ]);
    expect(s.device.switchports['Fa0/3'].trunkAllowedVlans).toEqual([10, 20, 30]);
  });

  it('switchport trunk allowed vlan remove DROPS the named VLANs', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
      'switchport trunk allowed vlan 10,20,30',
      'switchport trunk allowed vlan remove 20',
    ]);
    expect(s.device.switchports['Fa0/3'].trunkAllowedVlans).toEqual([10, 30]);
  });

  it('switchport trunk allowed vlan all resets to the IOS default sentinel', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
      'switchport trunk allowed vlan 10',
      'switchport trunk allowed vlan all',
    ]);
    expect(s.device.switchports['Fa0/3'].trunkAllowedVlans).toBe('all');
  });

  it('switchport trunk allowed vlan none empties the allowed list', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
      'switchport trunk allowed vlan none',
    ]);
    expect(s.device.switchports['Fa0/3'].trunkAllowedVlans).toEqual([]);
  });

  it('switchport trunk native vlan <id> sets the native VLAN; reset returns to 1', () => {
    const set = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
      'switchport trunk native vlan 99',
    ]);
    expect(set.device.switchports['Fa0/3'].nativeVlan).toBe(99);

    const reset = run(set, ['configure terminal', 'interface fa0/3', 'no switchport trunk native vlan']);
    expect(reset.device.switchports['Fa0/3'].nativeVlan).toBe(1);
  });

  it('no switchport trunk allowed vlan resets to "all"', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
      'switchport trunk allowed vlan 10,20',
      'no switchport trunk allowed vlan',
    ]);
    expect(s.device.switchports['Fa0/3'].trunkAllowedVlans).toBe('all');
  });

  it('switchport trunk native vlan rejects out-of-range and reserved ids', () => {
    const bad = applySwitchCommand(
      run(fresh(), ['enable', 'configure terminal', 'interface fa0/3', 'switchport mode trunk']),
      'switchport trunk native vlan 5000',
    );
    expect(bad.output.some((o) => o.kind === 'error' && /Invalid input/.test(o.text))).toBe(true);
    expect(bad.session.device.switchports['Fa0/3'].nativeVlan).toBe(1);

    const reserved = applySwitchCommand(
      run(fresh(), ['enable', 'configure terminal', 'interface fa0/3', 'switchport mode trunk']),
      'switchport trunk native vlan 1003',
    );
    expect(reserved.output.some((o) => o.kind === 'error' && /reserved/i.test(o.text))).toBe(true);
  });

  it('switchport trunk allowed vlan rejects malformed lists', () => {
    const badRange = applySwitchCommand(
      run(fresh(), ['enable', 'configure terminal', 'interface fa0/3', 'switchport mode trunk']),
      'switchport trunk allowed vlan 30-10',
    );
    expect(badRange.output.some((o) => o.kind === 'error' && /Invalid input/.test(o.text))).toBe(true);

    const nonNumeric = applySwitchCommand(
      run(fresh(), ['enable', 'configure terminal', 'interface fa0/3', 'switchport mode trunk']),
      'switchport trunk allowed vlan foo',
    );
    expect(nonNumeric.output.some((o) => o.kind === 'error' && /Invalid input/.test(o.text))).toBe(true);
  });

  it('carets the offending vlan id on `switchport access vlan` (config-if)', () => {
    const cfgIf = run(fresh(), ['enable', 'configure terminal', 'interface fa0/3']);
    const { output } = applySwitchCommand(cfgIf, 'switchport access vlan 5000');
    // 'SW1(config-if)#' + space = promptLen; '5000' starts at offset 23:
    //   'switchport '(11) + 'access '(7) + 'vlan '(5) = 23
    const promptLen = switchAdapter.prompt(cfgIf).length + 1;
    expect(output[0].text).toBe(' '.repeat(promptLen + 23) + '^');
    expect(output[1].text).toBe("% Invalid input detected at '^' marker.");
  });
});

describe('switch — show interfaces trunk', () => {
  it('reports "no trunk interfaces" when none are configured', () => {
    const text = applySwitchCommand(run(fresh(), ['enable']), 'show interfaces trunk')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/^There are no trunk interfaces\.$/);
  });

  it('lists only trunk-mode ports across all four sections', () => {
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
      'interface fa0/3',
      'switchport mode trunk',
      'end',
    ]);
    const text = applySwitchCommand(s, 'show interfaces trunk')
      .output.map((o) => o.text)
      .join('\n');
    // Section 1: only Fa0/3 (the trunk) appears; Fa0/1 (access) does not.
    expect(text).toMatch(/Port\s+Mode\s+Encapsulation\s+Status\s+Native vlan/);
    expect(text).toMatch(/^Fa0\/3\s+on\s+802\.1q\s+trunking\s+1$/m);
    expect(text).not.toMatch(/^Fa0\/1\s+/m);
    // Section 2: allowed VLANs (default → 1-4094).
    expect(text).toMatch(/Vlans allowed on trunk/);
    expect(text).toMatch(/^Fa0\/3\s+1-4094$/m);
    // Section 3: allowed + active in management domain. VLANs 1,10,20 are active.
    expect(text).toMatch(/Vlans allowed and active in management domain/);
    expect(text).toMatch(/^Fa0\/3\s+1,10,20$/m);
    // Section 4: STP not modeled — mirrors section 3.
    expect(text).toMatch(/Vlans in spanning tree forwarding state and not pruned/);
  });

  it('honors a restricted allowed list in the trunk show output', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'vlan 10',
      'exit',
      'vlan 20',
      'exit',
      'interface fa0/3',
      'switchport mode trunk',
      'switchport trunk allowed vlan 10,20',
      'end',
    ]);
    const text = applySwitchCommand(s, 'show interfaces trunk')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/^Fa0\/3\s+10,20$/m);
  });
});

describe('switch — show interfaces switchport (trunk fields)', () => {
  it('adds Trunking VLANs Enabled and reports trunk mode/native VLAN for trunk ports', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
      'end',
    ]);
    const text = applySwitchCommand(s, 'show interfaces fa0/3 switchport')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/^Administrative Mode: trunk$/m);
    expect(text).toMatch(/^Operational Mode: trunk$/m);
    expect(text).toMatch(/^Trunking Native Mode VLAN: 1 \(default\)$/m);
    expect(text).toMatch(/^Trunking VLANs Enabled: ALL$/m);
  });

  it('lists explicit allowed list when set', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
      'switchport trunk allowed vlan 10,20',
      'end',
    ]);
    const text = applySwitchCommand(s, 'show interfaces fa0/3 switchport')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/^Trunking VLANs Enabled: 10,20$/m);
  });
});

describe('switch — show running-config interface <iface>', () => {
  it('renders a trunk-port stanza with allowed VLANs and native VLAN, even at defaults', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
      'end',
    ]);
    const text = applySwitchCommand(s, 'show running-config interface fa0/3')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/^interface FastEthernet0\/3$/m);
    expect(text).toMatch(/^ switchport mode trunk$/m);
    // Default allowed list rendered as 1-4094 (not omitted as in bulk show run).
    expect(text).toMatch(/^ switchport trunk allowed vlan 1-4094$/m);
    // Default native VLAN rendered explicitly as 1.
    expect(text).toMatch(/^ switchport trunk native vlan 1$/m);
  });

  it('renders explicit allowed/native values when learner has changed them', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
      'switchport trunk allowed vlan 10,20',
      'switchport trunk native vlan 99',
      'end',
    ]);
    const text = applySwitchCommand(s, 'show running-config interface fa0/3')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/^ switchport trunk allowed vlan 10,20$/m);
    expect(text).toMatch(/^ switchport trunk native vlan 99$/m);
  });

  it('renders an access-port stanza with the access VLAN', () => {
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
    const text = applySwitchCommand(s, 'show running-config interface fa0/1')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/^interface FastEthernet0\/1$/m);
    expect(text).toMatch(/^ switchport mode access$/m);
    expect(text).toMatch(/^ switchport access vlan 10$/m);
    expect(text).not.toMatch(/switchport trunk/);
  });

  it('resolves the prefix-match form: sh run int fa0/3', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
      'end',
    ]);
    const text = applySwitchCommand(s, 'sh run int fa0/3')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/^interface FastEthernet0\/3$/m);
    expect(text).toMatch(/^ switchport mode trunk$/m);
  });

  it('errors on an unknown interface', () => {
    const text = applySwitchCommand(run(fresh(), ['enable']), 'show running-config interface fa9/9')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/% Invalid interface/);
  });
});

describe('switch — running-config trunk stanza', () => {
  it('emits switchport mode trunk and only NON-default trunk settings', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
      'switchport trunk allowed vlan 10,20',
      'switchport trunk native vlan 99',
      'end',
    ]);
    const text = applySwitchCommand(s, 'show running-config')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/^interface FastEthernet0\/3$/m);
    expect(text).toMatch(/^ switchport mode trunk$/m);
    expect(text).toMatch(/^ switchport trunk allowed vlan 10,20$/m);
    expect(text).toMatch(/^ switchport trunk native vlan 99$/m);
  });

  it('omits switchport trunk allowed vlan when at default "all"', () => {
    const s = run(fresh(), [
      'enable',
      'configure terminal',
      'interface fa0/3',
      'switchport mode trunk',
      'end',
    ]);
    const text = applySwitchCommand(s, 'show running-config')
      .output.map((o) => o.text)
      .join('\n');
    expect(text).toMatch(/^ switchport mode trunk$/m);
    expect(text).not.toMatch(/switchport trunk allowed vlan/);
    expect(text).not.toMatch(/switchport trunk native vlan/);
  });
});

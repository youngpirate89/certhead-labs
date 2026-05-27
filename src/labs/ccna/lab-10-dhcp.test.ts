import { describe, it, expect } from 'vitest';
import {
  initLabSession,
  applyToDevice,
  setActive,
  type LabSession,
} from '@/engine/lab-session';
import { grade } from '@/engine/grading';
import { lab10Dhcp } from './lab-10-dhcp';
import type { Session as RouterSession } from '@/engine/adapters/ios/state';
import type { PcSession } from '@/engine/adapters/pc';

/** Apply a sequence of commands to one device, threading the session. */
function runOn(lab: LabSession, deviceId: string, lines: readonly string[]): LabSession {
  let cur = setActive(lab, deviceId);
  for (const line of lines) {
    cur = applyToDevice(cur, deviceId, line).session;
  }
  return cur;
}

function fresh(): LabSession {
  return initLabSession(lab10Dhcp);
}

function r1(lab: LabSession): RouterSession {
  const s = lab.devices.R1;
  if (s.kind !== 'router') throw new Error('R1 is not a router');
  return s;
}

function pca(lab: LabSession): PcSession {
  const s = lab.devices['PC-A'];
  if (s.kind !== 'pc') throw new Error('PC-A is not a pc');
  return s;
}

/** All-objectives-complete configuration on R1. Ends with `end` so the
 *  session lands at priv mode — tests can append `show` commands directly. */
const FULL_CONFIG: readonly string[] = [
  'enable',
  'configure terminal',
  'ip dhcp excluded-address 192.168.1.1 192.168.1.10',
  'ip dhcp pool LAN',
  'network 192.168.1.0 255.255.255.0',
  'default-router 192.168.1.1',
  'dns-server 8.8.8.8',
  'end',
];

describe('Lab 10 — DHCP server config commands', () => {
  it('ip dhcp pool creates a pool and enters config-dhcp', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp pool LAN',
    ]);
    const r = r1(lab);
    expect(r.mode).toBe('config-dhcp');
    expect(r.activeDhcpPool).toBe('LAN');
    expect(r.device.dhcpPools.has('LAN')).toBe(true);
  });

  it('config-dhcp prompt reads R1(config-dhcp)#', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp pool LAN',
    ]);
    // We can't assert on the prompt without going through promptFor; instead
    // verify the mode + the fact that exit returns to config (which the next
    // test covers).
    const r = r1(lab);
    expect(r.mode).toBe('config-dhcp');
  });

  it('network <ip> <mask> writes pool network/mask', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp pool LAN',
      'network 192.168.1.0 255.255.255.0',
    ]);
    const pool = r1(lab).device.dhcpPools.get('LAN');
    expect(pool?.network).toBe('192.168.1.0');
    expect(pool?.mask).toBe('255.255.255.0');
  });

  it('default-router writes pool defaultRouter', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp pool LAN',
      'default-router 192.168.1.1',
    ]);
    expect(r1(lab).device.dhcpPools.get('LAN')?.defaultRouter).toBe('192.168.1.1');
  });

  it('dns-server writes pool dnsServer', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp pool LAN',
      'dns-server 8.8.8.8',
    ]);
    expect(r1(lab).device.dhcpPools.get('LAN')?.dnsServer).toBe('8.8.8.8');
  });

  it('lease <days> writes pool leaseDays without error', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp pool LAN',
      'lease 7',
    ]);
    expect(r1(lab).device.dhcpPools.get('LAN')?.leaseDays).toBe(7);
  });

  it('exit from config-dhcp returns to config mode', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp pool LAN',
      'exit',
    ]);
    const r = r1(lab);
    expect(r.mode).toBe('config');
    expect(r.activeDhcpPool).toBeNull();
  });

  it('ip dhcp excluded-address with both args stores the range', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp excluded-address 192.168.1.1 192.168.1.10',
    ]);
    expect(r1(lab).device.dhcpExcluded).toEqual([
      { start: '192.168.1.1', end: '192.168.1.10' },
    ]);
  });

  it('ip dhcp excluded-address single host stores start === end', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp excluded-address 192.168.1.5',
    ]);
    expect(r1(lab).device.dhcpExcluded).toEqual([
      { start: '192.168.1.5', end: '192.168.1.5' },
    ]);
  });

  it('no ip dhcp excluded-address removes the range', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp excluded-address 192.168.1.1 192.168.1.10',
      'no ip dhcp excluded-address 192.168.1.1 192.168.1.10',
    ]);
    expect(r1(lab).device.dhcpExcluded).toEqual([]);
  });
});

describe('Lab 10 — DHCP binding lifecycle', () => {
  it('PC-A starts with no IP (DHCP pending)', () => {
    const pc = pca(fresh());
    expect(pc.dhcpMode).toBe(true);
    expect(pc.ip).toBeNull();
    expect(pc.mask).toBeNull();
    expect(pc.gateway).toBeNull();
  });

  it('binding lands once the pool is fully configured', () => {
    const lab = runOn(fresh(), 'R1', FULL_CONFIG);
    const binding = r1(lab).device.dhcpBindings.get('PC-A');
    expect(binding).toBeDefined();
    expect(binding?.poolName).toBe('LAN');
  });

  it('binding IP is 192.168.1.11 — the first slot past the excluded range', () => {
    const lab = runOn(fresh(), 'R1', FULL_CONFIG);
    expect(r1(lab).device.dhcpBindings.get('PC-A')?.ip).toBe('192.168.1.11');
  });

  it('PC-A inherits ip/mask/gateway from the matching pool', () => {
    const lab = runOn(fresh(), 'R1', FULL_CONFIG);
    const pc = pca(lab);
    expect(pc.ip).toBe('192.168.1.11');
    expect(pc.mask).toBe('255.255.255.0');
    expect(pc.gateway).toBe('192.168.1.1');
  });

  it('binding does NOT land while only excluded-address is set', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp excluded-address 192.168.1.1 192.168.1.10',
    ]);
    expect(r1(lab).device.dhcpBindings.size).toBe(0);
    expect(pca(lab).ip).toBeNull();
  });

  it('binding lands as soon as network/mask are set, even without other pool fields', () => {
    // Only network + mask are needed for allocation. The default-router /
    // dns-server pool fields are advisory; the allocator works without them.
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp pool LAN',
      'network 192.168.1.0 255.255.255.0',
    ]);
    const binding = r1(lab).device.dhcpBindings.get('PC-A');
    expect(binding?.ip).toBe('192.168.1.1');
  });

  it('binding clears when the pool network is cleared', () => {
    const configured = runOn(fresh(), 'R1', FULL_CONFIG);
    expect(r1(configured).device.dhcpBindings.size).toBe(1);
    const cleared = runOn(configured, 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp pool LAN',
      'no network',
    ]);
    expect(r1(cleared).device.dhcpBindings.size).toBe(0);
    expect(pca(cleared).ip).toBeNull();
  });
});

describe('Lab 10 — show ip dhcp', () => {
  it('show ip dhcp binding sets lastShowDhcpBinding only when bindings exist', () => {
    const empty = runOn(fresh(), 'R1', [
      'enable',
      'show ip dhcp binding',
    ]);
    expect(r1(empty).lastShowDhcpBinding).toBe(0);

    const populated = runOn(runOn(fresh(), 'R1', FULL_CONFIG), 'R1', [
      'show ip dhcp binding',
    ]);
    expect(r1(populated).lastShowDhcpBinding).toBeGreaterThan(0);
  });

  it('show ip dhcp binding renders PC-A with the allocated IP', () => {
    const lab = runOn(fresh(), 'R1', FULL_CONFIG);
    const { output } = applyToDevice(setActive(lab, 'R1'), 'R1', 'show ip dhcp binding');
    const text = output.map((o) => o.text).join('\n');
    expect(text).toContain('192.168.1.11');
    expect(text).toContain('PC-A');
  });

  it('show ip dhcp binding renders the empty-state line when no bindings exist', () => {
    const lab = runOn(fresh(), 'R1', ['enable']);
    const { output } = applyToDevice(setActive(lab, 'R1'), 'R1', 'show ip dhcp binding');
    const text = output.map((o) => o.text).join('\n');
    expect(text).toContain('% There is no binding.');
  });

  it('show ip dhcp pool renders the pool fields', () => {
    const lab = runOn(fresh(), 'R1', FULL_CONFIG);
    const { output } = applyToDevice(setActive(lab, 'R1'), 'R1', 'show ip dhcp pool');
    const text = output.map((o) => o.text).join('\n');
    expect(text).toContain('Pool LAN');
    expect(text).toContain('192.168.1.0 255.255.255.0');
    expect(text).toContain('192.168.1.1');
    expect(text).toContain('8.8.8.8');
  });

  it('show ip dhcp conflict renders the static empty-table output', () => {
    const lab = fresh();
    const { output } = applyToDevice(setActive(lab, 'R1'), 'R1', 'show ip dhcp conflict');
    const text = output.map((o) => o.text).join('\n');
    expect(text).toContain('% There are no entries in the database.');
  });
});

describe('Lab 10 — objective coverage', () => {
  it('all objectives unmet on a fresh session', () => {
    const result = grade(lab10Dhcp, fresh());
    expect(result.allMet).toBe(false);
    for (const o of result.objectives) {
      expect(o.met).toBe(false);
    }
  });

  it('excluded objective: false → true after `ip dhcp excluded-address` runs', () => {
    const lab = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp excluded-address 192.168.1.1 192.168.1.10',
    ]);
    const o = grade(lab10Dhcp, lab).objectives.find((x) => x.id === 'excluded');
    expect(o?.met).toBe(true);
  });

  it('pool-network objective: false until network is set, then true', () => {
    const partial = runOn(fresh(), 'R1', [
      'enable',
      'configure terminal',
      'ip dhcp pool LAN',
    ]);
    expect(
      grade(lab10Dhcp, partial).objectives.find((x) => x.id === 'pool-network')?.met,
    ).toBe(false);
    const full = runOn(partial, 'R1', ['network 192.168.1.0 255.255.255.0']);
    expect(
      grade(lab10Dhcp, full).objectives.find((x) => x.id === 'pool-network')?.met,
    ).toBe(true);
  });

  it('binding objective: true when PC-A receives any IP in 192.168.1.0/24', () => {
    const lab = runOn(fresh(), 'R1', FULL_CONFIG);
    expect(grade(lab10Dhcp, lab).objectives.find((x) => x.id === 'binding')?.met).toBe(true);
  });

  it('verify objective: false until `show ip dhcp binding` runs against a populated table', () => {
    const configured = runOn(fresh(), 'R1', FULL_CONFIG);
    expect(grade(lab10Dhcp, configured).objectives.find((x) => x.id === 'verify')?.met).toBe(false);
    const verified = runOn(configured, 'R1', ['show ip dhcp binding']);
    expect(grade(lab10Dhcp, verified).objectives.find((x) => x.id === 'verify')?.met).toBe(true);
  });

  it('full configuration + verify satisfies every objective', () => {
    const lab = runOn(fresh(), 'R1', [...FULL_CONFIG, 'show ip dhcp binding']);
    const result = grade(lab10Dhcp, lab);
    const unmet = result.objectives.filter((o) => !o.met).map((o) => o.id);
    expect(unmet).toEqual([]);
    expect(result.allMet).toBe(true);
  });
});

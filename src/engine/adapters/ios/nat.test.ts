/**
 * NAT (PAT overload) — adapter-level tests for ip nat inside/outside,
 * ip nat inside source list ... overload, and the show ip nat handlers.
 *
 * These tests drive the router adapter in isolation (no LabSession), so
 * `natTranslations` here is whatever the adapter handler reads — i.e. an
 * empty map unless seeded by hand. The LabSession-level NAT refresh is
 * covered in reachability-nat.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { routerAdapter } from '../router';
import type { Session } from './state';

const SPEC = {
  id: 'R1',
  kind: 'router' as const,
  platform: 'ISR4321',
  interfaces: ['Gi0/0', 'Gi0/1'],
};

/** Drive the adapter through a sequence of lines and return the final session.
 *  Mirrors the pattern in router.test.ts so failure traces stay readable. */
function run(lines: string[]): Session {
  return lines.reduce<Session>(
    (acc, line) => routerAdapter.applyCommand(acc, line).session,
    routerAdapter.buildDevice(SPEC),
  );
}

describe('NAT — config-if ip nat inside / ip nat outside', () => {
  it('ip nat inside sets natRole=inside on the active interface', () => {
    const s = run([
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'ip nat inside',
    ]);
    expect(s.device.interfaces['Gi0/0'].natRole).toBe('inside');
    expect(s.device.interfaces['Gi0/1'].natRole).toBeUndefined();
  });

  it('ip nat outside sets natRole=outside on the active interface', () => {
    const s = run([
      'enable',
      'configure terminal',
      'interface Gi0/1',
      'ip nat outside',
    ]);
    expect(s.device.interfaces['Gi0/1'].natRole).toBe('outside');
    expect(s.device.interfaces['Gi0/0'].natRole).toBeUndefined();
  });

  it('no ip nat inside clears the natRole when it matches', () => {
    const s = run([
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'ip nat inside',
      'no ip nat inside',
    ]);
    expect(s.device.interfaces['Gi0/0'].natRole).toBeUndefined();
  });

  it('no ip nat outside on an inside-marked iface is a silent no-op', () => {
    const s = run([
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'ip nat inside',
      // Mismatched role — IOS leaves the existing inside marking intact.
      'no ip nat outside',
    ]);
    expect(s.device.interfaces['Gi0/0'].natRole).toBe('inside');
  });

  it('re-applying ip nat inside is idempotent', () => {
    const s = run([
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'ip nat inside',
      'ip nat inside',
    ]);
    expect(s.device.interfaces['Gi0/0'].natRole).toBe('inside');
  });
});

describe('NAT — ip nat inside source list <acl> interface <iface> overload', () => {
  it('adds a NatStatement to device.natStatements', () => {
    const s = run([
      'enable',
      'configure terminal',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'ip nat inside source list 1 interface Gi0/1 overload',
    ]);
    expect(s.device.natStatements).toEqual([
      {
        type: 'inside-source-list-overload',
        aclId: 1,
        outsideInterface: 'Gi0/1',
      },
    ]);
  });

  it('accepts GigabitEthernet0/1 (full name) and normalises to Gi0/1', () => {
    const s = run([
      'enable',
      'configure terminal',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'ip nat inside source list 1 interface GigabitEthernet0/1 overload',
    ]);
    expect(s.device.natStatements[0].outsideInterface).toBe('Gi0/1');
  });

  it('replaces an existing statement bound to the same outside interface', () => {
    const s = run([
      'enable',
      'configure terminal',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'access-list 2 permit 10.0.0.0 0.0.0.255',
      'ip nat inside source list 1 interface Gi0/1 overload',
      // Re-binding Gi0/1 to a different ACL collapses to one statement.
      'ip nat inside source list 2 interface Gi0/1 overload',
    ]);
    expect(s.device.natStatements).toHaveLength(1);
    expect(s.device.natStatements[0].aclId).toBe(2);
  });

  it('rejects a non-existent interface argument', () => {
    const before = run([
      'enable',
      'configure terminal',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
    ]);
    const result = routerAdapter.applyCommand(
      before,
      'ip nat inside source list 1 interface Gi9/9 overload',
    );
    expect(result.session.device.natStatements).toEqual([]);
    expect(result.output.some((o) => o.kind === 'error')).toBe(true);
  });

  it('no ip nat inside source list ... overload removes the matching statement', () => {
    const s = run([
      'enable',
      'configure terminal',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'ip nat inside source list 1 interface Gi0/1 overload',
      'no ip nat inside source list 1 interface Gi0/1 overload',
    ]);
    expect(s.device.natStatements).toEqual([]);
  });
});

describe('NAT — show ip nat translations / statistics', () => {
  it('show ip nat translations prints the empty-table notice when nothing is configured', () => {
    const s = run(['enable']);
    const result = routerAdapter.applyCommand(s, 'show ip nat translations');
    const lines = result.output.map((o) => o.text);
    expect(lines).toEqual(['% There are no entries in the NAT table.']);
    expect(result.session.lastShowNatTranslations).toBe(0);
  });

  it('show ip nat translations does NOT stamp the verify gate when the table is empty', () => {
    // Even with full NAT config, a fresh adapter (no LabSession) has an
    // empty natTranslations map — verify gate stays at 0.
    const s = run([
      'enable',
      'configure terminal',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'interface Gi0/0',
      'ip nat inside',
      'exit',
      'interface Gi0/1',
      'ip address 203.0.113.1 255.255.255.252',
      'no shutdown',
      'ip nat outside',
      'exit',
      'ip nat inside source list 1 interface Gi0/1 overload',
    ]);
    const result = routerAdapter.applyCommand(s, 'show ip nat translations');
    expect(result.session.lastShowNatTranslations).toBe(0);
  });

  it('show ip nat translations renders a row + stamps the verify gate when seeded', () => {
    const s = run(['enable']);
    // Seed a translation by hand to simulate the LabSession refresh result.
    s.device.natTranslations.set('192.168.1.10', {
      insideLocal: '192.168.1.10',
      insideGlobal: '203.0.113.1',
    });
    const result = routerAdapter.applyCommand(s, 'show ip nat translations');
    const lines = result.output.map((o) => o.text);
    expect(lines[0]).toContain('Inside global');
    expect(lines[1]).toContain('203.0.113.1');
    expect(lines[1]).toContain('192.168.1.10');
    expect(result.session.lastShowNatTranslations).toBeGreaterThan(0);
  });

  it('show ip nat statistics lists inside and outside interfaces', () => {
    const s = run([
      'enable',
      'configure terminal',
      'interface Gi0/0',
      'ip nat inside',
      'exit',
      'interface Gi0/1',
      'ip nat outside',
      'end',
    ]);
    const result = routerAdapter.applyCommand(s, 'show ip nat statistics');
    const lines = result.output.map((o) => o.text);
    expect(lines.join('\n')).toContain('GigabitEthernet0/0');
    expect(lines.join('\n')).toContain('GigabitEthernet0/1');
    expect(lines.join('\n')).toContain('Total active translations: 0');
  });
});

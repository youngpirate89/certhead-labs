import { describe, expect, it } from 'vitest';
import { initLabSession, applyToDevice, type LabSession } from '@/engine/lab-session';
import type { Lab } from '@/engine/types';

const lab: Lab = {
  id: 'device-hardening-engine-fixture',
  title: 'Device Hardening Engine Fixture',
  exam: 'TEST',
  difficulty: 1,
  estimatedMinutes: 1,
  isFree: false,
  scenario: 'fixture',
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Windows Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' },
      },
      { id: 'R1', kind: 'router', platform: 'ISR4321', interfaces: ['Gi0/0'] },
    ],
    links: [{ a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } }],
  },
  objectives: [],
  hints: [],
};

function run(ls: LabSession, deviceId: string, lines: string[]): LabSession {
  return lines.reduce((acc, line) => applyToDevice(acc, deviceId, line).session, ls);
}

function configuredRouter(): LabSession {
  const ls = initLabSession(lab);
  return run(ls, 'R1', [
    'enable',
    'configure terminal',
    'hostname R1',
    'interface gi0/0',
    'ip address 192.168.1.1 255.255.255.0',
    'no shutdown',
    'exit',
    'ip domain-name certhead.local',
    'username admin secret C1sco123',
    'enable secret En4ble123',
    'crypto key generate rsa modulus 1024',
    'line vty 0 4',
    'login local',
    'transport input ssh',
    'end',
  ]);
}

describe('IOS device hardening command surface', () => {
  it('stores SSH hardening state from realistic IOS commands', () => {
    const ls = configuredRouter();
    const r1 = ls.devices.R1;
    if (r1?.kind !== 'router') throw new Error('R1 is not a router');

    expect(r1.device.security.domainName).toBe('certhead.local');
    expect(r1.device.security.enableSecret).toBe('En4ble123');
    expect(r1.device.security.users.get('admin')?.secret).toBe('C1sco123');
    expect(r1.device.security.cryptoKeyModulus).toBe(1024);
    expect(r1.device.security.vtyLoginLocal).toBe(true);
    expect(r1.device.security.vtyTransportInput).toBe('ssh');
  });

  it('renders IOS-like show ip ssh status before and after SSH is configured', () => {
    const initial = applyToDevice(initLabSession(lab), 'R1', 'show ip ssh');
    expect(initial.output.map((o) => o.text).join('\n')).toMatch(/SSH Disabled/i);

    const ready = applyToDevice(configuredRouter(), 'R1', 'show ip ssh');
    const text = ready.output.map((o) => o.text).join('\n');
    expect(text).toMatch(/SSH Enabled - version 2\.0/i);
    expect(text).toMatch(/Authentication methods:publickey,keyboard-interactive,password/i);
    expect(text).toMatch(/Authentication Publickey Algorithms:/i);
  });

  it('stores and renders a MOTD warning banner for hardening realism', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'R1', ['enable', 'configure terminal', 'banner motd ^CUnauthorized access prohibited^C']);
    const r1 = ls.devices.R1;
    if (r1?.kind !== 'router') throw new Error('R1 is not a router');
    expect(r1.device.security.motdBanner).toBe('Unauthorized access prohibited');

    const result = applyToDevice(ls, 'R1', 'do show running-config');
    expect(result.output.map((o) => o.text).join('\n')).toMatch(/banner motd \^CUnauthorized access prohibited\^C/);
  });

  it('renders device hardening lines in show running-config', () => {
    const ls = configuredRouter();
    const result = applyToDevice(ls, 'R1', 'show running-config');
    const text = result.output.map((o) => o.text).join('\n');

    expect(text).toMatch(/hostname R1/);
    expect(text).toMatch(/ip domain-name certhead\.local/);
    expect(text).toMatch(/username admin secret C1sco123/);
    expect(text).toMatch(/enable secret En4ble123/);
    expect(text).toMatch(/crypto key generate rsa modulus 1024/);
    expect(text).toMatch(/line vty 0 4/);
    expect(text).toMatch(/ login local/);
    expect(text).toMatch(/ transport input ssh/);
  });

  it('allows PC SSH only after local user, domain name, RSA key, VTY login local, and SSH transport are configured', () => {
    let ls = initLabSession(lab);
    ls = run(ls, 'R1', [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'end',
    ]);

    const before = applyToDevice(ls, 'PC-A', 'ssh admin@192.168.1.1');
    expect(before.output.map((o) => o.text).join('\n')).toMatch(/Connection refused/);

    ls = configuredRouter();
    const after = applyToDevice(ls, 'PC-A', 'ssh admin@192.168.1.1');
    const text = after.output.map((o) => o.text).join('\n');
    expect(text).toMatch(/Connecting to 192\.168\.1\.1 as admin/);
    expect(text).toMatch(/Password authentication accepted/);
    expect(text).toMatch(/R1#/);

    const pc = after.session.devices['PC-A'];
    if (pc?.kind !== 'pc') throw new Error('PC-A is not a PC');
    expect(pc.lastSsh).toEqual({ target: '192.168.1.1', user: 'admin', ok: true });
  });
});

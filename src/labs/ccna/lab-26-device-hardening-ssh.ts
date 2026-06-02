import type { Lab } from '@/engine/types';

/**
 * Lab 26 — device hardening with SSH.
 *
 * Scope: CCNA management-plane basics only. We model enough IOS state for
 * local user auth, enable secret, domain name, RSA key generation, VTY login
 * policy, SSH-only transport, show-running verification, and a workstation SSH
 * test. We do not emulate an interactive SSH session or password prompts.
 */
export const lab26DeviceHardeningSsh: Lab = {
  id: 'ccna-lab26-device-hardening-ssh',
  title: 'Device Hardening: Enable SSH Management',
  exam: 'CCNA 200-301',
  difficulty: 2,
  estimatedMinutes: 12,
  isFree: false,
  scenario:
    'You are preparing R1 for secure remote management from the admin workstation. Basic IPv4 connectivity is already in place between PC-A and R1. Harden R1 by creating a local admin user, setting an enable secret, configuring the domain name required for RSA keys, generating an RSA key, and restricting the VTY lines to SSH with local login.\n\nAfter the configuration is complete, verify the running configuration on R1 and test SSH from PC-A using realistic workstation syntax.',
  topology: {
    devices: [
      {
        id: 'PC-A',
        kind: 'pc',
        platform: 'Windows Workstation',
        interfaces: ['Eth0'],
        pc: { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' },
        position: { x: 0, y: 0 },
      },
      {
        id: 'R1',
        kind: 'router',
        platform: 'ISR4321',
        interfaces: ['Gi0/0'],
        position: { x: 260, y: 0 },
      },
    ],
    links: [{ a: { deviceId: 'PC-A', iface: 'Eth0' }, b: { deviceId: 'R1', iface: 'Gi0/0' } }],
  },
  setup: {
    R1: [
      'enable',
      'configure terminal',
      'interface gi0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'end',
    ],
  },
  objectives: [
    {
      id: 'local-admin-user',
      text: 'R1: create local user admin with secret C1sco123',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        return r1?.kind === 'router' && r1.device.security.users.get('admin')?.secret === 'C1sco123';
      },
    },
    {
      id: 'enable-secret',
      text: 'R1: configure enable secret En4ble123',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        return r1?.kind === 'router' && r1.device.security.enableSecret === 'En4ble123';
      },
    },
    {
      id: 'domain-and-rsa-key',
      text: 'R1: set ip domain-name certhead.local and generate a 1024-bit RSA key',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        return (
          r1?.kind === 'router' &&
          r1.device.security.domainName === 'certhead.local' &&
          r1.device.security.cryptoKeyModulus === 1024
        );
      },
    },
    {
      id: 'vty-ssh-only-local-login',
      text: 'R1 VTY 0 4: use login local and transport input ssh',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        return (
          r1?.kind === 'router' &&
          r1.device.security.vtyLoginLocal &&
          r1.device.security.vtyTransportInput === 'ssh'
        );
      },
    },
    {
      id: 'verify-running-config',
      text: 'R1: run show running-config after the hardening configuration exists',
      check: (_state, _history, session) => {
        const r1 = session.devices.R1;
        if (r1?.kind !== 'router') return false;
        const sec = r1.device.security;
        const ready = Boolean(
          sec.domainName &&
            sec.enableSecret &&
            sec.users.has('admin') &&
            sec.cryptoKeyModulus !== null &&
            sec.vtyLoginLocal &&
            sec.vtyTransportInput === 'ssh',
        );
        return ready && r1.lastShowRunningConfig > 0;
      },
    },
    {
      id: 'verify-ssh-from-pc',
      text: 'PC-A: test SSH to R1 with ssh admin@192.168.1.1 after hardening is complete',
      check: (_state, _history, session) => {
        const pc = session.devices['PC-A'];
        return (
          pc?.kind === 'pc' &&
          pc.lastSsh?.target === '192.168.1.1' &&
          pc.lastSsh.user === 'admin' &&
          pc.lastSsh.ok === true
        );
      },
    },
  ],
  hints: [
    {
      afterSeconds: 90,
      text: 'SSH on IOS needs a hostname/domain name, a local username, RSA keys, and VTY lines configured for local login with SSH transport.',
    },
    {
      afterSeconds: 240,
      text: 'Use `ip domain-name certhead.local`, `username admin secret C1sco123`, `enable secret En4ble123`, `crypto key generate rsa modulus 1024`, then under `line vty 0 4` use `login local` and `transport input ssh`.',
    },
  ],
  solution: {
    steps: [
      {
        device: 'R1',
        note: 'Configure local credentials, generate RSA keys, and lock the VTY lines to SSH:',
        commands: [
          'enable',
          'configure terminal',
          'hostname R1',
          'ip domain-name certhead.local',
          'username admin secret C1sco123',
          'enable secret En4ble123',
          'banner motd ^CUnauthorized access prohibited^C',
          'crypto key generate rsa modulus 1024',
          'line vty 0 4',
          'login local',
          'transport input ssh',
          'end',
          'show ip ssh',
          'show running-config',
        ],
      },
      {
        device: 'PC-A',
        note: 'From the workstation command prompt, test SSH to R1:',
        commands: ['ssh admin@192.168.1.1'],
      },
    ],
  },
};

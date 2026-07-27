import { describe, expect, it } from 'vitest';
import { pcAdapter, type PcSession } from './pc';

const WLC_SPEC = {
  id: 'WLC1',
  kind: 'pc' as const,
  platform: 'Wireless LAN Controller',
  deviceClass: 'server' as const,
  interfaces: ['Mgmt0'],
};

function fresh(): PcSession {
  return pcAdapter.buildDevice(WLC_SPEC);
}

function run(start: PcSession, lines: string[]): PcSession {
  return lines.reduce((s, line) => pcAdapter.applyCommand(s, line).session, start);
}

describe('pcAdapter — scoped wireless controller commands', () => {
  it('initializes wireless controller state only for WLC platform devices', () => {
    const wlc = fresh();
    const pc = pcAdapter.buildDevice({ id: 'PC-A', kind: 'pc', platform: 'Windows Workstation', interfaces: ['Eth0'] });

    expect(wlc.wirelessController).toBeDefined();
    expect(wlc.wirelessController?.interfaces.size).toBe(0);
    expect(wlc.wirelessController?.wlans.size).toBe(0);
    expect(pc.wirelessController).toBeUndefined();
  });

  it('creates a dynamic interface, creates a WLAN, maps it to VLAN 20, and enables it', () => {
    const s = run(fresh(), [
      'config interface create CORP-USERS 20',
      'config wlan create 1 CORP-WIFI CORP-WIFI',
      'config wlan interface 1 CORP-USERS',
      'config wlan enable 1',
    ]);

    expect(s.wirelessController?.interfaces.get('CORP-USERS')).toEqual({ name: 'CORP-USERS', vlanId: 20, configuredAt: expect.any(Number) });
    expect(s.wirelessController?.wlans.get(1)).toMatchObject({
      id: 1,
      profile: 'CORP-WIFI',
      ssid: 'CORP-WIFI',
      interfaceName: 'CORP-USERS',
      enabled: true,
    });
  });

  it('renders show wlan summary and show wlan <id> with SSID, status, interface, and VLAN', () => {
    const s = run(fresh(), [
      'config interface create CORP-USERS 20',
      'config wlan create 1 CORP-WIFI CORP-WIFI',
      'config wlan interface 1 CORP-USERS',
      'config wlan enable 1',
    ]);

    const summary = pcAdapter.applyCommand(s, 'show wlan summary').output.map((o) => o.text).join('\n');
    expect(summary).toMatch(/WLAN ID\s+Profile\s+SSID\s+Status\s+Interface\s+VLAN/);
    expect(summary).toMatch(/1\s+CORP-WIFI\s+CORP-WIFI\s+Enabled\s+CORP-USERS\s+20/);

    const detail = pcAdapter.applyCommand(s, 'show wlan 1').output.map((o) => o.text).join('\n');
    expect(detail).toMatch(/WLAN Identifier\s+: 1/);
    expect(detail).toMatch(/SSID\s+: CORP-WIFI/);
    expect(detail).toMatch(/Interface\s+: CORP-USERS/);
    expect(detail).toMatch(/VLAN\s+: 20/);
  });

  it('renders a lightweight client summary tied to the enabled WLAN and VLAN mapping', () => {
    const s = run(fresh(), [
      'config interface create CORP-USERS 20',
      'config wlan create 1 CORP-WIFI CORP-WIFI',
      'config wlan interface 1 CORP-USERS',
      'config wlan enable 1',
    ]);

    const result = pcAdapter.applyCommand(s, 'show client summary');
    const text = result.output.map((o) => o.text).join('\n');

    expect(text).toMatch(/Client\s+WLAN\s+SSID\s+Interface\s+VLAN\s+Status/);
    expect(text).toMatch(/Wireless-Client\s+1\s+CORP-WIFI\s+CORP-USERS\s+20\s+Ready/);
    expect(result.session.wirelessController?.lastShowClientSummary).toBeGreaterThan(0);
  });

  it('does not report a ready wireless client before the WLAN is enabled', () => {
    const s = run(fresh(), [
      'config interface create CORP-USERS 20',
      'config wlan create 1 CORP-WIFI CORP-WIFI',
      'config wlan interface 1 CORP-USERS',
    ]);

    const text = pcAdapter.applyCommand(s, 'show client summary').output.map((o) => o.text).join('\n');

    expect(text).toMatch(/Wireless-Client\s+1\s+CORP-WIFI\s+CORP-USERS\s+20\s+WLAN disabled/);
  });

  it('rejects wireless controller commands on normal workstations', () => {
    const pc = pcAdapter.buildDevice({ id: 'PC-A', kind: 'pc', platform: 'Windows Workstation', interfaces: ['Eth0'] });
    const out = pcAdapter.applyCommand(pc, 'config wlan create 1 CORP-WIFI CORP-WIFI').output;
    expect(out[0].kind).toBe('error');
    expect(out[0].text).toMatch(/wireless controller command/);
  });
});

describe('pcAdapter — lightweight access-point console', () => {
  function ap() {
    return pcAdapter.buildDevice({
      id: 'AP-1',
      kind: 'pc',
      deviceClass: 'access-point',
      platform: 'Catalyst 9115AXI Lightweight AP',
      interfaces: ['GigabitEthernet0'],
      pc: { ip: '10.170.30.60', mask: '255.255.255.0', gateway: '10.170.30.1' },
    });
  }

  it('uses an appliance prompt rather than a workstation shell prompt', () => {
    expect(pcAdapter.prompt(ap())).toBe('AP-1#');
  });

  it('renders AP-specific version and CAPWAP controller evidence', () => {
    const version = pcAdapter.applyCommand(ap(), 'show version').output.map((line) => line.text).join('\n');
    const capwap = pcAdapter.applyCommand(ap(), 'show capwap client config').output.map((line) => line.text).join('\n');

    expect(version).toMatch(/Catalyst 9115AXI/i);
    expect(version).toMatch(/CAPWAP/i);
    expect(capwap).toMatch(/Primary Controller Address/i);
    expect(capwap).toMatch(/Discovery/i);
  });

  it('supports the AP wired-uplink diagnostic surface', () => {
    const wired = pcAdapter.applyCommand(ap(), 'show interfaces wired').output.map((line) => line.text).join('\n');
    expect(wired).toMatch(/GigabitEthernet0/i);
    expect(wired).toMatch(/CAPWAP uplink/i);
  });

  it('does not pretend that switch configuration commands work on a lightweight AP', () => {
    const result = pcAdapter.applyCommand(ap(), 'interface gigabitethernet0');
    expect(result.output.map((line) => line.text).join('\n')).toMatch(/Unrecognized command/i);
  });
});

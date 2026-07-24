import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FloatingTerminalPanel } from './FloatingTerminalPanel';
import type { TerminalView } from '@/engine/terminal/useTerminal';

/** A no-op terminal view — enough to mount the embedded Terminal without
 *  pulling in the lab session machinery. */
function stubTerm(prompt = 'R1>'): TerminalView {
  return {
    lines: [],
    input: '',
    prompt,
    busy: false,
    setInput: vi.fn(),
    submit: vi.fn(),
    recallPrev: vi.fn(),
    recallNext: vi.fn(),
    print: vi.fn(),
    clear: vi.fn(),
    requestHelp: vi.fn(),
    tabComplete: vi.fn(),
  };
}

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof FloatingTerminalPanel>> = {},
) {
  const onSelectDevice = vi.fn();
  const onCloseDevice = vi.fn();
  const onCloseAll = vi.fn();
  const props: React.ComponentProps<typeof FloatingTerminalPanel> = {
    openDeviceIds: ['R1'],
    activeDeviceId: 'R1',
    forDevice: () => stubTerm(),
    platformLabel: (id) => (id === 'R1' ? 'ISR4321' : undefined),
    onSelectDevice,
    onCloseDevice,
    onCloseAll,
    ...overrides,
  };
  const result = render(<FloatingTerminalPanel {...props} />);
  return { ...result, onSelectDevice, onCloseDevice, onCloseAll };
}

describe('FloatingTerminalPanel', () => {
  it('renders the Terminal label in the header and an embedded Terminal body', () => {
    renderPanel();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
  });

  it('can render as a docked terminal that participates in layout instead of a fixed overlay', () => {
    const { container } = renderPanel({ mode: 'docked' });
    const panel = container.querySelector('[data-floating-terminal-panel]') as HTMLElement;

    expect(panel).not.toBeNull();
    expect(panel.className).toContain('relative');
    expect(panel.className).not.toContain('fixed');
    expect(panel.style.width).toBe('100%');
    expect(panel.style.height).toBe('100%');
    expect(panel.style.left).toBe('');
    expect(panel.style.top).toBe('');
  });

  it('renders a PC workbench with Desktop, Network Adapter, and Terminal tabs for PC devices', () => {
    renderPanel({
      activeDeviceId: 'PC-A',
      openDeviceIds: ['PC-A'],
      deviceKind: (id) => (id === 'PC-A' ? 'pc' : 'router'),
      pcNetwork: () => ({
        mode: 'static',
        ip: '192.168.1.10',
        mask: '255.255.255.0',
        gateway: '192.168.1.1',
        ipv6: null,
        gateway6: null,
      }),
      onPcNetworkApply: vi.fn(),
    });

    expect(screen.getByRole('tab', { name: 'Desktop' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Network Adapter' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Terminal' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Network Adapter' }));
    expect(screen.getByLabelText('IPv4 address octet 1')).toHaveValue('192');
    expect(screen.getByLabelText('IPv4 address octet 4')).toHaveValue('10');
    expect(screen.getByLabelText('Subnet mask octet 1')).toHaveValue('255');
    expect(screen.getByLabelText('Subnet mask octet 4')).toHaveValue('0');
    expect(screen.getByLabelText('Default gateway octet 1')).toHaveValue('192');
    expect(screen.getByLabelText('Default gateway octet 4')).toHaveValue('1');
  });

  it('renders a simple Packet Tracer-style desktop launcher instead of a status dashboard', () => {
    renderPanel({
      activeDeviceId: 'PC-A',
      openDeviceIds: ['PC-A'],
      deviceKind: () => 'pc',
      pcNetwork: () => ({
        mode: 'static',
        ip: '192.168.1.10',
        mask: '255.255.255.0',
        gateway: '192.168.1.1',
        ipv6: '2001:db8:acad:1::10/64',
        gateway6: '2001:db8:acad:1::1',
      }),
      onPcNetworkApply: vi.fn(),
    });

    expect(screen.getByText('PC-A Workstation')).toBeInTheDocument();
    expect(screen.getByText('Select a desktop tool')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'IP Configuration' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'IPv6 Configuration' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Command Prompt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SSH Client' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Terminal' })).toBeNull();
    expect(screen.queryByText('Desktop status')).toBeNull();
    expect(screen.queryByText('Adapter')).toBeNull();
    expect(screen.queryByText('Workflow')).toBeNull();
    expect(screen.queryByText('Configure adapter → verify IP → test SSH')).toBeNull();
    expect(screen.queryByText('2001:db8:acad:1::10/64')).toBeNull();
  });

  it('labels a wireless controller workbench as a controller, not a workstation', () => {
    renderPanel({
      activeDeviceId: 'WLC1',
      openDeviceIds: ['WLC1'],
      deviceKind: () => 'pc',
      platformLabel: () => 'Wireless LAN Controller',
      pcNetwork: () => ({
        mode: 'static',
        ip: '10.28.20.50',
        mask: '255.255.255.0',
        gateway: '10.28.20.1',
        ipv6: null,
        gateway6: null,
      }),
      onPcNetworkApply: vi.fn(),
    });

    expect(screen.getByText('WLC1 Wireless LAN Controller')).toBeInTheDocument();
    expect(screen.queryByText('WLC1 Workstation')).toBeNull();
  });

  it('renders a lightweight access point as a CLI-only appliance, not a workstation', () => {
    renderPanel({
      activeDeviceId: 'AP-1',
      openDeviceIds: ['AP-1'],
      deviceKind: () => 'pc',
      deviceClass: () => 'access-point',
      platformLabel: () => 'Catalyst 9115AXI Lightweight AP',
      pcNetwork: () => ({
        mode: 'static',
        ip: '10.170.30.60',
        mask: '255.255.255.0',
        gateway: '10.170.30.1',
        ipv6: null,
        gateway6: null,
      }),
      onPcNetworkApply: vi.fn(),
    });

    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Desktop' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Network Adapter' })).toBeNull();
    expect(screen.queryByText('TCP/IP Properties')).toBeNull();
  });

  it('opens a professional SSH client from the desktop and prepares a realistic ssh command', () => {
    const term = stubTerm('PC-A$');
    renderPanel({
      activeDeviceId: 'PC-A',
      openDeviceIds: ['PC-A'],
      forDevice: () => term,
      deviceKind: () => 'pc',
      pcNetwork: () => ({
        mode: 'static',
        ip: '192.168.1.10',
        mask: '255.255.255.0',
        gateway: '192.168.1.1',
        ipv6: null,
        gateway6: null,
      }),
      onPcNetworkApply: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: 'SSH Client' }));

    expect(screen.getByText('SSH Client')).toBeInTheDocument();
    expect(screen.getByText('Remote SSH access')).toBeInTheDocument();
    expect(screen.queryByText(/PuTTY/i)).toBeNull();
    expect(screen.getByLabelText('Host Name or IP address')).toHaveValue('192.168.1.1');
    const portInput = screen.getByLabelText('Port');
    expect(portInput).toHaveValue('22');
    expect(portInput).toHaveClass('w-full');
    expect(portInput.closest('label')).toHaveClass('min-w-0');
    expect(screen.getByLabelText('Username')).toHaveValue('admin');

    fireEvent.click(screen.getByRole('button', { name: 'Open SSH session' }));

    expect(term.setInput).toHaveBeenCalledWith('ssh admin@192.168.1.1');
  });

  it('opens IPv6 configuration from the desktop and keeps IPv6 fields visible', () => {
    renderPanel({
      activeDeviceId: 'PC-A',
      openDeviceIds: ['PC-A'],
      deviceKind: () => 'pc',
      pcNetwork: () => ({
        mode: 'static',
        ip: '192.168.1.10',
        mask: '255.255.255.0',
        gateway: '192.168.1.1',
        ipv6: '2001:db8:acad:1::10/64',
        gateway6: '2001:db8:acad:1::1',
      }),
      onPcNetworkApply: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: 'IPv6 Configuration' }));

    expect(screen.getByRole('tab', { name: 'Network Adapter' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('IPv6 Configuration')).toBeInTheDocument();
    expect(screen.queryByText('IPv4 Configuration')).toBeNull();
    expect(screen.getByLabelText('IPv6 address / prefix')).toHaveValue('2001:db8:acad:1::10/64');
    expect(screen.getByLabelText('IPv6 default gateway')).toHaveValue('2001:db8:acad:1::1');
  });

  it('renders IPv4 address, subnet mask, and default gateway as octet inputs', () => {
    renderPanel({
      activeDeviceId: 'PC-A',
      openDeviceIds: ['PC-A'],
      deviceKind: () => 'pc',
      pcNetwork: () => ({
        mode: 'static',
        ip: '192.168.1.10',
        mask: '255.255.255.0',
        gateway: '192.168.1.1',
        ipv6: null,
        gateway6: null,
      }),
      onPcNetworkApply: vi.fn(),
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Network Adapter' }));

    expect(screen.getByLabelText('IPv4 address octet 1')).toHaveValue('192');
    expect(screen.getByLabelText('IPv4 address octet 4')).toHaveValue('10');
    expect(screen.getByLabelText('Subnet mask octet 1')).toHaveValue('255');
    expect(screen.getByLabelText('Subnet mask octet 4')).toHaveValue('0');
    expect(screen.getByLabelText('Default gateway octet 1')).toHaveValue('192');
    expect(screen.getByLabelText('Default gateway octet 4')).toHaveValue('1');
    expect(screen.queryByLabelText('IPv4 address')).toBeNull();
  });

  it('renders preferred DNS server as IPv4 octet inputs and submits it with adapter settings', () => {
    const onPcNetworkApply = vi.fn();
    renderPanel({
      activeDeviceId: 'PC-A',
      openDeviceIds: ['PC-A'],
      deviceKind: () => 'pc',
      pcNetwork: () => ({
        mode: 'static',
        ip: '10.10.10.50',
        mask: '255.255.255.0',
        gateway: '10.10.10.1',
        dnsServers: ['10.10.10.53'],
        ipv6: null,
        gateway6: null,
      }),
      onPcNetworkApply,
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Network Adapter' }));

    expect(screen.getByLabelText('Preferred DNS server octet 1')).toHaveValue('10');
    expect(screen.getByLabelText('Preferred DNS server octet 4')).toHaveValue('53');
    fireEvent.change(screen.getByLabelText('Preferred DNS server octet 4'), { target: { value: '54' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply network adapter settings' }));

    expect(onPcNetworkApply).toHaveBeenCalledWith('PC-A', expect.objectContaining({
      dnsServers: ['10.10.10.54'],
    }));
  });

  it('shows effective APIPA addressing when DHCP is selected without a lease', () => {
    renderPanel({
      activeDeviceId: 'PC-A',
      openDeviceIds: ['PC-A'],
      deviceKind: () => 'pc',
      pcNetwork: () => ({
        mode: 'dhcp',
        ip: null,
        mask: null,
        gateway: null,
        dnsServers: [],
        effectiveIp: '169.254.0.42',
        effectiveMask: '255.255.0.0',
        effectiveGateway: null,
        effectiveSource: 'apipa',
        ipv6: null,
        gateway6: null,
      }),
      onPcNetworkApply: vi.fn(),
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Network Adapter' }));

    expect(screen.getByText('Current effective IPv4')).toBeInTheDocument();
    expect(screen.getByText('169.254.0.42')).toBeInTheDocument();
    expect(screen.getByText('255.255.0.0')).toBeInTheDocument();
    expect(screen.getByText('APIPA fallback')).toBeInTheDocument();
    expect(screen.getByText(/No DHCP lease was received/)).toBeInTheDocument();
  });

  it('submits PC network adapter GUI changes and shows applied feedback', () => {
    const onPcNetworkApply = vi.fn();
    renderPanel({
      activeDeviceId: 'PC-A',
      openDeviceIds: ['PC-A'],
      deviceKind: () => 'pc',
      pcNetwork: () => ({ mode: 'dhcp', ip: null, mask: null, gateway: null, ipv6: null, gateway6: null }),
      onPcNetworkApply,
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Network Adapter' }));
    expect(screen.getByText('TCP/IP Properties')).toBeInTheDocument();
    expect(screen.getByText('DHCP is selected. Static fields are preserved in the form but ignored until static mode is applied.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Use static addressing'));
    fireEvent.change(screen.getByLabelText('IPv4 address octet 1'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('IPv4 address octet 2'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('IPv4 address octet 3'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('IPv4 address octet 4'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Subnet mask octet 1'), { target: { value: '255' } });
    fireEvent.change(screen.getByLabelText('Subnet mask octet 2'), { target: { value: '255' } });
    fireEvent.change(screen.getByLabelText('Subnet mask octet 3'), { target: { value: '255' } });
    fireEvent.change(screen.getByLabelText('Subnet mask octet 4'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Default gateway octet 1'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Default gateway octet 2'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Default gateway octet 3'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Default gateway octet 4'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply network adapter settings' }));

    expect(onPcNetworkApply).toHaveBeenCalledWith('PC-A', {
      mode: 'static',
      ip: '10.10.10.50',
      mask: '255.255.255.0',
      gateway: '10.10.10.1',
      ipv6: null,
      gateway6: null,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Settings applied to PC-A');
  });

  it('renders one tab per open device id with its platform label', () => {
    renderPanel({
      openDeviceIds: ['R1', 'PC-A'],
      activeDeviceId: 'R1',
      platformLabel: (id) => (id === 'R1' ? 'ISR4321' : 'Workstation'),
    });
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('PC-A')).toBeInTheDocument();
    expect(screen.getByText('ISR4321')).toBeInTheDocument();
    expect(screen.getByText('Workstation')).toBeInTheDocument();
  });

  it('marks the active tab as selected and the others as not selected', () => {
    const { container } = renderPanel({
      openDeviceIds: ['R1', 'PC-A'],
      activeDeviceId: 'PC-A',
    });
    const r1 = container.querySelector('[data-tab-device="R1"]') as HTMLElement;
    const pcA = container.querySelector('[data-tab-device="PC-A"]') as HTMLElement;
    expect(r1.getAttribute('data-tab-active')).toBe('false');
    expect(pcA.getAttribute('data-tab-active')).toBe('true');
  });

  it('clicking a non-active tab calls onSelectDevice with that id', () => {
    const { onSelectDevice } = renderPanel({
      openDeviceIds: ['R1', 'PC-A'],
      activeDeviceId: 'R1',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to PC-A' }));
    expect(onSelectDevice).toHaveBeenCalledWith('PC-A');
  });

  it('clicking a tab × calls onCloseDevice for that id, not onCloseAll', () => {
    const { onCloseDevice, onCloseAll } = renderPanel({
      openDeviceIds: ['R1', 'PC-A'],
      activeDeviceId: 'R1',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close PC-A tab' }));
    expect(onCloseDevice).toHaveBeenCalledWith('PC-A');
    expect(onCloseAll).not.toHaveBeenCalled();
  });

  it('header close-all button calls onCloseAll', () => {
    const { onCloseAll } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Close all terminals' }));
    expect(onCloseAll).toHaveBeenCalledTimes(1);
  });

  it('minimize collapses the body — the terminal input disappears', () => {
    renderPanel();
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    expect(screen.queryByLabelText('Terminal input')).toBeNull();
  });

  it('restore (after minimize) brings the body back', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore terminal' }));
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
  });

  it('un-minimizes when the parent changes activeDeviceId (topology re-click)', () => {
    const { rerender } = renderPanel({
      openDeviceIds: ['R1', 'PC-A'],
      activeDeviceId: 'R1',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    expect(screen.queryByLabelText('Terminal input')).toBeNull();
    rerender(
      <FloatingTerminalPanel
        openDeviceIds={['R1', 'PC-A']}
        activeDeviceId="PC-A"
        forDevice={() => stubTerm('PC-A$')}
        onSelectDevice={vi.fn()}
        onCloseDevice={vi.fn()}
        onCloseAll={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
  });

  it('hides entirely when openDeviceIds is empty (no dialog rendered)', () => {
    const { container } = renderPanel({ openDeviceIds: [] });
    expect(container.querySelector('[data-floating-terminal-panel]')).toBeNull();
  });

  it('persists local state across hide/show — un-minimizes when re-opened', () => {
    const { rerender, container } = renderPanel({
      openDeviceIds: ['R1'],
      activeDeviceId: 'R1',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    expect(screen.queryByLabelText('Terminal input')).toBeNull();
    // Close-all path: parent empties openDeviceIds — panel hides.
    rerender(
      <FloatingTerminalPanel
        openDeviceIds={[]}
        activeDeviceId="R1"
        forDevice={() => stubTerm()}
        onSelectDevice={vi.fn()}
        onCloseDevice={vi.fn()}
        onCloseAll={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-floating-terminal-panel]')).toBeNull();
    // Topology re-click — openDeviceIds repopulates. Panel returns un-minimized
    // because the activeDeviceId-change effect fires on the re-open.
    rerender(
      <FloatingTerminalPanel
        openDeviceIds={['R1']}
        activeDeviceId="R1"
        forDevice={() => stubTerm()}
        onSelectDevice={vi.fn()}
        onCloseDevice={vi.fn()}
        onCloseAll={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
  });

  it('renders all three resize handles when not minimized', () => {
    const { container } = renderPanel();
    expect(
      container.querySelector('[data-floating-terminal-resize="right"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-floating-terminal-resize="bottom"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-floating-terminal-resize="corner"]'),
    ).not.toBeNull();
  });

  it('hides resize handles when minimized (no body, nothing to resize against)', () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    expect(
      container.querySelector('[data-floating-terminal-resize="right"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-floating-terminal-resize="bottom"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-floating-terminal-resize="corner"]'),
    ).toBeNull();
  });

  it('opens at a larger default size for readable command output and PC workbench controls', () => {
    const { container } = renderPanel();
    const panel = container.querySelector(
      '[data-floating-terminal-panel]',
    ) as HTMLElement;
    // The default terminal window should feel closer to a real lab workspace:
    // wide enough for 80-column IOS tables plus breathing room, and tall enough
    // for the PC workbench without cramped controls on normal laptop displays.
    expect(panel.style.width).toBe('900px');
    expect(panel.style.height).toBe('620px');
  });

  it('minimized snap-bar uses 320px width and docks bottom-center via CSS transform', () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    const panel = container.querySelector(
      '[data-floating-terminal-panel]',
    ) as HTMLElement;
    expect(panel.getAttribute('data-floating-terminal-minimized')).toBe('true');
    expect(panel.style.width).toBe('320px');
    expect(panel.style.left).toBe('50%');
    expect(panel.style.transform).toContain('translateX(-50%)');
    expect(panel.style.bottom).toBe('0px');
  });

  it('minimized snap-bar shows "Terminal — N devices" with the open tab count', () => {
    renderPanel({ openDeviceIds: ['R1', 'PC-A', 'PC-B'], activeDeviceId: 'R1' });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    expect(screen.getByText('Terminal — 3 devices')).toBeInTheDocument();
  });

  it('minimized snap-bar uses singular "device" when only one tab is open', () => {
    renderPanel({ openDeviceIds: ['R1'], activeDeviceId: 'R1' });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    expect(screen.getByText('Terminal — 1 device')).toBeInTheDocument();
  });

  it('clicking anywhere on the minimized snap-bar restores the panel', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    expect(screen.queryByLabelText('Terminal input')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore terminal panel' }));
    expect(screen.getByLabelText('Terminal input')).toBeInTheDocument();
  });

  it('clicking close-all on the minimized snap-bar does NOT restore the panel', () => {
    const { onCloseAll } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close all terminals' }));
    // The click should bubble to onCloseAll only — the snap-bar's restore
    // handler must not fire when an inner button is the click target.
    expect(onCloseAll).toHaveBeenCalledTimes(1);
    // Panel is still in minimized state in our test (the parent would now
    // empty openDeviceIds and hide it; here we assert local state).
    const minimizeBtn = screen.queryByRole('button', { name: 'Minimize terminal' });
    expect(minimizeBtn).toBeNull();
    expect(screen.getByRole('button', { name: 'Restore terminal' })).toBeInTheDocument();
  });

  it('restore returns the panel to its prior position and size (state preserved)', () => {
    const { container } = renderPanel();
    const panel = container.querySelector(
      '[data-floating-terminal-panel]',
    ) as HTMLElement;
    const beforeLeft = panel.style.left;
    const beforeTop = panel.style.top;
    const beforeWidth = panel.style.width;
    const beforeHeight = panel.style.height;

    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore terminal' }));

    expect(panel.style.left).toBe(beforeLeft);
    expect(panel.style.top).toBe(beforeTop);
    expect(panel.style.width).toBe(beforeWidth);
    expect(panel.style.height).toBe(beforeHeight);
  });

  it('renders the Terminal for whichever device is activeDeviceId', () => {
    const forDevice = vi.fn((id: string) =>
      id === 'R1' ? stubTerm('R1>') : stubTerm('PC-A$'),
    );
    renderPanel({
      openDeviceIds: ['R1', 'PC-A'],
      activeDeviceId: 'PC-A',
      forDevice,
    });
    // forDevice gets called with the active id at render time.
    expect(forDevice).toHaveBeenCalledWith('PC-A');
  });
});

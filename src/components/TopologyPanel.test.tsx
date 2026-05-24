import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TopologyPanel, type DeviceTopologyView } from './TopologyPanel';

function deviceR1(): DeviceTopologyView {
  return {
    id: 'R1',
    kind: 'router',
    hostname: 'R1',
    platform: 'ISR4321',
    interfaces: [
      { id: 'Gi0/0', name: 'GigabitEthernet0/0', status: 'up', ip: '192.168.1.1', mask: '255.255.255.0' },
      { id: 'Gi0/1', name: 'GigabitEthernet0/1', status: 'no-ip', ip: null, mask: null },
      { id: 'Gi0/2', name: 'GigabitEthernet0/2', status: 'admin-down', ip: null, mask: null },
    ],
  };
}

function deviceR2(): DeviceTopologyView {
  return {
    id: 'R2',
    kind: 'router',
    hostname: 'R2',
    platform: 'ISR4321',
    interfaces: [{ id: 'Gi0/0', name: 'GigabitEthernet0/0', status: 'admin-down', ip: null, mask: null }],
  };
}

/** Reusable two-router fixture for link/LED assertions — R1.Gi0/0 starts UP
 *  with an IP, R2.Gi0/0 is admin-down. Flip R2's status to drive LED tests. */
function twoRoutersWithLink(opts: { r2Up: boolean }) {
  const r1: DeviceTopologyView = {
    id: 'R1',
    kind: 'router',
    hostname: 'R1',
    platform: 'ISR4321',
    interfaces: [
      { id: 'Gi0/0', name: 'GigabitEthernet0/0', status: 'up', ip: '192.168.12.1', mask: '255.255.255.252' },
    ],
  };
  const r2: DeviceTopologyView = {
    id: 'R2',
    kind: 'router',
    hostname: 'R2',
    platform: 'ISR4321',
    interfaces: [
      {
        id: 'Gi0/0',
        name: 'GigabitEthernet0/0',
        status: opts.r2Up ? 'up' : 'admin-down',
        ip: opts.r2Up ? '192.168.12.2' : null,
        mask: opts.r2Up ? '255.255.255.252' : null,
      },
    ],
  };
  return { r1, r2 };
}

describe('TopologyPanel', () => {
  it('renders every device by hostname', () => {
    render(
      <TopologyPanel
        devices={[deviceR1(), deviceR2()]}
        activeDeviceId="R1"
      />,
    );
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('R2')).toBeInTheDocument();
  });

  it('marks the active device with aria-pressed and leaves others not pressed', () => {
    render(
      <TopologyPanel devices={[deviceR1(), deviceR2()]} activeDeviceId="R1" />,
    );
    // React Flow wraps custom nodes in role="group" containers; the chassis
    // buttons sit inside. Find them via aria-label rather than role.
    const r1 = screen.getByLabelText('Console for R1');
    const r2 = screen.getByLabelText('Console for R2');
    expect(r1).toHaveAttribute('aria-pressed', 'true');
    expect(r2).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the active prompt only on the active device', () => {
    render(
      <TopologyPanel
        devices={[deviceR1(), deviceR2()]}
        activeDeviceId="R1"
        activePrompt="R1(config-if)#"
      />,
    );
    expect(screen.getByText('R1(config-if)#')).toBeInTheDocument();
  });

  it('renders interface labels and reflects status via the title tooltip', () => {
    render(<TopologyPanel devices={[deviceR1()]} activeDeviceId="R1" />);
    expect(screen.getByText('Gi0/0')).toBeInTheDocument();
    expect(screen.getByText('Gi0/1')).toBeInTheDocument();
    expect(screen.getByText('Gi0/2')).toBeInTheDocument();
    const upPort = screen.getByTitle('GigabitEthernet0/0 — up');
    const noIpPort = screen.getByTitle('GigabitEthernet0/1 — admin up, no IP');
    const downPort = screen.getByTitle('GigabitEthernet0/2 — administratively down');
    expect(upPort).toBeInTheDocument();
    expect(noIpPort).toBeInTheDocument();
    expect(downPort).toBeInTheDocument();
  });

  it('calls onSelectDevice with the clicked device id', () => {
    const onSelect = vi.fn();
    render(
      <TopologyPanel
        devices={[deviceR1(), deviceR2()]}
        activeDeviceId="R1"
        onSelectDevice={onSelect}
      />,
    );
    fireEvent.click(screen.getByLabelText('Console for R2'));
    expect(onSelect).toHaveBeenCalledWith('R2');
  });

  it('renders an edges container when the lab has links', () => {
    // jsdom can't measure node positions so React Flow's edge geometry
    // calculation is partial; verify the edges container is present (the
    // detailed rendering is verified end-to-end in the browser).
    const { container } = render(
      <TopologyPanel
        devices={[deviceR1(), deviceR2()]}
        activeDeviceId="R1"
        links={[
          { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
        ]}
      />,
    );
    expect(container.querySelector('.react-flow__edges')).not.toBeNull();
  });

  it('renders an N=1 topology with no edges (free-lab path)', () => {
    const { container } = render(
      <TopologyPanel devices={[deviceR1()]} activeDeviceId="R1" />,
    );
    expect(screen.getByLabelText('Console for R1')).toBeInTheDocument();
    const edges = container.querySelectorAll('.react-flow__edge');
    expect(edges.length).toBe(0);
  });

  // ---- A1.5: endpoint-aware links + port-state LEDs ---------------------

  it('emits a port LED at each link endpoint, anchored by deviceId:iface', () => {
    const { r1, r2 } = twoRoutersWithLink({ r2Up: true });
    const { container } = render(
      <TopologyPanel
        devices={[r1, r2]}
        activeDeviceId="R1"
        links={[
          { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
        ]}
      />,
    );
    expect(container.querySelector('[data-led-endpoint="R1:Gi0/0"]')).not.toBeNull();
    expect(container.querySelector('[data-led-endpoint="R2:Gi0/0"]')).not.toBeNull();
  });

  it('both LEDs green when both endpoints are status: up (link up)', () => {
    const { r1, r2 } = twoRoutersWithLink({ r2Up: true });
    const { container } = render(
      <TopologyPanel
        devices={[r1, r2]}
        activeDeviceId="R1"
        links={[
          { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
        ]}
      />,
    );
    expect(container.querySelector('[data-led-endpoint="R1:Gi0/0"]'))
      .toHaveAttribute('data-led-up', 'true');
    expect(container.querySelector('[data-led-endpoint="R2:Gi0/0"]'))
      .toHaveAttribute('data-led-up', 'true');
  });

  it('flipping ONE endpoint to admin-down flips BOTH LEDs to down (Packet-Tracer either-end-down rule)', () => {
    // Up state baseline.
    const up = twoRoutersWithLink({ r2Up: true });
    const { container, rerender } = render(
      <TopologyPanel
        devices={[up.r1, up.r2]}
        activeDeviceId="R1"
        links={[
          { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
        ]}
      />,
    );
    expect(container.querySelector('[data-led-endpoint="R1:Gi0/0"]'))
      .toHaveAttribute('data-led-up', 'true');
    expect(container.querySelector('[data-led-endpoint="R2:Gi0/0"]'))
      .toHaveAttribute('data-led-up', 'true');

    // Flip R2 to admin-down — both ends must report down.
    const down = twoRoutersWithLink({ r2Up: false });
    rerender(
      <TopologyPanel
        devices={[down.r1, down.r2]}
        activeDeviceId="R1"
        links={[
          { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
        ]}
      />,
    );
    expect(container.querySelector('[data-led-endpoint="R1:Gi0/0"]'))
      .toHaveAttribute('data-led-up', 'false');
    expect(container.querySelector('[data-led-endpoint="R2:Gi0/0"]'))
      .toHaveAttribute('data-led-up', 'false');
  });

  it('renders the mid-cable network CIDR derived from endpoint IP/mask', () => {
    const { r1, r2 } = twoRoutersWithLink({ r2Up: true });
    const { container } = render(
      <TopologyPanel
        devices={[r1, r2]}
        activeDeviceId="R1"
        links={[
          { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
        ]}
      />,
    );
    expect(container.querySelector('[data-link-network="192.168.12.0/30"]')).not.toBeNull();
  });

  it('omits the network label when neither endpoint has an IP+mask', () => {
    const a: DeviceTopologyView = {
      id: 'A',
      kind: 'router',
      hostname: 'A',
      platform: 'ISR4321',
      interfaces: [
        { id: 'Gi0/0', name: 'GigabitEthernet0/0', status: 'no-ip', ip: null, mask: null },
      ],
    };
    const b: DeviceTopologyView = {
      id: 'B',
      kind: 'router',
      hostname: 'B',
      platform: 'ISR4321',
      interfaces: [
        { id: 'Gi0/0', name: 'GigabitEthernet0/0', status: 'no-ip', ip: null, mask: null },
      ],
    };
    const { container } = render(
      <TopologyPanel
        devices={[a, b]}
        activeDeviceId="A"
        links={[{ a: { deviceId: 'A', iface: 'Gi0/0' }, b: { deviceId: 'B', iface: 'Gi0/0' } }]}
      />,
    );
    expect(container.querySelector('[data-link-network]')).toBeNull();
  });

  it('a zero-link lab emits no LEDs and no network labels (free-lab invariant)', () => {
    const { container } = render(
      <TopologyPanel devices={[deviceR1()]} activeDeviceId="R1" />,
    );
    expect(container.querySelector('[data-led-endpoint]')).toBeNull();
    expect(container.querySelector('[data-link-network]')).toBeNull();
    expect(container.querySelector('[data-link-key]')).toBeNull();
  });

  // A1.6: iface labels and CIDR must occupy DIFFERENT vertical slots.
  // Regression test for the bug where both were anchored above the cable at
  // the same y and visually stacked on top of each other on short links.
  it('iface labels and CIDR label occupy separate vertical slots (iface above, CIDR below)', () => {
    const { r1, r2 } = twoRoutersWithLink({ r2Up: true });
    const { container } = render(
      <TopologyPanel
        devices={[r1, r2]}
        activeDeviceId="R1"
        links={[
          { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
        ]}
      />,
    );

    const ifaceLeft = container.querySelector('[data-iface-label="R1:Gi0/0"]');
    const ifaceRight = container.querySelector('[data-iface-label="R2:Gi0/0"]');
    const cidr = container.querySelector('[data-link-network="192.168.12.0/30"]');
    expect(ifaceLeft).not.toBeNull();
    expect(ifaceRight).not.toBeNull();
    expect(cidr).not.toBeNull();

    const yOf = (el: Element | null) => Number(el!.getAttribute('y'));
    const ifaceLeftY = yOf(ifaceLeft);
    const ifaceRightY = yOf(ifaceRight);
    const cidrY = yOf(cidr);

    // Both iface labels share the SAME y (they're on the same horizontal slot
    // above the cable, just anchored at opposite ends).
    expect(ifaceLeftY).toBe(ifaceRightY);
    // The CIDR is BELOW the cable; iface is ABOVE — so CIDR y > iface y. Gap
    // must be wide enough that the 9px font on each side doesn't visually
    // touch. Both glyphs ~9px tall, so >= ~20px is the floor for "clearly
    // separate slots."
    expect(cidrY).toBeGreaterThan(ifaceLeftY);
    expect(cidrY - ifaceLeftY).toBeGreaterThanOrEqual(20);
  });
});

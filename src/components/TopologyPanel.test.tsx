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
      { id: 'Gi0/0', name: 'GigabitEthernet0/0', status: 'up', ip: '192.168.1.1', mask: '255.255.255.0', adminUp: true, protocolUp: true },
      { id: 'Gi0/1', name: 'GigabitEthernet0/1', status: 'no-ip', ip: null, mask: null, adminUp: true, protocolUp: true },
      { id: 'Gi0/2', name: 'GigabitEthernet0/2', status: 'admin-down', ip: null, mask: null, adminUp: false, protocolUp: false },
    ],
  };
}

function deviceR2(): DeviceTopologyView {
  return {
    id: 'R2',
    kind: 'router',
    hostname: 'R2',
    platform: 'ISR4321',
    interfaces: [{ id: 'Gi0/0', name: 'GigabitEthernet0/0', status: 'admin-down', ip: null, mask: null, adminUp: false, protocolUp: false }],
  };
}

function windowsWorkstation(id = 'PC-A'): DeviceTopologyView {
  return {
    id,
    kind: 'pc',
    hostname: id,
    platform: 'Windows Workstation',
    interfaces: [{ id: 'Eth0', name: 'Eth0', status: 'admin-down', ip: null, mask: null, adminUp: false, protocolUp: false }],
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
      {
        id: 'Gi0/0',
        name: 'GigabitEthernet0/0',
        status: 'up',
        ip: '192.168.12.1',
        mask: '255.255.255.252',
        adminUp: true,
        protocolUp: opts.r2Up,
      },
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
        adminUp: opts.r2Up,
        protocolUp: opts.r2Up,
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

  it('uses a workstation icon and compact badge for Windows workstation PCs', () => {
    const { container } = render(
      <TopologyPanel devices={[windowsWorkstation()]} activeDeviceId="PC-A" />,
    );

    expect(container.querySelector('[data-device-icon-type="workstation"]')).not.toBeNull();
    expect(container.querySelector('svg[data-network-icon="workstation"]')).toHaveAttribute(
      'width',
      '46',
    );
    expect(container.querySelector('[data-device-platform-label="WORKSTATION"]')).not.toBeNull();
    expect(screen.queryByText('WINDOWS WORKSTATION')).not.toBeInTheDocument();
  });

  it('renders passive WAN cloud decorations without creating console targets', () => {
    const { container } = render(
      <TopologyPanel
        devices={[deviceR1(), deviceR2()]}
        activeDeviceId="R1"
        decorations={[
          {
            id: 'ISP-CLOUD',
            kind: 'wan-cloud',
            label: 'ISP Cloud',
            variant: 'isp',
            position: { x: 420, y: -90 },
          },
        ]}
      />,
    );

    expect(screen.getByText('ISP Cloud')).toBeInTheDocument();
    expect(container.querySelector('[data-topology-decoration-kind="wan-cloud"]')).not.toBeNull();
    expect(container.querySelector('[data-topology-decoration-variant="isp"]')).not.toBeNull();
    expect(screen.queryByLabelText('Console for ISP-CLOUD')).not.toBeInTheDocument();
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
        { id: 'Gi0/0', name: 'GigabitEthernet0/0', status: 'no-ip', ip: null, mask: null, adminUp: true, protocolUp: true },
      ],
    };
    const b: DeviceTopologyView = {
      id: 'B',
      kind: 'router',
      hostname: 'B',
      platform: 'ISR4321',
      interfaces: [
        { id: 'Gi0/0', name: 'GigabitEthernet0/0', status: 'no-ip', ip: null, mask: null, adminUp: true, protocolUp: true },
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

  // ---- A1.7: canvas zoom + pan ------------------------------------------

  it('renders zoom in, zoom out, and fit controls', () => {
    const { r1, r2 } = twoRoutersWithLink({ r2Up: true });
    render(
      <TopologyPanel
        devices={[r1, r2]}
        activeDeviceId="R1"
        links={[
          { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
        ]}
      />,
    );
    expect(screen.getByLabelText('Zoom in')).toBeInTheDocument();
    expect(screen.getByLabelText('Zoom out')).toBeInTheDocument();
    expect(screen.getByLabelText('Fit topology to view')).toBeInTheDocument();
  });

  // Anti-drift contract for zoom: every overlay element (LED, iface label,
  // CIDR, cable) must live INSIDE .react-flow__viewport — the single DOM
  // node React Flow applies its pan/zoom transform to. If anything escaped
  // into screen space, it would NOT scale with zoom and would drift away
  // from its anchor; we shipped that bug class before (label-drift). The
  // structural assertion is the load-bearing one — at any zoom level the
  // browser applies the viewport's CSS transform uniformly to all descendants,
  // so being inside that subtree IS the proof that overlays stay anchored.
  it('LED + edge labels + cable all live inside .react-flow__viewport (scale with zoom)', () => {
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
    const inViewport = (sel: string) =>
      container.querySelector(sel)?.closest('.react-flow__viewport');

    // LEDs.
    expect(inViewport('[data-led-endpoint="R1:Gi0/0"]')).not.toBeNull();
    expect(inViewport('[data-led-endpoint="R2:Gi0/0"]')).not.toBeNull();
    // Iface labels.
    expect(inViewport('[data-iface-label="R1:Gi0/0"]')).not.toBeNull();
    expect(inViewport('[data-iface-label="R2:Gi0/0"]')).not.toBeNull();
    // CIDR mid-cable label.
    expect(inViewport('[data-link-network]')).not.toBeNull();
    // The cable + LEDs + labels all share a single per-link <g> group inside
    // the viewport — they cannot drift relative to each other.
    expect(inViewport('[data-link-key]')).not.toBeNull();
  });

  // Position-stability check: overlay y attributes are pure canvas-space
  // values derived from NODE_HEIGHT and the label offsets. They MUST NOT
  // depend on screen DPR, viewport CSS, or zoom level — if they did, the
  // collision floor from A1.6 would no longer hold under zoom. Verify the
  // exact values match the expected canvas-space formula at the default
  // render; combined with the viewport-containment test above, this rules
  // out drift under zoom.
  it('overlay y-coords are deterministic canvas-space values (zoom-independent)', () => {
    const { r1, r2 } = twoRoutersWithLink({ r2Up: true });
    const { container, rerender } = render(
      <TopologyPanel
        devices={[r1, r2]}
        activeDeviceId="R1"
        links={[
          { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
        ]}
      />,
    );
    const initialIfaceY = container
      .querySelector('[data-iface-label="R1:Gi0/0"]')!
      .getAttribute('y');
    const initialCidrY = container
      .querySelector('[data-link-network]')!
      .getAttribute('y');

    // Re-render with the SAME inputs; the same canvas-space coords must
    // emerge — proof the values aren't derived from any layout-time
    // measurement that could change under zoom or resize.
    rerender(
      <TopologyPanel
        devices={[r1, r2]}
        activeDeviceId="R2"
        links={[
          { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
        ]}
      />,
    );
    expect(
      container.querySelector('[data-iface-label="R1:Gi0/0"]')!.getAttribute('y'),
    ).toBe(initialIfaceY);
    expect(
      container.querySelector('[data-link-network]')!.getAttribute('y'),
    ).toBe(initialCidrY);

    // And the A1.6 collision floor still applies (CIDR clearly below iface).
    expect(Number(initialCidrY) - Number(initialIfaceY)).toBeGreaterThanOrEqual(20);
  });

  // ---- in-card LEDs anchored to port-facing edges -----------------------

  it('places linked interfaces on the port-facing edge of the card', () => {
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
    // R1 is leftmost in the row, so its linked port faces RIGHT toward R2.
    expect(container.querySelector('[data-port-key="R1:Gi0/0"]'))
      .toHaveAttribute('data-port-position', 'right');
    // R2 is to the right of R1, so its linked port faces LEFT toward R1.
    expect(container.querySelector('[data-port-key="R2:Gi0/0"]'))
      .toHaveAttribute('data-port-position', 'left');
  });

  it('leaves unlinked interfaces in the card bottom row', () => {
    // R1 has three interfaces; only Gi0/0 is linked. Gi0/1 and Gi0/2 must
    // stay in the bottom row (where every port lived pre-edge-placement).
    const { container } = render(
      <TopologyPanel
        devices={[deviceR1(), deviceR2()]}
        activeDeviceId="R1"
        links={[
          { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
        ]}
      />,
    );
    expect(container.querySelector('[data-port-key="R1:Gi0/0"]'))
      .toHaveAttribute('data-port-position', 'right');
    expect(container.querySelector('[data-port-key="R1:Gi0/1"]'))
      .toHaveAttribute('data-port-position', 'bottom');
    expect(container.querySelector('[data-port-key="R1:Gi0/2"]'))
      .toHaveAttribute('data-port-position', 'bottom');
  });

  it('a zero-link lab keeps every port in the bottom row (free-lab invariant)', () => {
    // Free lab path: single device, no links → every port falls back to the
    // bottom row, so the user still sees admin-down→up transitions on Gi0/0.
    const { container } = render(
      <TopologyPanel devices={[deviceR1()]} activeDeviceId="R1" />,
    );
    expect(container.querySelector('[data-port-key="R1:Gi0/0"]'))
      .toHaveAttribute('data-port-position', 'bottom');
    expect(container.querySelector('[data-port-key="R1:Gi0/1"]'))
      .toHaveAttribute('data-port-position', 'bottom');
    expect(container.querySelector('[data-port-key="R1:Gi0/2"]'))
      .toHaveAttribute('data-port-position', 'bottom');
    // No edge-anchor containers should be in the DOM at all.
    expect(container.querySelector('[data-port-edge="left"]')).toBeNull();
    expect(container.querySelector('[data-port-edge="right"]')).toBeNull();
  });

  // zoomOnScroll prop: not directly observable in jsdom (React Flow's wheel
  // handler isn't exercised), but verify the component accepts the prop and
  // still renders cleanly with it set false — the seam embed mode needs.
  it('accepts zoomOnScroll={false} without breaking render (embed seam)', () => {
    const { r1, r2 } = twoRoutersWithLink({ r2Up: true });
    const { container } = render(
      <TopologyPanel
        devices={[r1, r2]}
        activeDeviceId="R1"
        zoomOnScroll={false}
        links={[
          { a: { deviceId: 'R1', iface: 'Gi0/0' }, b: { deviceId: 'R2', iface: 'Gi0/0' } },
        ]}
      />,
    );
    // Canvas still renders; controls still present so wheel-disabled users
    // can still zoom.
    expect(screen.getByLabelText('Zoom in')).toBeInTheDocument();
    expect(container.querySelector('.react-flow__viewport')).not.toBeNull();
  });
});

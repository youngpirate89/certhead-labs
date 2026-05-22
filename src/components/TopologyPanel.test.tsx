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
      { id: 'Gi0/0', name: 'GigabitEthernet0/0', status: 'up', ip: '192.168.1.1' },
      { id: 'Gi0/1', name: 'GigabitEthernet0/1', status: 'no-ip', ip: null },
      { id: 'Gi0/2', name: 'GigabitEthernet0/2', status: 'admin-down', ip: null },
    ],
  };
}

function deviceR2(): DeviceTopologyView {
  return {
    id: 'R2',
    kind: 'router',
    hostname: 'R2',
    platform: 'ISR4321',
    interfaces: [{ id: 'Gi0/0', name: 'GigabitEthernet0/0', status: 'admin-down', ip: null }],
  };
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
    const r1 = screen.getByRole('button', { name: /Console for R1/ });
    const r2 = screen.getByRole('button', { name: /Console for R2/ });
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
    fireEvent.click(screen.getByRole('button', { name: /Console for R2/ }));
    expect(onSelect).toHaveBeenCalledWith('R2');
  });
});

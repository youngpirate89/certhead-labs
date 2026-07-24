import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DeviceIcon, {
  AccessPointIcon,
  RouterIcon,
  ServerIcon,
  SwitchIcon,
  WanCloudIcon,
  WirelessClientIcon,
  WorkstationIcon,
} from './DeviceIcon';

const family = [
  ['router', RouterIcon],
  ['switch', SwitchIcon],
  ['workstation', WorkstationIcon],
  ['server', ServerIcon],
  ['access-point', AccessPointIcon],
  ['wireless-client', WirelessClientIcon],
  ['wan-cloud', WanCloudIcon],
] as const;

describe('network operations icon family', () => {
  it.each(family)('%s exposes the shared scalable SVG contract', (name, Icon) => {
    const { container } = render(<Icon size={46} color="rgb(12, 34, 56)" />);
    const svg = container.querySelector(`svg[data-network-icon="${name}"]`);

    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('viewBox', '0 0 48 48');
    expect(svg).toHaveAttribute('width', '46');
    expect(svg).toHaveAttribute('height', '46');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveStyle({ color: 'rgb(12, 34, 56)' });
  });

  it.each([
    ['router', 'router'],
    ['isr-4321', 'router'],
    ['isr-4331', 'router'],
    ['switch', 'switch'],
    ['ios-switch', 'switch'],
    ['catalyst-2960', 'switch'],
    ['C2960', 'switch'],
    ['server', 'server'],
    ['workstation', 'workstation'],
    ['Workstation', 'workstation'],
    ['pc', 'workstation'],
    ['host', 'workstation'],
    ['access-point', 'access-point'],
    ['wireless-client', 'wireless-client'],
    ['wan-cloud', 'wan-cloud'],
    ['unknown-device', 'router'],
  ])('dispatches %s to the %s artwork', (type, expected) => {
    const { container } = render(<DeviceIcon type={type} />);
    expect(container.querySelector(`svg[data-network-icon="${expected}"]`)).not.toBeNull();
  });

  it('uses dedicated AP and wireless-client artwork instead of device fallbacks', () => {
    const { container, rerender } = render(<DeviceIcon type="access-point" />);
    expect(container.querySelector('[data-network-icon="access-point"]')).not.toBeNull();
    expect(container.querySelector('[data-network-icon="router"]')).toBeNull();

    rerender(<DeviceIcon type="wireless-client" />);
    expect(container.querySelector('[data-network-icon="wireless-client"]')).not.toBeNull();
    expect(container.querySelector('[data-network-icon="workstation"]')).toBeNull();
  });
});

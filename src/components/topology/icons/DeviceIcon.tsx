import AccessPointIcon from './AccessPointIcon';
import RouterIcon from './RouterIcon';
import ServerIcon from './ServerIcon';
import SwitchIcon from './SwitchIcon';
import WanCloudIcon from './WanCloudIcon';
import WirelessClientIcon from './WirelessClientIcon';
import WorkstationIcon from './WorkstationIcon';

interface DeviceIconProps {
  type: string;
  size?: number;
  color?: string;
}

export default function DeviceIcon({
  type,
  size = 40,
  color = 'currentColor',
}: DeviceIconProps) {
  switch (type) {
    case 'router':
    case 'isr-4321':
    case 'isr-4331':
      return <RouterIcon size={size} color={color} />;
    case 'switch':
    case 'ios-switch':
    case 'catalyst-2960':
    case 'C2960':
      return <SwitchIcon size={size} color={color} />;
    case 'server':
      return <ServerIcon size={size} color={color} />;
    case 'workstation':
    case 'Workstation':
    case 'pc':
    case 'host':
      return <WorkstationIcon size={size} color={color} />;
    case 'access-point':
      return <AccessPointIcon size={size} color={color} />;
    case 'wireless-client':
      return <WirelessClientIcon size={size} color={color} />;
    case 'wan-cloud':
      return <WanCloudIcon size={size} color={color} />;
    default:
      return <RouterIcon size={size} color={color} />;
  }
}

export {
  AccessPointIcon,
  RouterIcon,
  ServerIcon,
  SwitchIcon,
  WanCloudIcon,
  WirelessClientIcon,
  WorkstationIcon,
};

import RouterIcon from "./RouterIcon";
import SwitchIcon from "./SwitchIcon";
import WorkstationIcon from "./WorkstationIcon";
import ServerIcon from "./ServerIcon";
import WanCloudIcon from "./WanCloudIcon";

interface DeviceIconProps {
  type: string;
  size?: number;
  color?: string;
}

export default function DeviceIcon({ type, size = 40, color = "currentColor" }: DeviceIconProps) {
  switch (type) {
    case "router":
    case "isr-4321":
    case "isr-4331":
      return <RouterIcon size={size} color={color} />;
    case "switch":
    case "ios-switch":
    case "catalyst-2960":
    case "C2960":
      return <SwitchIcon size={size} color={color} />;
    case "server":
      return <ServerIcon size={size} color={color} />;
    case "workstation":
    case "Workstation":
    case "pc":
    case "host":
      return <WorkstationIcon size={size} color={color} />;
    case "access-point":
      return <RouterIcon size={size} color={color} />;
    case "wireless-client":
      return <WorkstationIcon size={size} color={color} />;
    case "wan-cloud":
      return <WanCloudIcon size={size} color={color} />;
    default:
      return <RouterIcon size={size} color={color} />;
  }
}

export { RouterIcon, SwitchIcon, WorkstationIcon, ServerIcon, WanCloudIcon };

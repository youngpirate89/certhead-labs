interface SwitchIconProps {
  size?: number;
  color: string;
}

export default function SwitchIcon({ size = 40, color }: SwitchIconProps) {
  const ports = [14, 19.5, 25, 30.5, 36, 41.5];

  return (
    <svg
      data-network-icon="switch"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      color={color}
      style={{ color }}
      focusable="false"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="12" width="42" height="24" rx="3.5" fill="currentColor" opacity="0.1" />
      <rect x="3" y="14.5" width="42" height="21.5" rx="3.5" />
      <path d="M3.8 20h40.4" opacity="0.28" />
      <circle cx="7.5" cy="25" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="30" r="1.25" fill="currentColor" stroke="none" opacity="0.45" />
      <path d="M10 22.7v9" opacity="0.35" />
      {ports.map((x, index) => (
        <g key={x}>
          <rect
            x={x - 1.7}
            y={index % 2 === 0 ? 23 : 28}
            width="3.4"
            height="3.8"
            rx="0.55"
            fill="currentColor"
            fillOpacity="0.09"
          />
          <path d={`M${x - 0.8} ${index % 2 === 0 ? 24.2 : 29.2}h1.6`} opacity="0.75" />
          <circle
            cx={x}
            cy={index % 2 === 0 ? 21.5 : 33.1}
            r="0.65"
            fill="currentColor"
            stroke="none"
            opacity={index === 1 || index === 4 ? 1 : 0.35}
          />
        </g>
      ))}
      <path d="M7 36v2m34-2v2" />
    </svg>
  );
}

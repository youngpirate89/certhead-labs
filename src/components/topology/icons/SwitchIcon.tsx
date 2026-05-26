interface SwitchIconProps {
  size?: number;
  color: string;
}

export default function SwitchIcon({ size = 40, color }: SwitchIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      color={color}
      style={{ color }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="4"
        y="13"
        width="32"
        height="14"
        rx="3"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
      />
      <circle cx="10" cy="20" r="2" fill={color} />
      <circle cx="16" cy="20" r="2" fill={color} />
      <circle cx="22" cy="20" r="2" fill={color} />
      <circle cx="28" cy="20" r="2" fill={color} />
      <rect
        x="34"
        y="16"
        width="3"
        height="8"
        rx="1"
        fill={color}
        opacity="0.3"
      />
    </svg>
  );
}

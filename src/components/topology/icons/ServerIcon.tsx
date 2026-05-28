interface ServerIconProps {
  size?: number;
  color: string;
}

/** Stacked rack-unit server icon — two horizontal rectangles with drive LEDs
 *  on the left edge. Matches the existing icon family's 40×40 viewBox,
 *  1.5 stroke, and currentColor accent so a server node sits visually
 *  alongside routers/switches/workstations on the topology canvas. */
export default function ServerIcon({ size = 40, color }: ServerIconProps) {
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
      {/* Upper rack unit */}
      <rect
        x="6"
        y="9"
        width="28"
        height="10"
        rx="1.5"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
      />
      <circle cx="10" cy="14" r="1.2" fill={color} />
      <circle cx="14" cy="14" r="1.2" fill={color} />
      <line
        x1="22"
        y1="14"
        x2="30"
        y2="14"
        stroke={color}
        strokeWidth="1"
        opacity="0.5"
      />

      {/* Lower rack unit */}
      <rect
        x="6"
        y="21"
        width="28"
        height="10"
        rx="1.5"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
      />
      <circle cx="10" cy="26" r="1.2" fill={color} />
      <line
        x1="22"
        y1="26"
        x2="30"
        y2="26"
        stroke={color}
        strokeWidth="1"
        opacity="0.5"
      />
    </svg>
  );
}

interface WorkstationIconProps {
  size?: number;
  color: string;
}

export default function WorkstationIcon({ size = 40, color }: WorkstationIconProps) {
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
        x="7"
        y="5"
        width="26"
        height="20"
        rx="2"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
      />
      <rect
        x="9"
        y="7"
        width="22"
        height="16"
        rx="1"
        fill="#1e2533"
      />
      <line
        x1="20"
        y1="25"
        x2="20"
        y2="31"
        stroke={color}
        strokeWidth="1.5"
      />
      <line
        x1="13"
        y1="31"
        x2="27"
        y2="31"
        stroke={color}
        strokeWidth="1.5"
      />
    </svg>
  );
}

interface RouterIconProps {
  size?: number;
  color: string;
}

export default function RouterIcon({ size = 40, color }: RouterIconProps) {
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
      <circle
        cx="20"
        cy="20"
        r="10"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="20" cy="20" r="2" fill={color} />

      <line
        x1="20"
        y1="10"
        x2="20"
        y2="3"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <polygon points="20,1 17,5 23,5" fill={color} />

      <line
        x1="30"
        y1="20"
        x2="37"
        y2="20"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <polygon points="39,20 35,17 35,23" fill={color} />

      <line
        x1="20"
        y1="30"
        x2="20"
        y2="37"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <polygon points="20,39 17,35 23,35" fill={color} />

      <line
        x1="10"
        y1="20"
        x2="3"
        y2="20"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <polygon points="1,20 5,17 5,23" fill={color} />
    </svg>
  );
}

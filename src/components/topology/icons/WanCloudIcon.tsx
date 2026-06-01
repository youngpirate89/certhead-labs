interface WanCloudIconProps {
  size?: number;
  color: string;
}

export default function WanCloudIcon({ size = 40, color }: WanCloudIconProps) {
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
      <path
        d="M13.2 29.5h15.7c4 0 7.1-2.9 7.1-6.6 0-3.5-2.8-6.3-6.4-6.6C28.5 11.7 24.5 8.5 20 8.5c-5 0-9.2 3.7-9.8 8.5-3.6.9-6.2 3.8-6.2 7 0 3.1 2.4 5.5 5.6 5.5h3.6Z"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 23.3h16M15.5 19.5h12M17.5 26.9h8"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.75"
      />
      <circle cx="30.5" cy="23.3" r="1.5" fill={color} opacity="0.9" />
    </svg>
  );
}

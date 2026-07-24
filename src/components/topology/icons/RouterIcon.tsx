interface RouterIconProps {
  size?: number;
  color: string;
}

export default function RouterIcon({ size = 40, color }: RouterIconProps) {
  return (
    <svg
      data-network-icon="router"
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
      <rect x="4" y="13" width="40" height="23" rx="4" fill="currentColor" opacity="0.1" />
      <path d="M8 13.5h32l3.5 4H4.5l3.5-4Z" fill="currentColor" opacity="0.08" />
      <rect x="4" y="17.5" width="40" height="18.5" rx="3.5" />
      <path d="M8 31.5h32" opacity="0.35" />
      <circle cx="9" cy="23" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="13" cy="23" r="1.35" fill="currentColor" stroke="none" opacity="0.45" />
      <path d="M8.5 27h5" opacity="0.65" />
      <g fill="currentColor" fillOpacity="0.08">
        <rect x="19" y="22" width="5.5" height="5" rx="0.8" />
        <rect x="27" y="22" width="5.5" height="5" rx="0.8" />
        <rect x="35" y="22" width="5.5" height="5" rx="0.8" />
      </g>
      <path d="M20.5 24.5h2.5m5.5 0H31m5.5 0H39" opacity="0.8" />
      <path d="M18.5 32.2c3-3 8-3 11 0m-8.2 0c1.5-1.3 3.9-1.3 5.4 0" opacity="0.55" />
      <path d="M9 36v2m30-2v2" />
    </svg>
  );
}

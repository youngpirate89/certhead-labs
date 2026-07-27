interface WirelessClientIconProps {
  size?: number;
  color: string;
}

export default function WirelessClientIcon({ size = 40, color }: WirelessClientIconProps) {
  return (
    <svg
      data-network-icon="wireless-client"
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
      <rect x="8" y="7" width="32" height="25" rx="3" fill="currentColor" opacity="0.09" />
      <rect x="8" y="7" width="32" height="25" rx="3" />
      <rect x="11" y="10" width="26" height="18" rx="1.2" fill="currentColor" opacity="0.05" />
      <path d="M17 18.5c3.9-3.5 10.1-3.5 14 0" opacity="0.45" />
      <path d="M20 21.5c2.2-2 5.8-2 8 0" opacity="0.75" />
      <path d="M22.8 24.3c.7-.6 1.7-.6 2.4 0" />
      <circle cx="24" cy="25.5" r="1" fill="currentColor" stroke="none" />
      <path d="M8 32h32l4 6.5c.5.8-.1 1.5-1 1.5H5c-.9 0-1.5-.7-1-1.5L8 32Z" fill="currentColor" opacity="0.08" />
      <path d="M8 32h32l4 6.5c.5.8-.1 1.5-1 1.5H5c-.9 0-1.5-.7-1-1.5L8 32Z" />
      <path d="M20 35.5h8l1 2h-10l1-2Z" opacity="0.55" />
    </svg>
  );
}

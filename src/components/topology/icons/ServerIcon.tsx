interface ServerIconProps {
  size?: number;
  color: string;
}

export default function ServerIcon({ size = 40, color }: ServerIconProps) {
  return (
    <svg
      data-network-icon="server"
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
      <rect x="6" y="5" width="36" height="38" rx="3.5" fill="currentColor" opacity="0.08" />
      <rect x="6" y="5" width="36" height="38" rx="3.5" />
      <rect x="9" y="9" width="30" height="13" rx="2" fill="currentColor" opacity="0.06" />
      <rect x="9" y="26" width="30" height="13" rx="2" fill="currentColor" opacity="0.06" />
      <rect x="9" y="9" width="30" height="13" rx="2" />
      <rect x="9" y="26" width="30" height="13" rx="2" />
      <circle cx="13" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="13" r="1" fill="currentColor" stroke="none" opacity="0.4" />
      <circle cx="13" cy="30" r="1" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="30" r="1" fill="currentColor" stroke="none" opacity="0.4" />
      <path d="M12 18h8m-8 17h8" opacity="0.5" />
      <rect x="25" y="12" width="10" height="6" rx="1" />
      <rect x="25" y="29" width="10" height="6" rx="1" />
      <path d="M27.5 15h5m-5 17h5" opacity="0.55" />
      <path d="M6 24h36" opacity="0.45" />
    </svg>
  );
}

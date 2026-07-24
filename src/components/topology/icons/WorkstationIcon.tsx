interface WorkstationIconProps {
  size?: number;
  color: string;
}

export default function WorkstationIcon({ size = 40, color }: WorkstationIconProps) {
  return (
    <svg
      data-network-icon="workstation"
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
      <rect x="6" y="6" width="36" height="27" rx="3.2" fill="currentColor" opacity="0.09" />
      <rect x="6" y="6" width="36" height="27" rx="3.2" />
      <rect x="9" y="9" width="30" height="19" rx="1.5" fill="currentColor" opacity="0.06" />
      <path d="M9 28h30" opacity="0.4" />
      <circle cx="36.5" cy="30.5" r="0.8" fill="currentColor" stroke="none" />
      <path d="M14 23v-5l4-3 4 2.5 5-5 6 3" opacity="0.58" />
      <circle cx="14" cy="18" r="1" fill="currentColor" stroke="none" opacity="0.7" />
      <circle cx="22" cy="17.5" r="1" fill="currentColor" stroke="none" opacity="0.7" />
      <circle cx="27" cy="12.5" r="1" fill="currentColor" stroke="none" opacity="0.7" />
      <path d="M21 33v6m6-6v6M16 40h16" />
      <path d="M13 42h22" opacity="0.4" />
    </svg>
  );
}

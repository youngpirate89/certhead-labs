interface AccessPointIconProps {
  size?: number;
  color: string;
}

export default function AccessPointIcon({ size = 40, color }: AccessPointIconProps) {
  return (
    <svg
      data-network-icon="access-point"
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
      <path d="M12 15.5c6.6-6 17.4-6 24 0" opacity="0.42" />
      <path d="M16.5 19.5c4.1-3.7 10.9-3.7 15 0" opacity="0.68" />
      <path d="M21 23.2c1.7-1.4 4.3-1.4 6 0" />
      <circle cx="24" cy="25.5" r="1.2" fill="currentColor" stroke="none" />
      <path d="M10 31.5c0-3.6 2.9-6.5 6.5-6.5h15c3.6 0 6.5 2.9 6.5 6.5v5H10v-5Z" fill="currentColor" opacity="0.1" />
      <path d="M10 31.5c0-3.6 2.9-6.5 6.5-6.5h15c3.6 0 6.5 2.9 6.5 6.5v5H10v-5Z" />
      <path d="M13 36.5h22l-2 3H15l-2-3Z" fill="currentColor" opacity="0.08" />
      <circle cx="24" cy="32" r="1.25" fill="currentColor" stroke="none" />
      <path d="M17 32h3m8 0h3" opacity="0.4" />
    </svg>
  );
}

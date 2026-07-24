interface WanCloudIconProps {
  size?: number;
  color: string;
}

export default function WanCloudIcon({ size = 40, color }: WanCloudIconProps) {
  return (
    <svg
      data-network-icon="wan-cloud"
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
      <path
        d="M13 38h23c5 0 9-3.8 9-8.5 0-4.4-3.5-8-8-8.5C35.5 14.6 30.4 10 24 10c-7 0-12.8 5.2-13.7 12C6 22.8 3 26.2 3 30.3 3 34.6 6.7 38 11.3 38H13Z"
        fill="currentColor"
        opacity="0.08"
      />
      <path d="M13 38h23c5 0 9-3.8 9-8.5 0-4.4-3.5-8-8-8.5C35.5 14.6 30.4 10 24 10c-7 0-12.8 5.2-13.7 12C6 22.8 3 26.2 3 30.3 3 34.6 6.7 38 11.3 38H13Z" />
      <path d="m15 29 7-5 7 4 6-5" opacity="0.65" />
      <path d="M22 24v8m7-4v5m-14-4v4m20-10v10" opacity="0.42" />
      <circle cx="15" cy="29" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="22" cy="24" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="29" cy="28" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="35" cy="23" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

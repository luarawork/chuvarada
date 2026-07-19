interface IconProps {
  className?: string;
}

export function RainIcon({ className }: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#a8d4f0"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M7 15a4.5 4.5 0 0 1 .5-9 6 6 0 0 1 11.4 1.5A3.8 3.8 0 0 1 18 15H7Z" />
      <path d="M9 19l-1 2M13 19l-1 2M17 19l-1 2" />
    </svg>
  );
}

export function DropIcon({ className }: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#a8d4f0"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 3s6 6.8 6 11a6 6 0 1 1-12 0c0-4.2 6-11 6-11Z" />
    </svg>
  );
}

export function WaveIcon({ className }: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#a8d4f0"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M2 9c1.5 1.5 3 1.5 4.5 0s3-1.5 4.5 0 3 1.5 4.5 0 3-1.5 4.5 0" />
      <path d="M2 14.5c1.5 1.5 3 1.5 4.5 0s3-1.5 4.5 0 3 1.5 4.5 0 3-1.5 4.5 0" />
      <path d="M2 20c1.5 1.5 3 1.5 4.5 0s3-1.5 4.5 0 3 1.5 4.5 0 3-1.5 4.5 0" />
    </svg>
  );
}

export function SearchBookIcon({ className }: { className?: string }) {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 6h14a2 2 0 0 1 2 2v16l-9-4-9 4V8a2 2 0 0 1 2-2Z" strokeLinejoin="round" />
      <circle cx="23" cy="11" r="4.5" />
      <path d="M26.2 14.2 29 17" strokeLinecap="round" />
    </svg>
  );
}

export function AddBookIcon({ className }: { className?: string }) {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 6h14a2 2 0 0 1 2 2v16l-9-4-9 4V8a2 2 0 0 1 2-2Z" strokeLinejoin="round" />
      <path d="M23 12v8M19 16h8" strokeLinecap="round" />
    </svg>
  );
}


/** Star toggle for a job. Stops the click so it works inside links and cards. */
export default function StarButton({ starred, onToggle, className = '' }: { starred: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={starred}
      aria-label={starred ? 'Remove star' : 'Star this job'}
      title={starred ? 'Starred' : 'Star this job'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={`rounded-md p-1 transition ${starred ? 'text-amber-300' : 'text-muted/60 hover:text-amber-200'} ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill={starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden>
        <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5z" />
      </svg>
    </button>
  );
}


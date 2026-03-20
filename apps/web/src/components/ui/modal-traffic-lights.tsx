export function ModalTrafficLights({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="group flex size-3 items-center justify-center rounded-full bg-[#ff5f57] transition hover:bg-[#ff7b72]"
      >
        <svg
          aria-hidden="true"
          className="size-[6px] opacity-0 transition-opacity group-hover:opacity-100"
          viewBox="0 0 6 6"
          fill="none"
          stroke="rgba(0,0,0,0.4)"
          strokeWidth="1.2"
          strokeLinecap="round"
        >
          <line x1="1" y1="1" x2="5" y2="5" />
          <line x1="5" y1="1" x2="1" y2="5" />
        </svg>
      </button>
      <div className="size-3 rounded-full bg-foreground/10" aria-hidden="true" />
      <div className="size-3 rounded-full bg-foreground/10" aria-hidden="true" />
    </div>
  );
}

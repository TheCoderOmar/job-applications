import { useEffect, type ReactNode } from 'react';
import Icon from './Icon';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 'xl' fits a document preview. */
  wide?: boolean | 'xl';
}

export default function Modal({ title, onClose, children, wide }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm md:p-10">
      <div className={`card w-full ${wide === 'xl' ? 'max-w-5xl' : wide ? 'max-w-3xl' : 'max-w-xl'} shadow-glow`} role="dialog" aria-modal>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="rounded-md p-1 text-muted hover:bg-raised hover:text-fg" onClick={onClose} aria-label="Close">
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

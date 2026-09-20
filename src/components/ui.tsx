'use client';
import { X } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { statusLabels, type RequestStatus } from '@/lib/domain';
export function Badge({ status }: { status: RequestStatus }) { return <span className={'badge badge-' + status}>{statusLabels[status]}</span>; }
export function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty"><span className="empty-symbol">✓</span><h3>{title}</h3><p>{children ?? 'Los nuevos registros aparecerán aquí.'}</p></div>; }
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    return () => { queueMicrotask(() => {
      if (document.querySelector('[role="dialog"]')) return;
      if (opener?.isConnected) opener.focus();
      else document.querySelector<HTMLElement>('.page-heading h1')?.focus();
    }); };
  }, []);
  return <div className="modal-overlay" onClick={onClose}><section role="dialog" aria-modal="true" aria-label={title} className="modal" onClick={e => e.stopPropagation()} onKeyDown={e => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Tab') {
      const items = e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]');
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }}><div className="modal-head"><h2>{title}</h2><button ref={closeButton} className="icon-button" aria-label="Cerrar" onClick={onClose}><X size={20}/></button></div>{children}</section></div>;
}
export function dateLabel(value: string, timezone: string, full = false) {
  return new Intl.DateTimeFormat('es-ES', { timeZone: timezone, day: 'numeric', month: 'short', ...(full ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
export const initials = (name: string) => name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();

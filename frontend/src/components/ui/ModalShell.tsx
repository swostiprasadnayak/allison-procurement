"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, type Icon } from "@phosphor-icons/react";

/**
 * ModalShell — the IRIS review-modal pattern (iris Modal.tsx +
 * DemandDeckModal shell): centered card over a dimmed navy backdrop,
 * rounded-16 with the modal shadow, `mercer-fade-up` entrance, header with
 * duotone icon / title / subtitle / meta-chips row and a 28px close button,
 * scrollable body, bordered footer on the sunken surface.
 *
 * Presentation-only by design: Escape handling and focus management stay in
 * `usePanelDialog` (the callers already wire it); this shell owns the
 * backdrop click and the body scroll lock. z-[100] sits above the SideNav
 * overlay (50) and below the confirm dialogs (120).
 */

type ModalSize = "default" | "wide" | "deck";

const MODAL_WIDTHS: Record<ModalSize, number> = {
  default: 520,
  wide: 758,
  deck: 971,
};

export interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Phosphor icon rendered in the header (duotone, 18px). */
  icon?: Icon;
  iconColor?: string;
  /** Chips/meta row under the title block (IRIS deck-header style). */
  headerMeta?: ReactNode;
  size?: ModalSize;
  footer?: ReactNode;
  children: ReactNode;
  /** Raise to z-[120] so a confirm dialog layers above an already-open review
   *  ModalShell (z-[100]). Default z-[100]. */
  elevated?: boolean;
  /** Px reserved on the right so the centered modal shifts left and doesn't sit
   *  under a docked side panel (e.g. Ask Mercer). Default 0. */
  reservedRight?: number;
  /** Let overlays (e.g. a DatePicker calendar) escape the body instead of being
   *  clipped by the scroll container. Use only for SHORT dialogs that never need
   *  to scroll internally — the body switches from overflow-auto to overflow-visible. */
  overflowVisible?: boolean;
}

export function ModalShell({
  open,
  onClose,
  title,
  subtitle,
  icon: HeaderIcon,
  iconColor = "var(--text-primary)",
  headerMeta,
  size = "wide",
  footer,
  children,
  elevated = false,
  reservedRight = 0,
  overflowVisible = false,
}: ModalShellProps) {
  // SSR-safe portal — false on the server snapshot, true once mounted.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Lock the page scroll while the modal is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${elevated ? "z-[120]" : "z-[100]"} flex items-center justify-center`}
      style={{
        background: "rgba(15, 16, 35, 0.55)",
        paddingRight: reservedRight || undefined,
        transition: "padding-right 0.2s ease",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative mx-4 my-6 flex w-full flex-col rounded-[16px] bg-[var(--surface-base,#ffffff)] ${overflowVisible ? "" : "overflow-hidden"}`}
        style={{
          maxWidth: MODAL_WIDTHS[size],
          maxHeight: "calc(100vh - 48px)",
          boxShadow: "var(--shadow-modal)",
          animation: "mercer-fade-up 0.22s ease-out both",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-start justify-between gap-2 border-b px-6 py-4"
          style={{ borderColor: "var(--border-default,#e4e4e7)" }}
        >
          <div className="flex min-w-0 items-start gap-2">
            {HeaderIcon && (
              <div className="shrink-0 py-1">
                <HeaderIcon size={18} weight="duotone" style={{ color: iconColor }} />
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                {/* DS "Heading 4" token (v0.4.3): 20px/600/22.8px, warmer
                    --text-heading — matches the DS PageHeading title so the
                    dialog title and page titles read at the same level. */}
                <span
                  className="text-[20px] font-semibold leading-[22.8px]"
                  style={{ color: "var(--text-heading, #1e1e1e)" }}
                >
                  {title}
                </span>
                {subtitle && (
                  <span className="min-w-0 text-[14px]" style={{ color: "var(--text-secondary)" }}>
                    {subtitle}
                  </span>
                )}
              </div>
              {headerMeta && (
                <div className="flex flex-wrap items-center gap-2">{headerMeta}</div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-white transition-colors hover:bg-[var(--surface-hover)]"
            style={{ border: "1px solid var(--border-light)" }}
          >
            <X size={16} weight="bold" style={{ color: "var(--text-primary)" }} />
          </button>
        </div>

        {/* Body */}
        <div className={`flex-1 ${overflowVisible ? "overflow-visible" : "overflow-y-auto"}`}>
          <div className="flex flex-col gap-4 px-6 py-5">{children}</div>
        </div>

        {/* Footer */}
        {footer && (
          <div
            className={`shrink-0 border-t px-6 py-4 ${overflowVisible ? "rounded-b-[16px]" : ""}`}
            style={{
              borderColor: "var(--border-default,#e4e4e7)",
              background: "var(--surface-sunken,#f8fafc)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

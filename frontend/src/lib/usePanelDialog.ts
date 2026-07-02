"use client";

import { useEffect, useRef } from "react";

/**
 * Accessibility shim for the DS DetailPanelShell, which portals a backdrop +
 * panel to <body> but ships no Escape handling, focus management or dialog
 * semantics. While `open`:
 *  - Escape invokes `onClose` — the same handler the backdrop click uses;
 *  - focus moves into the panel root (tabIndex -1) and is restored on close;
 *  - the panel root gains role="dialog" / aria-modal / aria-label.
 *
 * The shell renders its panel layer as the fixed `z-[95]` element; each page
 * mounts exactly one DetailPanelShell, so the selector is unambiguous.
 */
export function usePanelDialog(open: boolean, onClose: () => void, label?: string) {
  // Latest-value refs so the Escape listener and aria-label never go stale
  // without re-binding the main effect on every handler identity change.
  const closeRef = useRef(onClose);
  const labelRef = useRef(label);
  useEffect(() => {
    closeRef.current = onClose;
    labelRef.current = label;
  });

  useEffect(() => {
    if (!open) return;

    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const panel = document.querySelector<HTMLElement>(".z-\\[95\\]");
    if (panel) {
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      if (labelRef.current) panel.setAttribute("aria-label", labelRef.current);
      panel.setAttribute("tabindex", "-1");
      panel.focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (panel) {
        panel.removeAttribute("role");
        panel.removeAttribute("aria-modal");
        panel.removeAttribute("aria-label");
      }
      previous?.focus({ preventScroll: true });
    };
  }, [open]);
}

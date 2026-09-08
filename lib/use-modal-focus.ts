"use client";

import { useEffect, useRef, type RefObject } from "react";

const modalStack: HTMLElement[] = [];
const inertState = new Map<HTMLElement, boolean>();
let bodyStyle: { overflow: string; paddingRight: string } | null = null;

function focusableElements(element: HTMLElement) {
  return Array.from(element.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((item) => item.getClientRects().length > 0 && !item.closest("[inert]"));
}

function isolateTopModal() {
  for (const [element, inert] of inertState) element.inert = inert;
  inertState.clear();

  const modal = modalStack.at(-1);
  if (!modal) return;
  let branch: HTMLElement = modal;
  while (branch !== document.body && branch.parentElement) {
    // A new modal may be rendered inside a previously inert sibling.
    inertState.set(branch, branch.inert);
    branch.inert = false;
    for (const sibling of branch.parentElement.children) {
      if (sibling === branch || !(sibling instanceof HTMLElement) || sibling.matches(".backdrop, [data-modal-backdrop]")) continue;
      inertState.set(sibling, sibling.inert);
      sibling.inert = true;
    }
    branch = branch.parentElement;
  }
}

/** Focus, background isolation and scroll locking shared by app overlays. */
export function useModalFocus({
  open,
  onClose,
  ref,
  initialFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  ref: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const modal = ref.current;
    if (!open || !modal) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!modalStack.length) {
      bodyStyle = { overflow: document.body.style.overflow, paddingRight: document.body.style.paddingRight };
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbarWidth}px`;
      }
      document.body.style.overflow = "hidden";
    }
    modalStack.push(modal);
    isolateTopModal();

    function focusStart() {
      (initialFocusRef?.current ?? focusableElements(modal!)[0] ?? modal)?.focus({ preventScroll: true });
    }
    const frame = requestAnimationFrame(() => {
      if (modalStack.at(-1) === modal) focusStart();
    });
    function onKey(event: KeyboardEvent) {
      if (modalStack.at(-1) !== modal) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === "Tab") {
        const items = focusableElements(modal!);
        const first = items[0];
        const last = items.at(-1);
        if (!first) {
          event.preventDefault();
          modal?.focus();
        } else if (event.shiftKey && (document.activeElement === first || !modal?.contains(document.activeElement))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !modal?.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    function onFocus(event: FocusEvent) {
      if (modalStack.at(-1) === modal && !modal?.contains(event.target as Node)) focusStart();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      const wasTop = modalStack.at(-1) === modal;
      const index = modalStack.indexOf(modal);
      if (index >= 0) modalStack.splice(index, 1);
      isolateTopModal();
      if (!modalStack.length && bodyStyle) {
        document.body.style.overflow = bodyStyle.overflow;
        document.body.style.paddingRight = bodyStyle.paddingRight;
        bodyStyle = null;
      }
      if (wasTop) {
        const top = modalStack.at(-1);
        if (previousFocus?.isConnected && !previousFocus.closest("[inert]") && (!top || top.contains(previousFocus))) {
          previousFocus.focus({ preventScroll: true });
        } else if (top) {
          (focusableElements(top)[0] ?? top).focus({ preventScroll: true });
        }
      }
    };
  }, [open, ref, initialFocusRef]);
}

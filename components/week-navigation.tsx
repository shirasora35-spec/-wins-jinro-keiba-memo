"use client";

import type { MouseEvent, ReactNode } from "react";

export function WeekLink({ href, className, children }: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    // Keep native link behavior for new tabs, modified clicks and no-JS visits.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const destination = new URL(href, window.location.href);
    // Next.js observes pushState, retaining the already-loaded weekly snapshots.
    // Repeated taps must not add duplicate entries to browser history.
    if (destination.href !== window.location.href) {
      window.history.pushState(null, "", href);
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  return <a href={href} className={className} onClick={navigate}>{children}</a>;
}

export function ReturnToCurrentWeek() {
  return (
    <nav className="current-week-navigation" aria-label="週の切り替え">
      <WeekLink href="/" className="current-week-button">
        <span aria-hidden="true">←</span> 今週のメモ馬に戻る
      </WeekLink>
    </nav>
  );
}

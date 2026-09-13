"use client";
import { useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "./rail.css";

/** Carrousel manuel : flèches et points, une carte par pas, sans boucle ni défilement automatique. */
export function useRail(total: number, columns: number) {
  const [index, setIndex] = useState(0);
  const max = Math.max(0, total - columns);
  const current = Math.min(index, max);
  return {
    index: current, max,
    step: (delta: number) => setIndex(Math.min(max, Math.max(0, current + delta))),
    go: (value: number) => setIndex(Math.min(max, Math.max(0, value))),
  };
}

export function RailHeading({title, note, link, rail, arrows}: {
  title: string; note?: string; link?: ReactNode;
  rail: {index: number; max: number; step: (delta: number) => void}; arrows: boolean;
}) {
  return <div className="rail-heading">
    <h2>{title}</h2>
    {note && <span className="rail-note">{note}</span>}
    {link}
    {arrows && rail.max > 0 && <div className="rail-arrows">
      <button type="button" className="rail-arrow" disabled={rail.index === 0} aria-label={t("Offres précédentes")} onClick={() => rail.step(-1)}><ChevronLeft size={17}/></button>
      <button type="button" className="rail-arrow rail-next" disabled={rail.index >= rail.max} aria-label={t("Offres suivantes")} onClick={() => rail.step(1)}><ChevronRight size={17}/></button>
    </div>}
  </div>;
}

export function RailDots({rail, label}: {rail: {index: number; max: number; go: (value: number) => void}; label: string}) {
  if (rail.max <= 0) return null;
  return <span className="rail-dots" role="group" aria-label={label}>
    {Array.from({length: rail.max + 1}, (_, position) => <button type="button" key={position}
      className={`rail-dot ${position === rail.index ? "selected" : ""}`} aria-current={position === rail.index}
      aria-label={t("Offre {position} sur {total}", {position: position + 1, total: rail.max + 1})}
      onClick={() => rail.go(position)}/>)}
  </span>;
}

"use client";
import { useEffect, useState } from "react";

/** Le pas d'un carrousel suit le nombre de cartes réellement visibles ; rien ne défile tout seul. */
export function useColumns(wide: number, medium: number, narrow: number) {
  const [columns, setColumns] = useState(wide);
  useEffect(() => {
    const small = window.matchMedia("(max-width: 760px)");
    const mid = window.matchMedia("(max-width: 1100px)");
    const update = () => setColumns(small.matches ? narrow : mid.matches ? medium : wide);
    update();
    small.addEventListener("change", update);
    mid.addEventListener("change", update);
    return () => { small.removeEventListener("change", update); mid.removeEventListener("change", update); };
  }, [wide, medium, narrow]);
  return columns;
}

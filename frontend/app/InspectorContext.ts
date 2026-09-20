import { createContext, useContext } from "react";
import type { Inspector } from "../hooks/useInspector";

export const InspectorContext = createContext<Inspector | null>(null);
export function useInspectorContext() {
  const inspector = useContext(InspectorContext);
  if (!inspector)
    throw new Error("Inspector components require the application provider.");
  return inspector;
}

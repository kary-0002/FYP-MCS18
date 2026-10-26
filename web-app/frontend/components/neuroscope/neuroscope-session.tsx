"use client";

import { createContext, useContext, useState } from "react";

export type NeuroScopeBundle = {
  id: string;
  edfPath: string;
  statePath: string;
  reportPath: string;
};

export type NeuroScopeSession = {
  file: File;
  recordingState: unknown;
  sourceUrl: string | null;
  bundle: NeuroScopeBundle | null;
  report: { blob: Blob; name: string } | null;
  patient?: {
    id: string;
    name: string | null;
    patient_identifier: string | null;
    date_of_birth: string | null;
  } | null;
};

type SessionContextValue = {
  session: NeuroScopeSession | null;
  setSession: (
    update:
      | NeuroScopeSession
      | null
      | ((current: NeuroScopeSession | null) => NeuroScopeSession | null),
  ) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function NeuroScopeSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<NeuroScopeSession | null>(null);
  return (
    <SessionContext.Provider value={{ session, setSession }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useNeuroScopeSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error(
      "useNeuroScopeSession must be used inside NeuroScopeSessionProvider.",
    );
  }
  return value;
}

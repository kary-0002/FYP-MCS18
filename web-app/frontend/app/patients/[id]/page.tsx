"use client";

import { useParams } from "next/navigation";
import { Header } from "@/components/header";
import { PatientProfile } from "@/components/patient-profile";

export default function PatientPage() {
  const params = useParams<{ id: string }>();
  const patientId = params.id;
  return (
    <div className="app-layout min-h-screen bg-background">
      <Header />
      <main className="px-4 pb-12">
        <PatientProfile patientId={patientId} />
      </main>
    </div>
  );
}
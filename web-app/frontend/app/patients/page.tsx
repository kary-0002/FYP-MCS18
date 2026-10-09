import { Header } from "@/components/header";
import { PatientLibrary } from "@/components/patient-library";

export default function PatientsPage() {
  return (
    <div className="app-layout min-h-screen bg-background">
      <Header />
      <main className="px-4 pb-12">
        <div className="mx-auto mb-4 max-w-3xl">
          <div className="section-kicker">Patient records</div>
          <h1 className="text-3xl font-bold tracking-tight">
            My Patients
          </h1>
          <p className="mt-2 text-muted-foreground">
            Group EEG recordings by patient for statistical review.
          </p>
        </div>
        <PatientLibrary />
      </main>
    </div>
  );
}
"use client";

import { SyntheticEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Plus, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";

interface PatientRow {
  id: string;
  name: string | null;
  patient_identifier: string | null;
  date_of_birth: string | null;
  created_at: string;
}

function formatDate(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

export function PatientLibrary() {
  const supabase = useMemo(() => createClient(), []);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [recordingCounts, setRecordingCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [patientIdentifier, setPatientIdentifier] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [error, setError] = useState<string | null>(null);
  
  const loadPatients = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [patientResult, recordingResult] = await Promise.all([
      supabase
        .from("patients")
        .select("id, name, patient_identifier, date_of_birth, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("user_files")
        .select("patient_id")
        .not("patient_id", "is", null),
    ]);
    if (patientResult.error) {
      setError(patientResult.error.message);
      setLoading(false);
      return;
    }
    if (recordingResult.error) {
      setError(recordingResult.error.message);
      setLoading(false);
      return;
    }
    const counts: Record<string, number> = {};
    for (const recording of recordingResult.data ?? []) {
      if (!recording.patient_id) continue;
      counts[recording.patient_id] = (counts[recording.patient_id] ?? 0) + 1;
    }
    setPatients((patientResult.data ?? []) as PatientRow[]);
    setRecordingCounts(counts);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadPatients();
  }, [loadPatients]);

  function resetForm() {
    setName("");
    setPatientIdentifier("");
    setDateOfBirth("");
    setError(null);
  }

  async function handleCreatePatient(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedName = name.trim();
    const cleanedIdentifier = patientIdentifier.trim();
    if (!cleanedName && !cleanedIdentifier) {
      setError("Enter a patient name or Patient ID.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("You need to sign in before creating a patient.");
      }
      const { error: insertError } = await supabase.from("patients").insert({
        user_id: user.id,
        name: cleanedName || null,
        patient_identifier: cleanedIdentifier || null,
        date_of_birth: dateOfBirth || null
      });
      if (insertError) throw insertError;
      await loadPatients();
      resetForm();
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create patient.",);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex items-center justify-start">
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              New Patient
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleCreatePatient}>
              <DialogHeader>
                <DialogTitle>New Patient</DialogTitle>
                <DialogDescription>
                  Create a patient profile for grouping EEG recordings.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-5">
                <div className="space-y-2">
                  <Label htmlFor="patient-name">Name</Label>
                  <Input
                    id="patient-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Patient name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-identifier">Patient ID</Label>
                  <Input
                    id="patient-identifier"
                    value={patientIdentifier}
                    onChange={(event) =>
                      setPatientIdentifier(event.target.value)
                    }
                    placeholder="Patient ID"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-dob">Date of Birth</Label>
                  <Input
                    id="patient-dob"
                    type="date"
                    value={dateOfBirth}
                    onChange={(event) => setDateOfBirth(event.target.value)}
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? "Creating..." : "Create Patient"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {error && !dialogOpen && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      {loading ? (
        <p className="text-sm text-muted-foreground">
          Loading patients...
        </p>
      ) : patients.length === 0 ? (
        <Card className="p-6 text-center">
          <UserRound className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No patients yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a patient profile to start grouping EEG recordings.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {patients.map((patient) => {
            const count = recordingCounts[patient.id] ?? 0;
            return (
              <Card
                key={patient.id}
                className="flex min-h-36 flex-col justify-between gap-4 p-4"
              >
                <div className="flex items-start gap-3">
                  <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {patient.name?.trim() ||
                        patient.patient_identifier ||
                        "Unnamed {atient"}
                    </p>
                    {patient.patient_identifier && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Patient ID: {patient.patient_identifier}
                      </p>
                    )}
                    {patient.date_of_birth && (
                      <p className="text-sm text-muted-foreground">
                        DOB: {formatDate(patient.date_of_birth)}
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {count} {count === 1 ? "recording" : "recordings"}
                </p>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
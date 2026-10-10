"use client";

import { type ReactNode, type SyntheticEvent, useEffect, useMemo, useState } from "react";
import { Plus, Search, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export interface PatientSummary {
  id: string;
  name: string | null;
  patient_identifier: string | null;
  date_of_birth: string | null;
}

interface PatientAssignmentDialogProps {
  fileId: string;
  currentPatientId: string | null;
  sourcePatientIdentifier?: string | null;
  onAssignmentChange?: (patient: PatientSummary | null) => void;
  trigger?: ReactNode;
}

function patientLabel(patient: PatientSummary) {
  return (patient.name?.trim() || patient.patient_identifier || "Unnamed patient");
}

export function PatientAssignmentDialog({
  fileId,
  currentPatientId,
  sourcePatientIdentifier = null,
  onAssignmentChange,
  trigger
}: PatientAssignmentDialogProps) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIdentifier, setNewIdentifier] = useState("");
  const [newDateOfBirth, setNewDateOfBirth] = useState("");
  
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function loadPatients() {
      setLoading(true);
      setError(null);
      const { data, error: queryError } = await supabase
        .from("patients")
        .select("id, name, patient_identifier, date_of_birth")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (queryError) {
        setError(queryError.message);
      } else {
        setPatients((data ?? []) as PatientSummary[]);
      }
      setLoading(false);
    }
    void loadPatients();
    return () => { cancelled = true; };
  }, [open, supabase]);

  const suggestedPatient = useMemo(() => {
    const source = sourcePatientIdentifier?.trim().toLowerCase();
    if (!source) return null;
    return (
      patients.find((patient) => patient.patient_identifier?.trim().toLowerCase() === source)
      ?? null
    );
  }, [patients, sourcePatientIdentifier]);

  const visiblePatients = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return patients.filter((patient) => {
      if (patient.id === suggestedPatient?.id) return false;
      if (!normalized) return true;
      return (
        patient.name?.toLowerCase().includes(normalized) ||
        patient.patient_identifier?.toLowerCase().includes(normalized)
      );
    });
  }, [patients, query, suggestedPatient]);

  function resetDialog() {
    setQuery("");
    setError(null);
    setCreating(false);
    setNewName("");
    setNewIdentifier("");
    setNewDateOfBirth("");
  }

  async function assignPatient(patient: PatientSummary) {
    setSaving(true);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from("user_files")
        .update({ patient_id: patient.id })
        .eq("id", fileId);
      if (updateError) throw updateError;
      onAssignmentChange?.(patient);
      setOpen(false);
      resetDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assign this patient.");
    } finally {
      setSaving(false);
    }
  }

  async function unassignPatient() {
    setSaving(true);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from("user_files")
        .update({ patient_id: null })
        .eq("id", fileId);
      if (updateError) throw updateError;
      onAssignmentChange?.(null);
      setOpen(false);
      resetDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unassign this patient.");
    } finally {
      setSaving(false);
    }
  }

  function startCreatePatient() {
    setNewName("");
    setNewIdentifier(sourcePatientIdentifier ?? "");
    setNewDateOfBirth("");
    setError(null);
    setCreating(true);
  }

  async function createAndAssign(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedName = newName.trim();
    const cleanedIdentifier = newIdentifier.trim();
    if (!cleanedName && !cleanedIdentifier) {
      setError("Enter a patient name or Patient ID.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("You need to sign in before creating a patient.");
      }
      const { data: patient, error: insertError } = await supabase
        .from("patients")
        .insert({
          user_id: user.id,
          name: cleanedName || null,
          patient_identifier: cleanedIdentifier || null,
          date_of_birth: newDateOfBirth || null
        })
        .select("id, name, patient_identifier, date_of_birth")
        .single();
      if (insertError || !patient) {
        throw (insertError ?? new Error("Could not create the patient profile."));
      }
      const { error: assignmentError } = await supabase
        .from("user_files")
        .update({ patient_id: patient.id })
        .eq("id", fileId);
      if (assignmentError) throw assignmentError;
      const createdPatient = patient as PatientSummary;
      onAssignmentChange?.(createdPatient);
      setPatients((current) => [createdPatient, ...current]);
      setOpen(false);
      resetDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create and assign the patient.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (saving) return;
        setOpen(nextOpen);
        if (!nextOpen) resetDialog();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            {currentPatientId ? "Change" : "Assign Patient"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        {creating ? (
          <form onSubmit={createAndAssign}>
            <DialogHeader>
              <DialogTitle>Create Patient</DialogTitle>
              <DialogDescription>
                Create a new patient profile and assign this file to it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-5">
              <div className="space-y-2">
                <Label htmlFor="assignment-new-name">
                  Name
                </Label>
                <Input
                  id="assignment-new-name"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Patient name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="assignment-new-id">
                  Patient ID
                </Label>
                <Input
                  id="assignment-new-id"
                  value={newIdentifier}
                  onChange={(event) => setNewIdentifier(event.target.value)}
                  placeholder="Patient ID"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="assignment-new-dob">
                  Date of Birth
                </Label>
                <Input
                  id="assignment-new-dob"
                  type="date"
                  value={newDateOfBirth}
                  onChange={(event) => setNewDateOfBirth(event.target.value)}
                />
              </div>
              {error && (
                <p className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setCreating(false);
                  setError(null);
                }}
              >
                Back
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Creating..." : "Create & Assign"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {currentPatientId ? "Change Patient" : "Assign Patient"}
              </DialogTitle>
              <DialogDescription>
                Choose an existing patient profile or create a new one.
                <br />
                Patient matches are not assigned automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {sourcePatientIdentifier && (
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  Detected Patient ID:{" "}
                  <span className="font-medium">
                    {sourcePatientIdentifier}
                  </span>
                </div>
              )}
              {suggestedPatient && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Suggested Match
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {patientLabel(suggestedPatient)}
                      </p>
                      {suggestedPatient.patient_identifier && (
                        <p className="text-sm text-muted-foreground">
                          Patient ID:{" "}
                          {suggestedPatient.patient_identifier}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      disabled={saving || currentPatientId === suggestedPatient.id}
                      onClick={() => void assignPatient(suggestedPatient)}
                    >
                      {currentPatientId === suggestedPatient.id ? "Assigned" : "Assign"}
                    </Button>
                  </div>
                </div>
              )}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search patients..."
                  className="pl-9"
                />
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {loading ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    Loading patients...
                  </p>
                ) : visiblePatients.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    No matching patients.
                  </p>
                ) : (
                  visiblePatients.map((patient) => (
                    <div
                      key={patient.id}
                      className="flex items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {patientLabel(patient)}
                          </p>
                          {patient.patient_identifier && (
                            <p className="text-sm text-muted-foreground">
                              Patient ID:{" "}
                              {patient.patient_identifier}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={saving || currentPatientId === patient.id}
                        onClick={() => void assignPatient(patient)}
                      >
                        {currentPatientId === patient.id ? "Assigned" : "Assign"}
                      </Button>
                    </div>
                  ))
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={startCreatePatient}
                disabled={saving}
              >
                <Plus className="mr-2 h-4 w-4" />
                Create New Patient
              </Button>
              {currentPatientId && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                  disabled={saving}
                  onClick={() => void unassignPatient()}
                >
                  Unassign from Patient
                </Button>
              )}
              {error && (
                <p className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
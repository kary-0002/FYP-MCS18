"use client";

import { type SyntheticEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, FileText, Pencil, Trash2, Unlink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FILE_BUCKET, getRecordingPathsFromEdfPath } from "@/lib/files";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { PatientTrends } from "@/components/patient-trends";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface PatientRow {
  id: string;
  name: string | null;
  patient_identifier: string | null;
  date_of_birth: string | null;
  created_at: string;
}

interface RecordingRow {
  id: string;
  original_name: string;
  storage_path: string;
  size_bytes: number | null;
  created_at: string;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = value.includes("T") ? new Date(value) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatFileSize(bytes: number | null) {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function PatientProfile({ patientId }: { patientId: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [recordings, setRecordings] = useState<RecordingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [savingPatient, setSavingPatient] = useState(false);
  const [editName, setEditName] = useState("");
  const [editIdentifier, setEditIdentifier] = useState("");
  const [editDateOfBirth, setEditDateOfBirth] = useState("");

  const loadPatient = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [patientResult, recordingResult] = await Promise.all([
      supabase
        .from("patients")
        .select("id, name, patient_identifier, date_of_birth, created_at")
        .eq("id", patientId)
        .single(),
      supabase
        .from("user_files")
        .select("id, original_name, storage_path, size_bytes, created_at")
        .eq("patient_id", patientId)
        .eq("kind", "edf")
        .order("created_at", { ascending: false })
    ]);
    if (patientResult.error || !patientResult.data) {
      setError(patientResult.error?.message ?? "Patient could not be found.");
      setLoading(false);
      return;
    }
    if (recordingResult.error) {
      setError(recordingResult.error.message);
      setLoading(false);
      return;
    }
    setPatient(patientResult.data as PatientRow);
    setRecordings((recordingResult.data ?? []) as RecordingRow[]);
    setLoading(false);
  }, [patientId, supabase]);

  useEffect(() => {
    void loadPatient();
  }, [loadPatient]);

  function openEditPatient() {
    if (!patient) return;
    setEditName(patient.name ?? "");
    setEditIdentifier(patient.patient_identifier ?? "");
    setEditDateOfBirth(patient.date_of_birth ?? "");
    setError(null);
    setEditOpen(true);
  }

  async function handleUpdatePatient(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedName = editName.trim();
    const cleanedIdentifier = editIdentifier.trim();
    if (!cleanedName && !cleanedIdentifier) {
      setError("Enter a patient name or Patient ID.");
      return;
    }
    setSavingPatient(true);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from("patients")
        .update({
          name: cleanedName || null,
          patient_identifier: cleanedIdentifier || null,
          date_of_birth: editDateOfBirth || null
        })
        .eq("id", patientId);
      if (updateError) throw updateError;
      setEditOpen(false);
      await loadPatient();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update patient.");
    } finally {
      setSavingPatient(false);
    }
  }

  async function handleDeletePatient() {
    if (!patient) return;
    setError(null);
    const { error: deleteError } = await supabase
      .from("patients")
      .delete()
      .eq("id", patientId);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    router.push("/patients");
  }

  async function handleUnassignRecording(recording: RecordingRow) {
    setError(null);
    const { error: updateError } = await supabase
      .from("user_files")
      .update({ patient_id: null })
      .eq("id", recording.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setRecordings((current) => current.filter((item) => item.id !== recording.id));
  }

  async function handleDeleteRecording(recording: RecordingRow) {
    setError(null);
    const recordingPaths = getRecordingPathsFromEdfPath(recording.storage_path);
    const storagePaths = recordingPaths
      ? [recordingPaths.edf, recordingPaths.state, recordingPaths.report, recordingPaths.source]
      : [recording.storage_path];
    const { error: storageError } = await supabase.storage
      .from(FILE_BUCKET)
      .remove(storagePaths);
    if (storageError) {
      setError(storageError.message);
      return;
    }
    const { error: deleteError } = await supabase
      .from("user_files")
      .delete()
      .eq("id", recording.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setRecordings((current) => current.filter((item) => item.id !== recording.id));
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl">
        <p className="text-sm text-muted-foreground">
          Loading patient...
        </p>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="mx-auto max-w-5xl">
        <Button
          variant="ghost"
          onClick={() => router.push("/patients")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Patients
        </Button>
        <p className="mt-4 text-sm text-destructive">
          {error ?? "Patient could not be found."}
        </p>
      </div>
    );
  }

  const displayName = patient.name?.trim() || patient.patient_identifier || "Unnamed patient";
  const newestRecording = recordings[0] ?? null;
  const oldestRecording = recordings.length > 0 ? recordings[recordings.length - 1] : null;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <Button
          variant="ghost"
          className="-ml-3 mb-2"
          onClick={() => router.push("/patients")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Patients
        </Button>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="section-kicker">Patient Record</div>
            <h1 className="text-3xl font-bold tracking-tight">
              {displayName}
            </h1>
            {patient.patient_identifier && (
              <p className="mt-1 text-muted-foreground">
                Patient ID: {patient.patient_identifier}
              </p>
            )}
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto">
            <Button
              variant="outline"
              className="w-full sm:w-40"
              onClick={openEditPatient}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit Patient
            </Button>
            <ConfirmActionDialog
              trigger={
                <Button
                  variant="outline"
                  className="w-full hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive sm:w-40"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Patient
                </Button>
              }
              title="Delete patient?"
              description="The patient profile will be deleted. Its EEG recordings will remain in My Files and become unassigned."
              confirmLabel="Delete Patient"
              onConfirm={handleDeletePatient}
            />
          </div>
        </div>
      </div>
      {error && !editOpen && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="recordings">
            Recordings ({recordings.length})
          </TabsTrigger>
          <TabsTrigger value="trends">
            Trends & Statistics
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">
                Patient ID
              </p>
              <p className="mt-0 font-medium">
                {patient.patient_identifier || "—"}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">
                Date of Birth
              </p>
              <p className="mt-0 font-medium">
                {formatDate(patient.date_of_birth)}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">
                EEG Recordings
              </p>
              <p className="mt-0 font-medium">
                {recordings.length}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">
                Profile Created
              </p>
              <p className="mt-0 font-medium">
                {formatDate(patient.created_at)}
              </p>
            </Card>
          </div>
          <Card className="p-5">
            <h2 className="font-semibold">Recording History</h2>
            <div className="mt-0 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">
                  First Recording Added
                </p>
                <p className="mt-1 font-medium">
                  {oldestRecording ? formatDate(oldestRecording.created_at) : "—"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  Latest Recording Added
                </p>
                <p className="mt-1 font-medium">
                  {newestRecording ? formatDate(newestRecording.created_at) : "—"}
                </p>
              </div>
            </div>
          </Card>
        </TabsContent>
        <TabsContent
          value="recordings"
          className="mt-5 space-y-3"
        >
          {recordings.length === 0 ? (
            <Card className="p-8 text-center">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="mt-3 font-medium">
                No EEG Recordings Assigned
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Assign an EEG recording to this patient from My Files or the EEG Viewer.
              </p>
            </Card>
          ) : (
            recordings.map((recording) => (
              <Card
                key={recording.id}
                className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <p
                      className="truncate font-medium"
                      title={recording.original_name}
                    >
                      {recording.original_name}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Added {formatDate(recording.created_at)}
                    </span>
                    <span>
                      {formatFileSize(recording.size_bytes)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => router.push(`/edf-reader?file=${encodeURIComponent(recording.id)}`)}
                  >
                    Open in Viewer
                  </Button>
                  <ConfirmActionDialog
                    trigger={
                      <Button variant="outline">
                        <Unlink className="mr-2 h-4 w-4" />
                        Unassign
                      </Button>
                    }
                    title="Unassign recording?"
                    description={`"${recording.original_name}" will remain in My Files but will no longer belong to this patient.`}
                    confirmLabel="Unassign"
                    destructive={false}
                    onConfirm={() => handleUnassignRecording(recording)}
                  />
                  <ConfirmActionDialog
                    trigger={
                      <Button
                        variant="outline"
                        className="hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    }
                    title="Delete EEG recording?"
                    description={`"${recording.original_name}" and its saved analysis state, annotations, and generated report will be permanently deleted.`}
                    confirmLabel="Delete Recording"
                    onConfirm={() => handleDeleteRecording(recording)}
                  />
                </div>
              </Card>
            ))
          )}
        </TabsContent>
        <TabsContent value="trends" className="mt-5">
          <PatientTrends recordings={recordings} />
        </TabsContent>
      </Tabs>
      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          if (!savingPatient) setEditOpen(open);
        }}
      >
        <DialogContent>
          <form onSubmit={handleUpdatePatient}>
            <DialogHeader>
              <DialogTitle>Edit Patient</DialogTitle>
              <DialogDescription>
                Update this patient profile. Recording assignments are not changed.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-5">
              <div className="space-y-2">
                <Label htmlFor="edit-patient-name">Name</Label>
                <Input
                  id="edit-patient-name"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-patient-id">
                  Patient ID
                </Label>
                <Input
                  id="edit-patient-id"
                  value={editIdentifier}
                  onChange={(event) => setEditIdentifier(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-patient-dob">
                  Date of Birth
                </Label>
                <Input
                  id="edit-patient-dob"
                  type="date"
                  value={editDateOfBirth}
                  onChange={(event) => setEditDateOfBirth(event.target.value)}
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
                disabled={savingPatient}
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingPatient}>
                {savingPatient ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
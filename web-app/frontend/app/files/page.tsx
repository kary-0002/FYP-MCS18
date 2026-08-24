import { Header } from "@/components/header";
import { FileLibrary } from "@/components/file-library";

export default function FilesPage() {
  return (
    <div className="app-layout min-h-screen bg-background">
      <Header />
      <main className="px-4 pb-12">
        <div className="mx-auto mb-8 max-w-3xl">
          <div className="section-kicker">Private library</div><h1 className="text-3xl font-bold tracking-tight">My files</h1>
          <p className="mt-2 text-muted-foreground">
            Store EEG recordings (.edf) and annotation or analysis reports
            (.pdf). Files are private to your account.
          </p>
        </div>
        <FileLibrary />
      </main>
    </div>
  );
}

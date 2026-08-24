import { Header } from "@/components/header";
import EDFViewer from "@/components/edf-viewer";

export default function Page() {
    return (
        <div className="min-h-screen bg-background">
            <Header />
            <main className="container mx-auto px-4 py-8">
                <h1 className="mb-6 text-3xl font-bold">
                    EDF Viewer
                </h1>

                <EDFViewer />
            </main>
        </div>
    );
}

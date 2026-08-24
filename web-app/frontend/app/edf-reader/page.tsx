import { Header } from "@/components/header";
import EDFViewer from "@/components/edf-viewer";

export default function Page() {
    return (
        <div className="app-layout min-h-screen bg-background">
            <Header />
            <main className="px-4 pb-8">
                <div className="section-kicker">Signal review</div>
                <h1 className="mb-6 text-3xl font-bold tracking-tight">
                    EDF Viewer
                </h1>

                <EDFViewer />
            </main>
        </div>
    );
}

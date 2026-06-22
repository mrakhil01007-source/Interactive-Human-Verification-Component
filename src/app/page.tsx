import VerificationCard from "@/components/verification-card";
import { ShieldAlert, Fingerprint, Database, Cpu } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Top Header Navigation */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center font-bold text-white shadow-md shadow-cyan-500/10">
              A
            </div>
            <span className="font-extrabold tracking-wider bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent text-sm">
              AEGIS PORTAL
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              SYSTEM ONLINE
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-12 lg:py-20 flex flex-col lg:flex-row items-center gap-12 lg:gap-16 justify-center">
        
        {/* Left Column: Hero Text & Specs */}
        <div className="flex-1 flex flex-col gap-6 text-center lg:text-left max-w-lg">
          <div className="inline-flex self-center lg:self-start items-center gap-2 px-3 py-1 bg-cyan-950/40 border border-cyan-800/30 rounded-full text-xs font-semibold text-cyan-400">
            <ShieldAlert className="w-3.5 h-3.5" />
            Biometric Gatekeeper
          </div>
          
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Verify your humanity,{" "}
            <span className="bg-gradient-to-r from-cyan-400 via-teal-300 to-purple-500 bg-clip-text text-transparent">
              securely in browser.
            </span>
          </h1>

          <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
            Our biometric engine analyzes video feeds entirely on your local machine using client-side WebAssembly models. No video streams, images, or raw biometric data ever leave your device.
          </p>

          {/* Technical Specs List */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 text-left">
            <div className="p-4 bg-slate-900/40 border border-slate-900 rounded-2xl flex gap-3">
              <Cpu className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-xs font-bold text-slate-200">Local WASM Models</h3>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-normal">
                  In-browser MediaPipe inference at up to 60 FPS.
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-900/40 border border-slate-900 rounded-2xl flex gap-3">
              <Database className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-xs font-bold text-slate-200">Zero Server Storage</h3>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-normal">
                  No frames are uploaded, stored, or processed on external APIs.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Interactive Verification Component */}
        <div className="flex-1 w-full max-w-md flex justify-center relative">
          {/* Subtle surrounding light trail */}
          <div className="absolute inset-0 rounded-[32px] bg-gradient-to-tr from-cyan-500/10 via-transparent to-purple-600/10 blur-xl pointer-events-none" />
          <VerificationCard />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-500 mt-auto">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 justify-center">
            <Fingerprint className="w-4 h-4 text-slate-600" />
            <span>Aegis Biometrics (Local Sandbox Mode)</span>
          </div>
          <div>
            <span>© 2026 Aegis Security Inc. All processing is local.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

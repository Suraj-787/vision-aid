import { Logo } from "@/components/Logo";
import { PrivacyNotice } from "@/components/PrivacyNotice";
import { SafetyNotice } from "@/components/SafetyNotice";
import { SessionShell } from "@/components/SessionShell";

export default function Home() {
  return (
    <>
      <header className="mx-auto flex w-full max-w-5xl items-center gap-3 px-[min(1rem,4vw)] pb-2 pt-5 sm:px-6">
        <Logo />
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold leading-tight">VisionAid</h1>
          <p className="text-caption text-muted">Understand what your camera sees.</p>
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl space-y-5 px-[min(1rem,4vw)] pb-10 pt-3 sm:px-6"
      >
        <SafetyNotice />
        <SessionShell />
        <PrivacyNotice />
      </main>
    </>
  );
}

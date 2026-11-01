import { PrivacyNotice } from "@/components/PrivacyNotice";
import { SafetyNotice } from "@/components/SafetyNotice";
import { SessionShell } from "@/components/SessionShell";

export default function Home() {
  return (
    <>
      <header className="border-b border-border">
        <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">
            Experimental prototype
          </p>
          <h1 className="text-3xl font-bold">VisionAid</h1>
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 sm:px-6"
      >
        <section aria-labelledby="about-heading" className="space-y-3">
          <h2 id="about-heading" className="text-xl font-bold">
            What it is
          </h2>
          <p>
            VisionAid is a voice and camera assistant for blind and low-vision
            people. When it is finished you will be able to ask questions such
            as &ldquo;What does this label say?&rdquo; and hear a spoken answer
            based on what the camera recently saw.
          </p>
          <p>
            It will describe what it can see, say when it is unsure, and stay
            quiet about things it cannot judge.
          </p>
        </section>

        <SafetyNotice />
        <SessionShell />
        <PrivacyNotice />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-3xl px-4 py-5 text-sm text-muted sm:px-6">
          Early build: local camera preview and microphone test only. Nothing is
          sent anywhere and AI features are not active.
        </div>
      </footer>
    </>
  );
}

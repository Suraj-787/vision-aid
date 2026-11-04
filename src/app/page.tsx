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
            VisionAid is an accessibility assistant for blind and low-vision
            people. When it is finished, you will start the camera, take one
            photo, and ask a question about it by speaking or typing, such as
            &ldquo;What does this label say?&rdquo;. VisionAid will show and
            speak an answer about that photo only.
          </p>
          <p>
            It is planned to describe scenes, read text and labels, identify
            Indian banknotes and check expiry dates. It will say when it is
            unsure and will not judge safety or give medical advice.
          </p>
        </section>

        <SafetyNotice />
        <SessionShell />
        <PrivacyNotice />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-3xl px-4 py-5 text-sm text-muted sm:px-6">
          Early build: you can capture a photo and prepare a question on your
          device, but asking the AI is not available yet. Photos and typed
          questions are not sent anywhere. Speech input uses your browser&apos;s
          speech service.
        </div>
      </footer>
    </>
  );
}

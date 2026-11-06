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
            VisionAid is an experimental accessibility assistant for blind and
            low-vision people. Start the camera, take one photo, and ask a
            question about it by speaking or typing, such as &ldquo;What does
            this label say?&rdquo;. VisionAid shows an answer about that photo
            only. It can be wrong, so it says when it is unsure.
          </p>
          <p>
            It will not judge whether anything is safe, and it does not give
            medical advice. Spoken answers and dedicated tools for expiry
            dates, banknotes and medicine labels are planned for later.
          </p>
        </section>

        <SafetyNotice />
        <SessionShell />
        <PrivacyNotice />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-3xl px-4 py-5 text-sm text-muted sm:px-6">
          Early experimental build. Tapping Ask sends your photo and question to
          Google&apos;s Gemini service to get an answer; nothing is sent
          before that. Speech input and some read-aloud voices may use your browser&apos;s online speech service.
        </div>
      </footer>
    </>
  );
}

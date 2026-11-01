export function PrivacyNotice() {
  return (
    <section
      aria-labelledby="privacy-heading"
      className="rounded-lg border border-border bg-surface p-4 sm:p-5"
    >
      <h2 id="privacy-heading" className="text-lg font-bold">
        Privacy
      </h2>
      <p className="mt-2">
        In this build, Start camera shows a preview on your device only, and
        Start microphone runs a local test that converts sound and immediately
        discards it. No camera frames or microphone audio are captured, stored
        or sent anywhere. Once live sessions are added, camera frames and
        microphone audio will be sent to the configured AI service (Google
        Gemini) while a session is active.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        <li>The camera and microphone stay off until you choose to start them.</li>
        <li>
          Stop camera and Stop microphone turn each one off and release it at
          any time.
        </li>
        <li>VisionAid does not store audio, video or transcripts.</li>
        <li>
          Test only with people who have agreed, and avoid private documents,
          screens, addresses and bystanders. Data handling can differ between
          Google API tiers, so check Google&apos;s current terms first.
        </li>
      </ul>
    </section>
  );
}

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
        discards it. Nothing is captured, stored or sent anywhere yet.
      </p>
      <p className="mt-2">
        When asking questions is added, each question will send one photo you
        take, together with your question, to Google&apos;s Gemini service
        through VisionAid&apos;s server. If you speak your question, your
        browser may send the audio to its own speech service to turn it into
        text. You will always be able to type instead.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        <li>The camera and microphone stay off until you choose to start them.</li>
        <li>
          Stop camera and Stop microphone turn each one off and release it at
          any time.
        </li>
        <li>VisionAid does not store photos, audio, questions or answers.</li>
        <li>
          Test only with people who have agreed. Avoid faces and bystanders,
          private documents, prescriptions with personal details, addresses,
          cards and screens. On Google&apos;s free tier, submitted content may
          be used to improve Google&apos;s products, so check Google&apos;s
          current terms first.
        </li>
      </ul>
    </section>
  );
}

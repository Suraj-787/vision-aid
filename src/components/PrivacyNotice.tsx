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
        The camera shows a preview on your device, and Capture photo takes one
        still that stays in your browser&apos;s memory. <strong>Nothing is sent
        until you tap Ask.</strong> When you tap Ask, VisionAid sends that photo
        and your question to Google&apos;s Gemini service, through
        VisionAid&apos;s server, to get an answer.
      </p>
      <p className="mt-2">
        VisionAid itself does not store or log your photo, question or answer,
        and discards them when you retake, cancel or leave the page. Google
        handles what it receives under its own terms and may keep it for a
        time; on the free tier it may be used to improve Google&apos;s
        products. Check Google&apos;s current terms before using VisionAid with
        anything private.
      </p>
      <p className="mt-2">
        <strong>Speech is different.</strong> If you tap Start speaking, your
        browser&apos;s own speech recognition listens, and it may send your
        voice to an external speech service (run by your browser or its
        provider) to turn it into text. VisionAid receives only the text. You
        can always type your question instead.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        <li>The camera and microphone stay off until you choose to start them.</li>
        <li>
          Stop camera and Stop microphone turn each one off and release it at
          any time.
        </li>
        <li>VisionAid does not save photos, audio, questions or answers.</li>
        <li>
          Test only with people who have agreed. Avoid faces and bystanders,
          private documents, prescriptions with personal details, addresses,
          cards and screens.
        </li>
      </ul>
    </section>
  );
}

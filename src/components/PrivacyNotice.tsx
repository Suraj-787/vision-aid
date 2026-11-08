import { Icon } from "@/components/Icon";

/**
 * Privacy and how speech works. The one fact people must always see (Ask sends the
 * photo and question to Google Gemini) is also shown beside the Ask button; this
 * panel holds the detail, collapsed so it does not crowd the main task.
 */
export function PrivacyNotice() {
  return (
    <section aria-labelledby="privacy-heading" className="card">
      <details>
        <summary className="flex min-h-14 cursor-pointer items-center gap-3 px-[min(1rem,4vw)] py-2 font-bold sm:px-5">
          <Icon name="shield-check" className="text-primary" />
          <h2 id="privacy-heading" className="flex-1 text-base font-bold">
            Privacy and how your data is used
          </h2>
          <Icon name="chevron-down" size={0.9} className="chevron" />
        </summary>
        <div className="space-y-3 border-t border-border px-[min(1rem,4vw)] pb-5 pt-4 sm:px-5">
          <p>
            The camera shows a preview on your device, and Capture photo takes one still that stays
            in your browser&apos;s memory. <strong>Nothing is sent until you tap Ask.</strong> When
            you tap Ask, VisionAid sends that photo and your question to Google&apos;s Gemini
            service, through VisionAid&apos;s server, to get an answer.
          </p>
          <p>
            VisionAid itself does not store or log your photo, question or answer, and discards
            them when you retake, cancel or leave the page. Its server keeps only short status
            lines (how long a request took and the photo&apos;s size, never
            anything about your question or the answer), and a hosting provider may log basic request details such as the time
            and network address. Google handles what it receives under its own terms and may keep
            it for a time; on the free tier it may be used to improve Google&apos;s products. Check
            Google&apos;s current terms before using VisionAid with anything private.
          </p>
          <p>
            <strong>Speech is different.</strong> If you tap Start speaking, your browser&apos;s
            own speech recognition listens, and it may send your voice to an external speech
            service (run by your browser or its provider) to turn it into text. VisionAid receives
            only the text. You can always type your question instead.
          </p>
          <p>
            <strong>Reading answers aloud</strong> uses your device&apos;s own voices, only when
            you tap Listen. Some voices run through an online service run by your browser or device
            maker, which would then receive the answer text. VisionAid does not store or log what
            is spoken. If you choose Hindi or Kannada, the language you chose is sent with your
            photo and question to Google&apos;s Gemini service so it can answer in that language.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>The camera and microphone stay off until you choose to start them.</li>
            <li>Stop camera and Stop microphone turn each one off and release it at any time.</li>
            <li>VisionAid does not save photos, audio, questions or answers.</li>
            <li>
              Your four accessibility settings (voice mode, reading answers aloud, voice commands, asking by voice) are saved in this
              browser so you do not have to choose them again. Nothing else is saved.
            </li>
            <li>
              Test only with people who have agreed. Avoid faces and bystanders, private documents,
              prescriptions with personal details, addresses, cards and screens.
            </li>
          </ul>
        </div>
      </details>
    </section>
  );
}

/**
 * Spoken guidance for voice-guided mode (Milestone 9): short sentences in the
 * language the person chose, one per workflow event.
 *
 * REVIEW STATUS: the English text is the reference. The Hindi and Kannada sentences
 * were written for this milestone WITHOUT review by a native speaker; they use plain
 * words and short sentences, but their naturalness and meaning must be checked by
 * native speakers before they are relied on. They contain no Latin letters, so each is
 * read entirely by a Hindi or Kannada voice (never mixed with an English voice), and the
 * product name is written in the target script.
 */
import type { SupportedLang } from "@/lib/speech/types";

export const GUIDANCE_EVENTS = [
  "welcome",
  "camera-ready",
  "camera-error",
  "photo-captured",
  "photo-attention",
  "question-step",
  "listening",
  "processing",
  "answer-ready",
  "failed",
] as const;

export type GuidanceEvent = (typeof GUIDANCE_EVENTS)[number];

const TEXT: Record<SupportedLang, Record<GuidanceEvent, string>> = {
  "en-IN": {
    welcome: "Welcome to VisionAid. Voice guidance is on. Choose Start camera to begin.",
    "camera-ready": "Camera is ready. You can capture a photo.",
    "camera-error": "The camera is not available. Check the camera permission, then try again.",
    "photo-captured": "Photo captured.",
    "photo-attention": "The photo may be unclear. You can retake it, or continue.",
    "question-step": "You can now ask your question.",
    listening: "Listening. Speak your question.",
    processing: "Processing your question.",
    "answer-ready": "Your answer is ready.",
    failed: "Unable to get an answer. You can try again.",
  },
  "hi-IN": {
    welcome: "विज़नएड में आपका स्वागत है। आवाज़ मार्गदर्शन चालू है। शुरू करने के लिए कैमरा शुरू करें चुनें।",
    "camera-ready": "कैमरा तैयार है। आप फ़ोटो ले सकते हैं।",
    "camera-error": "कैमरा उपलब्ध नहीं है। कैमरे की अनुमति जाँचें और फिर से कोशिश करें।",
    "photo-captured": "फ़ोटो ले ली गई है।",
    "photo-attention": "फ़ोटो साफ़ नहीं हो सकती। आप दोबारा फ़ोटो ले सकते हैं या आगे बढ़ सकते हैं।",
    "question-step": "अब आप अपना सवाल पूछ सकते हैं।",
    listening: "सुन रहा हूँ। अपना सवाल बोलिए।",
    processing: "आपके सवाल पर काम हो रहा है।",
    "answer-ready": "आपका जवाब तैयार है।",
    failed: "जवाब नहीं मिल सका। आप फिर से कोशिश कर सकते हैं।",
  },
  "kn-IN": {
    welcome: "ವಿಷನ್‌ಎಡ್‌ಗೆ ಸ್ವಾಗತ. ಧ್ವನಿ ಮಾರ್ಗದರ್ಶನ ಆನ್ ಆಗಿದೆ. ಪ್ರಾರಂಭಿಸಲು ಕ್ಯಾಮೆರಾ ಪ್ರಾರಂಭಿಸಿ ಆಯ್ಕೆಮಾಡಿ.",
    "camera-ready": "ಕ್ಯಾಮೆರಾ ಸಿದ್ಧವಾಗಿದೆ. ನೀವು ಫೋಟೋ ತೆಗೆಯಬಹುದು.",
    "camera-error": "ಕ್ಯಾಮೆರಾ ಲಭ್ಯವಿಲ್ಲ. ಕ್ಯಾಮೆರಾ ಅನುಮತಿಯನ್ನು ಪರಿಶೀಲಿಸಿ ಮತ್ತು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    "photo-captured": "ಫೋಟೋ ತೆಗೆಯಲಾಗಿದೆ.",
    "photo-attention": "ಫೋಟೋ ಸ್ಪಷ್ಟವಾಗಿಲ್ಲದಿರಬಹುದು. ನೀವು ಮತ್ತೆ ಫೋಟೋ ತೆಗೆಯಬಹುದು ಅಥವಾ ಮುಂದುವರಿಯಬಹುದು.",
    "question-step": "ಈಗ ನೀವು ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಕೇಳಬಹುದು.",
    listening: "ಕೇಳುತ್ತಿದ್ದೇನೆ. ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಹೇಳಿ.",
    processing: "ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಸಂಸ್ಕರಿಸಲಾಗುತ್ತಿದೆ.",
    "answer-ready": "ನಿಮ್ಮ ಉತ್ತರ ಸಿದ್ಧವಾಗಿದೆ.",
    failed: "ಉತ್ತರ ಪಡೆಯಲಾಗಲಿಲ್ಲ. ನೀವು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಬಹುದು.",
  },
};

export function guidanceText(event: GuidanceEvent, lang: SupportedLang): string {
  return TEXT[lang][event];
}

/**
 * The photo-captured guidance as one utterance: "Photo captured." then, when the quality
 * check found something, the advisory; and always the next step.
 */
export function photoGuidance(lang: SupportedLang, needsAttention: boolean): string {
  const parts = [guidanceText("photo-captured", lang)];
  if (needsAttention) parts.push(guidanceText("photo-attention", lang));
  parts.push(guidanceText("question-step", lang));
  return parts.join(" ");
}

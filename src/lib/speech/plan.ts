/**
 * Turns spoken segments into the utterances to play, choosing a voice per
 * language and recording what could not be spoken. Pure and tested without a
 * browser. Nothing is ever spoken with a voice for a different language.
 */
import { chunkForSpeech, type SpokenSegment } from "@/lib/speech/spoken-text";
import { langInfo } from "@/lib/speech/types";
import { pickVoice, type VoiceLike } from "@/lib/speech/voices";

export interface PlannedChunk<V extends VoiceLike = VoiceLike> {
  text: string;
  lang: string;
  voice: V;
}

export interface PlaybackPlan<V extends VoiceLike = VoiceLike> {
  chunks: PlannedChunk<V>[];
  /** Segments for which no voice exists; they are not read aloud. */
  skipped: SpokenSegment[];
  /** Plain-language notes for the user (voice fallbacks, skipped text, online voices). */
  notes: string[];
}

export function planPlayback<V extends VoiceLike>(
  segments: readonly SpokenSegment[],
  voices: readonly V[],
): PlaybackPlan<V> {
  const chunks: PlannedChunk<V>[] = [];
  const skipped: SpokenSegment[] = [];
  const notes: string[] = [];
  const noted = new Set<string>();
  const note = (text: string) => {
    if (!noted.has(text)) {
      noted.add(text);
      notes.push(text);
    }
  };

  for (const segment of segments) {
    const language = langInfo(segment.lang).englishName;
    const match = pickVoice(voices, segment.lang);
    if (!match.voice) {
      skipped.push(segment);
      note(`No ${language} voice is installed on this device, so the ${language} part of this answer is not read aloud. It is shown as text.`);
      continue;
    }
    if (match.kind === "same-language") {
      note(`Using the voice "${match.voice.name}" (${match.voice.lang}) for ${language}.`);
    }
    if (!match.voice.localService) {
      note(`The voice "${match.voice.name}" may use an online service, so the text it reads may leave this device.`);
    }
    if (segment.mixed) {
      note(`Part of this ${language} text is in another script, which the ${language} voice may not read correctly.`);
    }
    for (const text of chunkForSpeech(segment.text)) {
      chunks.push({ text, lang: match.voice.lang, voice: match.voice });
    }
  }
  return { chunks, skipped, notes };
}

interface AlternativeLike {
  transcript: string;
}

/** Structural subset of SpeechRecognitionResult so this is testable in Node. */
export interface ResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: AlternativeLike;
}

/**
 * Joins the best alternative of every result into one transcript. `isFinal` is
 * true only when every result is final.
 */
export function collectTranscript(results: ArrayLike<ResultLike>): {
  text: string;
  isFinal: boolean;
} {
  let text = "";
  let isFinal = results.length > 0;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.length > 0) text += result[0].transcript;
    if (!result.isFinal) isFinal = false;
  }
  return { text: text.replace(/\s+/g, " ").trim(), isFinal };
}

/**
 * Hindi (Devanagari) and Kannada safety checks, the counterpart of the English
 * patterns in safety.ts (Milestone 7). When a user asks for an answer in Hindi or
 * Kannada, the AI's own sentences must still be unable to say that a route is
 * safe, that a banknote is genuine or fake, that a medicine should be taken, or
 * that a product is safe to use.
 *
 * IMPORTANT LIMITS. These are short word lists written without review by a
 * native speaker, and they are matched as plain substrings (word boundaries do
 * not exist for these scripts in JavaScript regular expressions). They are a
 * conservative safety net, not a guarantee: they can miss other phrasings and
 * they can remove a harmless sentence (which VisionAid then reports). Hindi and
 * Kannada phrasing should be reviewed by native speakers before relying on this
 * (see docs/testing-checklist.md).
 */

const DEVANAGARI = /[ऀ-ॿ]/;
const KANNADA = /[ಀ-೿]/;

export const hasIndicScript = (text: string): boolean => DEVANAGARI.test(text) || KANNADA.test(text);

/** "cannot / not possible" in either language: turns a sentence into a refusal. */
const REFUSAL =
  /(?:नहीं[^।.!?\n]{0,25}सकत|सकत[^।.!?\n]{0,12}नहीं|नहीं\s*बता|नहीं\s*कह|संभव\s*नहीं|ಸಾಧ್ಯವಿಲ್ಲ|ಸಾಧ್ಯವಾಗುವುದಿಲ್ಲ|ಹೇಳಲಾಗುವುದಿಲ್ಲ|ಹೇಳಲಾಗದು|ಆಗುವುದಿಲ್ಲ)/;

// ---- navigation / mobility
const PLACE_WORD =
  /(?:सड़क|सडक|रास्त|रास्ता|क्रॉसिंग|सीढ़ी|सीढ़ियाँ|सीढ़ियां|दरवाज़|दरवाज|गलियारा|पैदल|ರಸ್ತೆ|ದಾರಿ|ಮೆಟ್ಟಿಲ|ಬಾಗಿಲ|ಕ್ರಾಸಿಂಗ್|ಕಾಲುದಾರಿ)/;
const CLEAR_WORD = /(?:सुरक्षित|साफ़|साफ|खाली|ठीक है|ಸುರಕ್ಷಿತ|ಖಾಲಿ|ಸ್ಪಷ್ಟವಾಗಿದೆ|ಸ್ವಚ್ಛ)/;
const NO_OBSTACLE = /(?:बाधा|रुकावट|ख़तरा|खतरा|ಅಡೆತಡೆ|ಅಡ್ಡಿ|ಅಪಾಯ)[^।.!?\n]{0,18}(?:नहीं|नही|ಇಲ್ಲ)/;
const MAY_PROCEED =
  /(?:पार\s*कर\s*सकत|आगे\s*बढ़\s*सकत|आगे\s*बढ\s*सकत|चल\s*सकत|जा\s*सकत[^।.!?\n]{0,10}सुरक्षित|ದಾಟಬಹುದು|ನಡೆಯಬಹುದು|ಮುಂದುವರಿಯಬಹುದು|ಮುಂದೆ\s*ಹೋಗಬಹುದು)/;

export function makesNavigationClaimIndic(sentence: string): boolean {
  if (!hasIndicScript(sentence) || REFUSAL.test(sentence)) return false;
  return (
    (PLACE_WORD.test(sentence) && CLEAR_WORD.test(sentence)) ||
    NO_OBSTACLE.test(sentence) ||
    MAY_PROCEED.test(sentence)
  );
}

// ---- medicine
const MEDICINE_WORD =
  /(?:दवा|दवाई|गोली|टैबलेट|कैप्सूल|खुराक|सिरप|इंजेक्शन|मरहम|ಔಷಧ|ಮಾತ್ರೆ|ಕ್ಯಾಪ್ಸೂಲ್|ಡೋಸ್|ಸಿರಪ್|ಚುಚ್ಚುಮದ್ದು)/;
const ADVICE_WORD =
  /(?:चाहिए|चाहिये|खाएँ|खाएं|लें|लीजिए|लीजिये|सकते\s*हैं|सकती\s*हैं|सलाह|सुझाव|सुरक्षित|उपयुक्त|उचित|इलाज|ठीक\s*करत|दिन\s*में\s*\S+\s*बार|ತೆಗೆದುಕೊಳ್ಳಿ|ತೆಗೆದುಕೊಳ್ಳಬೇಕು|ತೆಗೆದುಕೊಳ್ಳಬಹುದು|ಸೇವಿಸಿ|ಸೇವಿಸಬಹುದು|ಸುರಕ್ಷಿತ|ಸೂಕ್ತ|ಸಲಹೆ|ಗುಣಪಡಿಸ|ಚಿಕಿತ್ಸೆ)/;
const DIRECT_ADVICE_IND =
  /(?:आप[^।.!?\n]{0,40}(?:चाहिए|चाहिये|सकते\s*हैं|लें|खाएँ|खाएं)|ನೀವು[^.!?\n]{0,40}(?:ತೆಗೆದುಕೊಳ್ಳ|ಸೇವಿಸ|ಬಹುದು|ಬೇಕು))/;
const LABEL_WORD = /(?:लेबल|पैकेट|डिब्बे|डिब्बा|पट्टी|बोतल|छपा|छपी|लिखा|लिखी|कहता|कहती|बताता|बताती|ಲೇಬಲ್|ಪ್ಯಾಕೆಟ್|ಡಬ್ಬ|ಮುದ್ರಿತ|ಬರೆದಿದೆ|ಹೇಳುತ್ತದೆ|ತಿಳಿಸುತ್ತದೆ)/;

export function givesMedicalAdviceIndic(sentence: string): boolean {
  if (!hasIndicScript(sentence) || !MEDICINE_WORD.test(sentence) || REFUSAL.test(sentence)) return false;
  if (DIRECT_ADVICE_IND.test(sentence)) return true; // addressed to the user: never acceptable, even with a label mentioned
  if (LABEL_WORD.test(sentence)) return false;
  return ADVICE_WORD.test(sentence);
}

// ---- banknote authenticity
const AUTHENTICITY_IND = /(?:असली|नकली|जाली|प्रामाणिक|प्रमाणित|ನಕಲಿ|ಅಸಲಿ|ಖೋಟಾ|ನಿಜವಾದ\s*ನೋಟು|ಅಸಲು)/;

export function claimsAuthenticityIndic(sentence: string): boolean {
  return hasIndicScript(sentence) && !REFUSAL.test(sentence) && AUTHENTICITY_IND.test(sentence);
}

// ---- product safety
const PRODUCT_SAFETY_IND = [
  /(?:खाने|खाना|उपयोग|इस्तेमाल|सेवन|पीने)[^।.!?\n]{0,20}सुरक्षित/,
  /(?:अभी\s*भी|अब\s*भी)[^।.!?\n]{0,12}(?:ठीक|अच्छा|अच्छी|इस्तेमाल|खा)/,
  /नुकसान\s*(?:नहीं|नही)/,
  /(?:ಬಳಸಲು|ತಿನ್ನಲು|ಸೇವಿಸಲು|ಕುಡಿಯಲು)[^.!?\n]{0,20}ಸುರಕ್ಷಿತ/,
  /ಇನ್ನೂ[^.!?\n]{0,12}(?:ಒಳ್ಳೆಯದು|ಬಳಸಬಹುದು|ಚೆನ್ನಾಗಿ)/,
  /ಹಾನಿ[^.!?\n]{0,12}(?:ಮಾಡುವುದಿಲ್ಲ|ಇಲ್ಲ)/,
];

export function claimsProductSafetyIndic(sentence: string): boolean {
  if (!hasIndicScript(sentence) || REFUSAL.test(sentence)) return false;
  return PRODUCT_SAFETY_IND.some((re) => re.test(sentence));
}

// ---- a statement of whether something has expired (replaced by the app's own comparison)
const EXPIRY_CONCLUSION_IND = [
  /समाप्त(?!ि)/, // "समाप्ति" (expiry, as in a printed label) is not a conclusion
  /एक्सपायर/,
  /अवधि\s*(?:खत्म|पार|बीत)/,
  /(?:अभी|अब\s*तक)[^।.!?\n]{0,12}वैध/,
  /ಅವಧಿ[^.!?\n]{0,14}(?:ಮುಗಿ|ಮೀರಿ|ಕಳೆ)/,
  /ಎಕ್ಸ್‌?ಪೈರ್/,
];

export function statesExpiryConclusionIndic(sentence: string): boolean {
  return hasIndicScript(sentence) && EXPIRY_CONCLUSION_IND.some((re) => re.test(sentence));
}

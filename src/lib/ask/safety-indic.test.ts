import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  claimsAuthenticity,
  claimsProductSafety,
  givesMedicalAdvice,
  makesNavigationClaim,
  sanitizeProse,
  statesExpiryConclusion,
} from "./safety.ts";

// Simple test sentences written for these tests (not reviewed by a native speaker).
// They check that the guards cover Hindi and Kannada at all; real phrasing needs review.

describe("Hindi and Kannada: navigation claims are removed", () => {
  const claims = [
    "सड़क साफ़ है, आप पार कर सकते हैं।",
    "यह रास्ता सुरक्षित है।",
    "सामने कोई बाधा नहीं है।",
    "आप आगे बढ़ सकते हैं।",
    "ರಸ್ತೆ ಸುರಕ್ಷಿತವಾಗಿದೆ.",
    "ಮುಂದೆ ಯಾವುದೇ ಅಡೆತಡೆ ಇಲ್ಲ.",
    "ನೀವು ರಸ್ತೆ ದಾಟಬಹುದು.",
  ];
  for (const sentence of claims) it(`flags: ${sentence}`, () => assert.equal(makesNavigationClaim(sentence), true));

  it("keeps a refusal and an ordinary description", () => {
    assert.equal(makesNavigationClaim("मैं यह नहीं बता सकता कि रास्ता सुरक्षित है या नहीं।"), false);
    assert.equal(makesNavigationClaim("ರಸ್ತೆ ಸುರಕ್ಷಿತವೇ ಎಂದು ಹೇಳಲು ಸಾಧ್ಯವಿಲ್ಲ."), false);
    assert.equal(makesNavigationClaim("तस्वीर में एक सफेद डिब्बा मेज़ पर रखा है।"), false);
    assert.equal(makesNavigationClaim("ಚಿತ್ರದಲ್ಲಿ ಮೇಜಿನ ಮೇಲೆ ಒಂದು ಬಿಳಿ ಪೆಟ್ಟಿಗೆ ಇದೆ."), false);
  });
});

describe("Hindi and Kannada: medicine advice is removed, label reading is kept", () => {
  it("flags advice and dosing addressed to the user", () => {
    assert.equal(givesMedicalAdvice("आपको यह दवा दिन में दो बार लेनी चाहिए।"), true);
    assert.equal(givesMedicalAdvice("यह गोली आपके लिए सुरक्षित है।"), true);
    assert.equal(givesMedicalAdvice("ನೀವು ಈ ಮಾತ್ರೆಯನ್ನು ದಿನಕ್ಕೆ ಎರಡು ಬಾರಿ ತೆಗೆದುಕೊಳ್ಳಬೇಕು."), true);
    assert.equal(givesMedicalAdvice("ಈ ಔಷಧ ನಿಮಗೆ ಸೂಕ್ತ."), true);
  });

  it("keeps sentences that report what is printed, and refusals", () => {
    assert.equal(givesMedicalAdvice("दवा के पैकेट पर लिखा है: पैरासिटामोल 500 एमजी।"), false);
    assert.equal(givesMedicalAdvice("ಔಷಧದ ಪ್ಯಾಕೆಟ್ ಮೇಲೆ ಪ್ಯಾರಾಸಿಟಮಾಲ್ 500 ಎಂಜಿ ಎಂದು ಮುದ್ರಿತವಾಗಿದೆ."), false);
    assert.equal(givesMedicalAdvice("मैं दवा की खुराक के बारे में सलाह नहीं दे सकता।"), false);
    assert.equal(givesMedicalAdvice("ಔಷಧದ ಡೋಸ್ ಬಗ್ಗೆ ಸಲಹೆ ನೀಡಲು ಸಾಧ್ಯವಿಲ್ಲ."), false);
  });
});

describe("Hindi and Kannada: banknote authenticity claims are removed", () => {
  it("flags genuine / fake claims", () => {
    for (const s of ["यह नोट असली है।", "यह नोट नकली नहीं है।", "ಇದು ನಕಲಿ ನೋಟು.", "ಈ ನೋಟು ಅಸಲಿ."]) {
      assert.equal(claimsAuthenticity(s), true, s);
    }
  });
  it("keeps a refusal", () => {
    assert.equal(claimsAuthenticity("मैं यह नहीं बता सकता कि नोट असली है या नकली।"), false);
    assert.equal(claimsAuthenticity("ನೋಟು ನಕಲಿಯೇ ಅಸಲಿಯೇ ಎಂದು ಹೇಳಲು ಸಾಧ್ಯವಿಲ್ಲ."), false);
  });
});

describe("Hindi and Kannada: product safety claims are removed", () => {
  it("flags safe-to-use claims", () => {
    for (const s of ["इसे खाना सुरक्षित है।", "यह अभी भी ठीक है।", "इससे कोई नुकसान नहीं होगा।", "ಇದನ್ನು ಬಳಸಲು ಸುರಕ್ಷಿತ.", "ಇದು ಹಾನಿ ಮಾಡುವುದಿಲ್ಲ."]) {
      assert.equal(claimsProductSafety(s), true, s);
    }
  });
  it("keeps refusals and date reports", () => {
    assert.equal(claimsProductSafety("मैं यह नहीं बता सकता कि इसे खाना सुरक्षित है या नहीं।"), false);
    assert.equal(claimsProductSafety("पैकेट पर समाप्ति तिथि 08/2027 छपी है।"), false);
  });
});

describe("Hindi and Kannada: expiry conclusions are recognised so the app's own comparison is used", () => {
  it("flags conclusions but not the printed label word", () => {
    assert.equal(statesExpiryConclusion("यह समाप्त हो चुका है।"), true);
    assert.equal(statesExpiryConclusion("यह एक्सपायर हो गया है।"), true);
    assert.equal(statesExpiryConclusion("ಅವಧಿ ಮುಗಿದಿದೆ."), true);
    assert.equal(statesExpiryConclusion("समाप्ति तिथि 08/2027 छपी है।"), false);
    assert.equal(statesExpiryConclusion("ಮುಕ್ತಾಯ ದಿನಾಂಕ 08/2027 ಎಂದು ಮುದ್ರಿತವಾಗಿದೆ."), false);
  });
});

describe("sanitizeProse with Hindi and Kannada text", () => {
  it("removes only the offending sentence and reports why", () => {
    const out = sanitizeProse("तस्वीर में एक सड़क दिखती है। सड़क साफ़ है, आप पार कर सकते हैं।");
    assert.equal(out.text, "तस्वीर में एक सड़क दिखती है।");
    assert.deepEqual(out.triggered, ["navigation"]);
  });

  it("splits Hindi sentences at the danda", () => {
    const out = sanitizeProse("यह नोट असली है। नोट पर 500 छपा है।");
    assert.equal(out.text, "नोट पर 500 छपा है।");
    assert.deepEqual(out.triggered, ["authenticity"]);
  });

  it("English-only text behaves exactly as before", () => {
    const out = sanitizeProse("A white box. The road is clear.");
    assert.equal(out.text, "A white box.");
  });
});

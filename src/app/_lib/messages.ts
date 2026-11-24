/**
 * Fixed Icelandic messages for result codes in the URL. Only codes listed
 * here are shown; anything else in the query string is ignored (no reflected
 * text). Generic on purpose: no message reveals whether an account exists.
 */
const MESSAGES: Record<string, { text: string; tone: "info" | "error" }> = {
  // sign-up
  "check-email": {
    tone: "info",
    text: "Takk! Ef netfangið er gilt færðu tölvupóst með hlekk til að staðfesta það og ljúka skráningu.",
  },
  "invalid-input": {
    tone: "error",
    text: "Athugaðu að nafn, netfang og lykilorð séu rétt útfyllt.",
  },
  "too-short": { tone: "error", text: "Lykilorðið þarf að vera að minnsta kosti 12 stafir." },
  "too-long": { tone: "error", text: "Lykilorðið má mest vera 128 stafir." },
  compromised: {
    tone: "error",
    text: "Þetta lykilorð hefur birst í gagnaleka annars staðar. Veldu annað lykilorð.",
  },
  "check-unavailable": {
    tone: "error",
    text: "Ekki tókst að athuga lykilorðið. Reyndu aftur eftir smástund.",
  },
  "rate-limited": { tone: "error", text: "Of margar tilraunir. Reyndu aftur síðar." },
  error: { tone: "error", text: "Eitthvað fór úrskeiðis. Reyndu aftur eftir smástund." },
  // sign-in
  invalid: {
    tone: "error",
    text: "Innskráning tókst ekki. Athugaðu netfang og lykilorð, og að netfangið hafi verið staðfest.",
  },
  stadfest: { tone: "info", text: "Netfangið er staðfest. Nú geturðu skráð þig inn." },
  "nytt-lykilord": {
    tone: "info",
    text: "Lykilorðinu var breytt. Skráðu þig inn með nýja lykilorðinu.",
  },
  utskrad: { tone: "info", text: "Þú hefur verið skráð(ur) út." },
  "2fa-virkt": {
    tone: "info",
    text: "Tveggja þátta auðkenning er virk. Skráðu þig inn aftur með kóða úr auðkenningarappinu.",
  },
  // reset
  sent: {
    tone: "info",
    text: "Ef aðgangur er til fyrir þetta netfang höfum við sent hlekk til að velja nýtt lykilorð. Hann gildir í 15 mínútur.",
  },
  "invalid-link": {
    tone: "error",
    text: "Hlekkurinn er útrunninn eða hefur þegar verið notaður. Biddu um nýjan.",
  },
  INVALID_TOKEN: {
    tone: "error",
    text: "Hlekkurinn er útrunninn eða hefur þegar verið notaður. Biddu um nýjan.",
  },
  // settings
  ok: { tone: "info", text: "Lykilorðinu var breytt. Aðrar innskráningar voru skráðar út." },
};

export type Message = { text: string; tone: "info" | "error" };

export function messageFor(code: string | string[] | undefined): Message | null {
  if (typeof code !== "string") return null;
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code]! : null;
}

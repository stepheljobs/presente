/**
 * RA 10173 (Data Privacy Act) biometric consent notice, English + Tagalog.
 * Served to the app via GET /config/consent-notice (E3-S03) so legal can
 * revise the copy without an app release. Bump `version` on every wording
 * change — consent records reference the artifact the worker actually saw.
 */
export const CONSENT_NOTICE = {
  version: 1,
  en: `CONSENT TO COLLECT AND USE FACIAL BIOMETRIC DATA

Your employer uses the Presente app to record attendance using photos taken at the work site.

What we collect: photos of your face, and a mathematical "template" computed from them that helps the system recognize you in attendance photos.

Why: only to record your attendance and compute your pay correctly. Your face data will never be sold and never used for any other purpose.

Where it is kept: photos and templates are stored encrypted, and only authorized staff of your employer can view them.

How long: while you work here, and for a retention period after you leave (default 12 months), after which they are permanently deleted. You will keep being paid correctly even after deletion — attendance records themselves are kept.

Your rights (Republic Act 10173 — Data Privacy Act of 2012): you may ask your employer to see your data, correct it, or delete your face data at any time. Declining consent means your attendance will be recorded manually instead; you can still work and be paid.

By signing, you agree to the collection and use of your facial biometric data as described above.`,
  tl: `PAHINTULOT SA PAGKUHA AT PAGGAMIT NG FACIAL BIOMETRIC DATA

Ginagamit ng inyong employer ang Presente app para itala ang attendance gamit ang mga litratong kinukunan sa work site.

Ano ang kinokolekta: mga litrato ng inyong mukha, at isang mathematical na "template" mula sa mga ito na tumutulong sa sistema na makilala kayo sa mga attendance photo.

Bakit: para lamang itala ang inyong attendance at makalkula nang tama ang inyong sahod. Hinding-hindi ibebenta ang inyong face data at hindi gagamitin sa ibang layunin.

Saan itinatago: naka-encrypt ang mga litrato at template, at tanging awtorisadong staff ng inyong employer ang makakakita ng mga ito.

Gaano katagal: habang kayo ay nagtatrabaho rito, at sa loob ng retention period pagkatapos kayong umalis (default na 12 buwan), pagkatapos nito ay permanenteng buburahin. Tama pa rin ang inyong sahod kahit mabura na — ang attendance records mismo ay mananatili.

Ang inyong mga karapatan (Republic Act 10173 — Data Privacy Act of 2012): maaari ninyong hilingin sa inyong employer na makita ang inyong data, itama ito, o burahin ang inyong face data anumang oras. Kung tatanggi kayo, manu-manong itatala ang inyong attendance; makakapagtrabaho at masusuwelduhan pa rin kayo.

Sa paglagda, sumasang-ayon kayo sa pagkolekta at paggamit ng inyong facial biometric data ayon sa nakasaad sa itaas.`,
};

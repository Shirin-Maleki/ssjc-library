import { z } from "zod";

/**
 * The centralized ISO 639-1 registry `docs/DATA_MODEL.md` §3 always described — a
 * `code → display name` map covering the standard ISO 639-1 list, not a database
 * `languages` table (deliberately removed in the Phase 0 review) and not a narrow
 * stub of only the languages the development fixture catalog happens to use. Both
 * `books.language_code` and `book_languages.language_code` are plain `text` columns
 * validated against this map at the application layer — a real catalog record is
 * never restricted to whatever subset of languages the fixtures/seed data covers.
 *
 * Extend this map (never invent a second language list elsewhere) if a genuinely new
 * code is needed — it's the single source of truth for every language name shown
 * anywhere in the app (search filters, autocomplete, facets, Quick Edit, admin edit).
 */
export const ISO_639_1_LANGUAGE_NAMES = {
  aa: "Afar", ab: "Abkhazian", af: "Afrikaans", ak: "Akan", am: "Amharic",
  an: "Aragonese", ar: "Arabic", as: "Assamese", av: "Avaric", ay: "Aymara", az: "Azerbaijani",
  ba: "Bashkir", be: "Belarusian", bg: "Bulgarian", bi: "Bislama",
  bm: "Bambara", bn: "Bengali", bo: "Tibetan", br: "Breton", bs: "Bosnian", ca: "Catalan",
  ce: "Chechen", ch: "Chamorro", co: "Corsican", cs: "Czech",
  cv: "Chuvash", cy: "Welsh", da: "Danish", de: "German", dv: "Divehi", dz: "Dzongkha",
  ee: "Ewe", el: "Greek", en: "English", eo: "Esperanto", es: "Spanish", et: "Estonian",
  eu: "Basque", fa: "Persian", ff: "Fulah", fi: "Finnish", fj: "Fijian", fo: "Faroese",
  fr: "French", fy: "Western Frisian", ga: "Irish", gd: "Scottish Gaelic", gl: "Galician",
  gn: "Guarani", gu: "Gujarati", gv: "Manx", ha: "Hausa", he: "Hebrew", hi: "Hindi",
  ho: "Hiri Motu", hr: "Croatian", ht: "Haitian", hu: "Hungarian", hy: "Armenian",
  hz: "Herero", ia: "Interlingua", id: "Indonesian", ie: "Interlingue", ig: "Igbo",
  ii: "Sichuan Yi", ik: "Inupiaq", io: "Ido", is: "Icelandic", it: "Italian", iu: "Inuktitut",
  ja: "Japanese", jv: "Javanese", ka: "Georgian", kg: "Kongo", ki: "Kikuyu", kj: "Kuanyama",
  kk: "Kazakh", kl: "Kalaallisut", km: "Central Khmer", kn: "Kannada", ko: "Korean",
  kr: "Kanuri", ks: "Kashmiri", ku: "Kurdish", kv: "Komi", kw: "Cornish", ky: "Kirghiz",
  la: "Latin", lb: "Luxembourgish", lg: "Ganda", li: "Limburgan", ln: "Lingala", lo: "Lao",
  lt: "Lithuanian", lu: "Luba-Katanga", lv: "Latvian", mg: "Malagasy", mh: "Marshallese",
  mi: "Maori", mk: "Macedonian", ml: "Malayalam", mn: "Mongolian", mr: "Marathi",
  ms: "Malay", mt: "Maltese", my: "Burmese", na: "Nauru", nb: "Norwegian Bokmål",
  nd: "North Ndebele", ne: "Nepali", ng: "Ndonga", nl: "Dutch", nn: "Norwegian Nynorsk",
  no: "Norwegian", nr: "South Ndebele", nv: "Navajo", ny: "Nyanja", oc: "Occitan",
  oj: "Ojibwa", om: "Oromo", or: "Oriya", os: "Ossetian", pa: "Punjabi", pi: "Pali",
  pl: "Polish", ps: "Pashto", pt: "Portuguese", qu: "Quechua", rm: "Romansh", rn: "Rundi",
  ro: "Romanian", ru: "Russian", rw: "Kinyarwanda", sa: "Sanskrit", sc: "Sardinian",
  sd: "Sindhi", se: "Northern Sami", sg: "Sango", si: "Sinhala", sk: "Slovak",
  sl: "Slovenian", sm: "Samoan", sn: "Shona", so: "Somali", sq: "Albanian", sr: "Serbian",
  ss: "Swati", st: "Southern Sotho", su: "Sundanese", sv: "Swedish", sw: "Swahili",
  ta: "Tamil", te: "Telugu", tg: "Tajik", th: "Thai", ti: "Tigrinya", tk: "Turkmen",
  tl: "Tagalog", tn: "Tswana", to: "Tonga", tr: "Turkish", ts: "Tsonga", tt: "Tatar",
  tw: "Twi", ty: "Tahitian", ug: "Uighur", uk: "Ukrainian", ur: "Urdu", uz: "Uzbek",
  ve: "Venda", vi: "Vietnamese", vo: "Volapük", wa: "Walloon", wo: "Wolof", xh: "Xhosa",
  yi: "Yiddish", yo: "Yoruba", za: "Zhuang", zh: "Chinese", zu: "Zulu",
} as const;

/** Every valid ISO 639-1 code this registry recognizes — a compile-time-checked
 * union, not a database enum, so a book's language is meaningfully typed without a
 * `languages` reference table. */
export type LanguageCode = keyof typeof ISO_639_1_LANGUAGE_NAMES;

export function isLanguageCode(value: string): value is LanguageCode {
  return Object.prototype.hasOwnProperty.call(ISO_639_1_LANGUAGE_NAMES, value);
}

/** For validating a language code at an application boundary (e.g. seed/import data,
 * a future admin edit form) — a Zod schema rather than a hand-rolled check, matching
 * this project's existing validation convention (`src/lib/validation/auth.ts`). */
export const languageCodeSchema = z
  .string()
  .refine(isLanguageCode, { message: "Not a recognized ISO 639-1 language code." }) as z.ZodType<LanguageCode>;

export function getLanguageName(code: LanguageCode): string {
  return ISO_639_1_LANGUAGE_NAMES[code] ?? code;
}

/** Reverse lookup used by search-intent parsing — matches a language mentioned by
 * name in free text (e.g. "Swedish book") back to its code. */
export function findLanguageByName(name: string): LanguageCode | undefined {
  const normalized = name.trim().toLowerCase();
  const entry = (Object.entries(ISO_639_1_LANGUAGE_NAMES) as [LanguageCode, string][]).find(
    ([, label]) => label.toLowerCase() === normalized
  );
  return entry?.[0];
}

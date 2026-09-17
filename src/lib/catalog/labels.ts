import type { FictionType, Format, IllustrationStyle, VisualRealism } from "./types";

/** The one calm label for any field a real database record can legitimately have
 * left unrecorded (Phase 5 correction pass, `docs/DECISIONS.md` — "Incomplete
 * metadata is never invented"). Never used as a lookup key or a matchable value —
 * purely display text for the `undefined` case. */
export const NOT_SPECIFIED = "Not specified";

export const FORMAT_LABELS: Record<Format, string> = {
  board_book: "Board book",
  picture_book: "Picture book",
  early_reader: "Early reader",
  chapter_book: "Chapter book",
  informational_reference: "Informational / reference",
  activity_book: "Activity book",
  other: "Other",
};

export const ILLUSTRATION_STYLE_LABELS: Record<IllustrationStyle, string> = {
  photography: "Photography",
  watercolor: "Watercolor",
  collage: "Collage",
  digital_illustration: "Digital illustration",
  pencil: "Pencil",
  ink: "Ink",
  painted: "Painted",
  mixed_media: "Mixed media",
  graphic_vector: "Graphic / vector",
};

export const VISUAL_REALISM_LABELS: Record<VisualRealism, string> = {
  real_photography: "Real photography",
  realistic_illustration: "Realistic illustration",
  stylized_illustration: "Stylized illustration",
  cartoon: "Cartoon",
  abstract: "Abstract",
  mixed: "Mixed styles",
};

export const FICTION_TYPE_LABELS: Record<FictionType, string> = {
  fiction: "Fiction",
  nonfiction: "Nonfiction",
};

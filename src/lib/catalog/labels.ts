import type { FictionType, Format, IllustrationStyle, VisualRealism } from "./types";

export const FORMAT_LABELS: Record<Format, string> = {
  board_book: "Board book",
  picture_book: "Picture book",
  early_reader: "Early reader",
  chapter_book: "Chapter book",
  informational_reference: "Informational / reference",
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

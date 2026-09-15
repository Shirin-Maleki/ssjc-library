import type { Filters } from "./filters";

/**
 * Search state is URL-backed (docs/SEARCH.md) so Back works, refresh doesn't lose the
 * current search, and a link to a specific result set is shareable/debuggable. This
 * module is the only place that knows the param names — everything else works with
 * plain `{ query, filters }` values.
 */
const PARAM = {
  query: "q",
  age: "age",
  languages: "lang",
  fictionTypes: "fiction",
  categories: "category",
  formats: "format",
  illustrationStyles: "style",
  visualRealism: "realism",
  durations: "duration",
  authors: "author",
  illustrators: "illustrator",
  publishers: "publisher",
} as const;

type SearchParamsInput = URLSearchParams | Record<string, string | string[] | undefined>;

function getParam(params: SearchParamsInput, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(",").filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export function parseSearchParams(params: SearchParamsInput): { query: string; filters: Filters } {
  const query = getParam(params, PARAM.query) ?? "";
  const ageRaw = getParam(params, PARAM.age);
  const ageYears = ageRaw ? Number(ageRaw) : undefined;

  const filters: Filters = {
    ageYears: Number.isFinite(ageYears) ? ageYears : undefined,
    languages: splitList(getParam(params, PARAM.languages)),
    fictionTypes: splitList(getParam(params, PARAM.fictionTypes)),
    categories: splitList(getParam(params, PARAM.categories)),
    formats: splitList(getParam(params, PARAM.formats)),
    illustrationStyles: splitList(getParam(params, PARAM.illustrationStyles)),
    visualRealism: splitList(getParam(params, PARAM.visualRealism)),
    durations: splitList(getParam(params, PARAM.durations)),
    authors: splitList(getParam(params, PARAM.authors))?.map(decodeURIComponent),
    illustrators: splitList(getParam(params, PARAM.illustrators))?.map(decodeURIComponent),
    publishers: splitList(getParam(params, PARAM.publishers))?.map(decodeURIComponent),
  };

  return { query, filters };
}

/** Builds a query string (no leading "?") from the current query/filters — the
 * canonical way to link to or update a Find search state. */
export function buildSearchParamsString(query: string, filters: Filters): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set(PARAM.query, query);
  if (typeof filters.ageYears === "number") params.set(PARAM.age, String(filters.ageYears));

  const setList = (key: string, values: string[] | undefined) => {
    if (values && values.length > 0) params.set(key, values.map(encodeURIComponent).join(","));
  };
  setList(PARAM.languages, filters.languages);
  setList(PARAM.fictionTypes, filters.fictionTypes);
  setList(PARAM.categories, filters.categories);
  setList(PARAM.formats, filters.formats);
  setList(PARAM.illustrationStyles, filters.illustrationStyles);
  setList(PARAM.visualRealism, filters.visualRealism);
  setList(PARAM.durations, filters.durations);
  setList(PARAM.authors, filters.authors);
  setList(PARAM.illustrators, filters.illustrators);
  setList(PARAM.publishers, filters.publishers);

  return params.toString();
}

export function buildFindHref(query: string, filters: Filters): string {
  const search = buildSearchParamsString(query, filters);
  return search ? `/find?${search}` : "/find";
}

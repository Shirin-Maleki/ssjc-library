"use client";

import { CatalogErrorFallback } from "@/components/catalog/CatalogErrorFallback";

export default function BookDetailError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CatalogErrorFallback error={error} reset={reset} />;
}

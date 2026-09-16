import { bookRepository, categoryRepository } from "@/db/repositories";
import { ReadingListDetail } from "@/components/reading-lists/ReadingListDetail";

interface ListDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ListDetailPage({ params }: ListDetailPageProps) {
  const { id } = await params;
  const [catalog, categories] = await Promise.all([bookRepository.listBooks(), categoryRepository.listCategories()]);
  return <ReadingListDetail listId={id} catalog={catalog} categories={categories} />;
}

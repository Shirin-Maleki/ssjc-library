import { ReadingListDetail } from "@/components/reading-lists/ReadingListDetail";

interface ListDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ListDetailPage({ params }: ListDetailPageProps) {
  const { id } = await params;
  return <ReadingListDetail listId={id} />;
}

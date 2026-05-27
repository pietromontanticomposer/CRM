import { OutreachBatchClient } from "@/components/outreach/OutreachBatchClient";

type Params = {
  batchId: string;
};

export default async function OutreachBatchPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { batchId } = await params;
  return <OutreachBatchClient batchId={batchId} />;
}

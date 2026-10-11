import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseStrengthAxis, StrengthReportView } from "../../components/strength-report";
import { getStrengthReport } from "../../lib/strength-store";

// Evaluate publication permission at request time, never bake it into a static page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "強さの根拠 | WINS人狼競馬メモ",
  description: "補正時計・持続ペースでの前方維持・加速ラップの勝利を、独立した根拠として確認します。",
  robots: { index: false, follow: false },
};

export default async function StrengthPage({ searchParams }: {
  searchParams: Promise<{ axis?: string | string[] }>;
}) {
  if (process.env.STRENGTH_PUBLICATION_ENABLED !== "true") notFound();
  const params = await searchParams;
  const report = await getStrengthReport();
  return <StrengthReportView report={report} filter={parseStrengthAxis(params.axis)} />;
}

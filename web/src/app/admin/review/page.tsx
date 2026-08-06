import type { Metadata } from "next";
import { AdminReviewPanel } from "@/components/admin-review-panel";

export const metadata: Metadata = {
  title: "Review queue · OpenAgentHub",
};

export default function AdminReviewPage() {
  return <AdminReviewPanel />;
}
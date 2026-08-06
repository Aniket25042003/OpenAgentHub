import type { Metadata } from "next";
import AgentCatalog from "@/components/AgentCatalog";

export const metadata: Metadata = {
  title: "Browse agents · OpenAgentHub",
  description:
    "Browse the OpenAgentHub registry. Every package is signed, scanned, and shows its review, security, and permission status before you install.",
};

export default function AgentsPage() {
  return <AgentCatalog />;
}
import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard";

export const metadata: Metadata = {
  title: "Dashboard · OpenAgentHub",
};

export default function Home() {
  return <Dashboard />;
}

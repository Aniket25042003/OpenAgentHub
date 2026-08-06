import type { Metadata } from "next";
import { PublisherConsole } from "@/components/publisher-console";

export const metadata: Metadata = {
  title: "Publisher · OpenAgentHub",
};

export default function PublisherPage() {
  return <PublisherConsole />;
}
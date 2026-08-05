import type { Metadata } from "next";
import { Account } from "@/components/account";

export const metadata: Metadata = {
  title: "Account · OpenAgentHub",
};

export default function AccountPage() {
  return <Account />;
}
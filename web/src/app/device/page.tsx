import type { Metadata } from "next";
import AuthorizeDevice from "./authorize";

export const metadata: Metadata = {
  title: "Authorize device · OpenAgentHub",
};

export default function DevicePage() {
  return <AuthorizeDevice />;
}
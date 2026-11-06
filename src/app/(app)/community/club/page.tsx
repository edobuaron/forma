import { redirect } from "next/navigation";

export default function ClubPage() {
  redirect("/community?tab=gym");
}

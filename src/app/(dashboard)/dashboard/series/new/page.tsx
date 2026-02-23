import { redirect } from "next/navigation";

export default function NewSeriesRedirect() {
  redirect("/dashboard/create");
}

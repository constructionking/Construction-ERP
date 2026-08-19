import { redirect } from "next/navigation";

export default function Home() {
  // Role-aware redirect happens in (auth)/login and the role layouts.
  redirect("/login");
}

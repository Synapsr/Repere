import { Suspense } from "react";
import { LoginPage } from "@/components/auth";
export default function Page() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}

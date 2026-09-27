import { Suspense } from "react";
import { WidgetView } from "@/components/widget/WidgetView";

export const dynamic = "force-dynamic";

export default function WidgetPage() {
  return (
    <Suspense fallback={<div style={{ padding: 16, fontFamily: "system-ui" }}>Loading…</div>}>
      <WidgetView />
    </Suspense>
  );
}

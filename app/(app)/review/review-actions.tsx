"use client";

import { useTransition } from "react";
import { Check, X, Loader2 } from "lucide-react";
import { reviewFaceAction } from "./actions";

export function ReviewActions({ faceId }: { faceId: string }) {
  const [pending, startTransition] = useTransition();

  function handleReview(label: "confirmed" | "rejected" | "uncertain") {
    startTransition(async () => {
      await reviewFaceAction(faceId, label);
    });
  }

  if (pending) {
    return (
      <div className="flex justify-center py-1">
        <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="flex gap-1">
      <button
        onClick={() => handleReview("confirmed")}
        className="flex-1 btn text-[10px] p-1 bg-success/15 text-success hover:bg-success/25"
        title="Confirm face"
      >
        <Check className="w-3 h-3" />
      </button>
      <button
        onClick={() => handleReview("rejected")}
        className="flex-1 btn text-[10px] p-1 bg-danger/15 text-danger hover:bg-danger/25"
        title="Reject (false positive)"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

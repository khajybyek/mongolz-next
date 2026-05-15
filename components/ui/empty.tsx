import { Inbox } from "lucide-react";

export function Empty({ message }: { message: string }) {
  return (
    <div className="card flex flex-col items-center justify-center py-16 text-center">
      <Inbox className="w-10 h-10 text-neutral-500 mb-3" />
      <p className="text-sm text-neutral-400">{message}</p>
    </div>
  );
}

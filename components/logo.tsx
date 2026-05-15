import Image from "next/image";
import { cn } from "@/lib/utils";

export function MongolzLogo({
  size = 36,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src="/logo.png"
      alt="MONGOLZ Security"
      width={size * 2}
      height={size * 2}
      style={{ width: size, height: size }}
      className={cn("shrink-0", className)}
      quality={100}
      priority
      unoptimized
    />
  );
}

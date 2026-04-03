import { cn } from "@/lib/utils";

export function BrandWordmark({
  className,
  alt = "Lunr Studio",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src="/lunr-logo.png"
      alt={alt}
      className={cn("w-auto object-contain", className)}
    />
  );
}

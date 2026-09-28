import { IconPhone } from "@/components/admin/icons";
import { cn } from "@/lib/cn";

/** Name and phone a reporter chose to leave. Renders nothing for anonymous reports. */
export function Reporter({ name, phone, className }: { name?: string | null; phone?: string | null; className?: string }) {
  if (!name && !phone) return null;
  return (
    <span className={cn("flex items-center gap-1.5 rounded-full bg-lilac/10 px-2.5 py-1 text-lilac", className)}>
      {name && <span className="font-medium">{name}</span>}
      {name && phone && <span className="text-lilac/50">·</span>}
      {phone && (
        <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-1 font-mono hover:text-bone">
          <IconPhone width={12} height={12} />
          {phone}
        </a>
      )}
    </span>
  );
}

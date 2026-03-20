import { Eye, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface SensitivityBadgeProps {
  sensitive: boolean;
  className?: string;
}

export function SensitivityBadge({ sensitive, className }: SensitivityBadgeProps) {
  if (sensitive) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "gap-1 border-red-500/20 bg-red-500/10 text-red-400 text-[10px] font-medium",
          className,
        )}
      >
        <ShieldAlert className="h-2.5 w-2.5" />
        secret
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 border-blue-500/20 bg-blue-500/10 text-blue-400 text-[10px] font-medium",
        className,
      )}
    >
      <Eye className="h-2.5 w-2.5" />
      public
    </Badge>
  );
}

interface ScopeBadgeProps {
  scope: string;
  className?: string;
}

export function ScopeBadge({ scope, className }: ScopeBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-amber-500/20 bg-amber-500/10 text-amber-500 text-[10px] font-medium",
        className,
      )}
    >
      {scope}
    </Badge>
  );
}

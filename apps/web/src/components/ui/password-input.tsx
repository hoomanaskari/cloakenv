import { Eye, EyeOff } from "lucide-react";
import type * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface PasswordInputProps extends Omit<React.ComponentProps<"input">, "type"> {
  visible: boolean;
  onToggleVisibility: () => void;
}

export function PasswordInput({
  className,
  visible,
  onToggleVisibility,
  ...props
}: PasswordInputProps) {
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-11", className)} {...props} />
      <button
        type="button"
        aria-label={visible ? "Hide passphrase" : "Show passphrase"}
        title={visible ? "Hide passphrase" : "Show passphrase"}
        onClick={onToggleVisibility}
        className="absolute top-1/2 right-3 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

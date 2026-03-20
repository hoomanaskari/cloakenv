import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ModalTrafficLights } from "@/components/ui/modal-traffic-lights";
import { useAppStore } from "@/lib/store";
import { PreferencesSurface } from "./preferences-window";

export function PreferencesDialog() {
  const open = useAppStore((s) => s.preferencesOpen);
  const setOpen = useAppStore((s) => s.setPreferencesOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[54rem] gap-0 overflow-hidden border-border/60 bg-background p-0 shadow-[0_12px_40px_-4px_rgba(0,0,0,0.2),0_4px_16px_-2px_rgba(0,0,0,0.08)] sm:max-w-[54rem]"
      >
        <div className="flex h-[42rem] max-h-[82vh] min-h-[34rem] flex-col">
          <div className="relative shrink-0 border-b border-border/30 bg-muted/20 py-2.5">
            <div className="absolute left-4 top-1/2 -translate-y-1/2">
              <ModalTrafficLights onClose={() => setOpen(false)} />
            </div>
            <DialogTitle className="text-center text-[13px] font-medium tracking-tight">
              Preferences
            </DialogTitle>
          </div>
          <PreferencesSurface className="min-h-0 flex-1" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

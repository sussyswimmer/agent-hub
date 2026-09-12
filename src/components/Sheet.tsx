// A macOS-style sheet on Radix Dialog. Esc closes it.
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

export function Sheet({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content className="fade-in fixed left-1/2 top-16 z-50 w-[520px] max-w-[92vw] -translate-x-1/2 rounded-xl border border-card-border bg-card p-4 shadow-2xl outline-none">
          <Dialog.Title className="mb-3 text-md font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

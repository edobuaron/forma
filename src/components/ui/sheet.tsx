"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Sheet = D.Root;
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;

/** Bottom sheet on mobile, centered dialog on desktop. */
export function SheetContent({
  className, children, title, description, ...p
}: React.ComponentProps<typeof D.Content> & { title: string; description?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
      <D.Content
        className={cn(
          "fixed z-50 flex max-h-[88dvh] flex-col border bg-card shadow-xl outline-none data-[state=open]:animate-in",
          "inset-x-0 bottom-0 rounded-t-xl pb-safe",
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
          className,
        )}
        {...p}
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-border sm:hidden" />
        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
          <div>
            <D.Title className="text-[17px] font-semibold tracking-tight">{title}</D.Title>
            {description ? (
              <D.Description className="mt-0.5 text-[13px] text-muted-foreground">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          <D.Close className="-mr-1 rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

"use client";
import * as M from "@radix-ui/react-dropdown-menu";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ className, ...p }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        sideOffset={6}
        align="end"
        className={cn("z-50 min-w-[200px] rounded-md border bg-card p-1 shadow-raised data-[state=open]:animate-in", className)}
        {...p}
      />
    </M.Portal>
  );
}

export function MenuItem({ className, destructive, ...p }: React.ComponentProps<typeof M.Item> & { destructive?: boolean }) {
  return (
    <M.Item
      className={cn(
        "flex h-10 cursor-default select-none items-center gap-2.5 rounded-sm px-2.5 text-[14px] outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground",
        destructive && "text-destructive [&_svg]:text-destructive",
        className,
      )}
      {...p}
    />
  );
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-border" />;
}

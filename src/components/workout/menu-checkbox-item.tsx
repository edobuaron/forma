"use client";
import * as M from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type * as React from "react";

/** Checkable menu row styled like MenuItem; announces its on/off state. */
export function MenuCheckboxItem({ children, ...p }: React.ComponentProps<typeof M.CheckboxItem>) {
  return (
    <M.CheckboxItem
      className="flex min-h-11 cursor-default select-none items-center gap-2.5 rounded-sm px-2.5 text-[14px] outline-none data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground"
      {...p}
    >
      {children}
      <span className="ml-auto grid size-4 place-items-center">
        <M.ItemIndicator><Check className="!text-accent" strokeWidth={2.5} /></M.ItemIndicator>
      </span>
    </M.CheckboxItem>
  );
}

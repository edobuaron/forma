import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold tracking-[-0.005em] transition-[background-color,color,box-shadow,opacity,transform] duration-150 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 active:scale-[0.97] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-[0_1px_0_oklch(1_0_0/0.18)_inset,0_6px_16px_-8px_var(--primary)] hover:bg-primary-hover",
        secondary: "bg-subtle text-foreground hover:bg-input/70",
        outline: "border border-input bg-card hover:border-accent/50 hover:bg-muted",
        ghost: "hover:bg-muted text-foreground",
        quiet: "font-medium text-muted-foreground hover:text-foreground hover:bg-muted",
        danger: "text-destructive hover:bg-destructive/10",
      },
      size: {
        sm: "h-8 px-3 text-[13px] rounded-sm",
        md: "h-10 px-4",
        lg: "h-12 px-5 text-[15px] rounded-lg",
        xl: "h-14 px-6 text-[16px] rounded-lg [&_svg]:size-5",
        icon: "size-10",
        "icon-sm": "size-8 rounded-sm",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";
export { buttonVariants };

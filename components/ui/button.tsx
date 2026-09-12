import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Direction « Punch » : pilule, remplissage encre, contour 2 px. Les états (survol, pressé,
// focus clavier, désactivé) sont définis une seule fois dans app/globals.css.
const buttonVariants = cva("btn", {
  variants: {
    variant: {
      default: "primary-btn",
      destructive: "primary-btn",
      outline: "outline-btn",
      secondary: "outline-btn",
      ghost: "ghost-btn",
      link: "link-btn",
      punch: "punch-btn",
    },
    size: {
      default: "",
      xs: "btn-xs",
      sm: "btn-sm",
      lg: "btn-lg",
      icon: "btn-icon",
      "icon-xs": "btn-icon btn-xs",
      "icon-sm": "btn-icon btn-sm",
      "icon-lg": "btn-icon btn-lg",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
})

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

import * as React from "react"

import { cn } from "@/lib/utils"

// Champ « Punch » : pilule, fond crème clair, bordure 2 px encre. Le focus clavier
// utilise un contour encre contrasté défini dans app/globals.css.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn("punch-input", className)}
      {...props}
    />
  )
}

export { Input }

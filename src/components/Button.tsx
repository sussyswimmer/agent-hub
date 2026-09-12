import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const V: Record<Variant, string> = {
  primary: "bg-accent text-accent-text hover:brightness-110 disabled:opacity-40",
  secondary: "bg-input hover:bg-selection disabled:opacity-40",
  ghost: "hover:bg-input disabled:opacity-40",
  danger: "bg-sys-red text-white hover:brightness-110 disabled:opacity-40",
};

export function Button({ variant = "secondary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={`inline-flex h-7 items-center gap-1.5 rounded-mac px-2.5 text-sm font-medium transition-colors duration-150 ${V[variant]} ${className}`} {...rest} />;
}

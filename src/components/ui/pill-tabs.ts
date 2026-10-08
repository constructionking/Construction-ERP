import { cva } from "class-variance-authority";

// The shape of components/ui/primitive-pagination.tsx (16px pill track,
// 12px chips, active chip = tinted fill + tinted border) in the app's own
// slate + brand blue. Shared by every engineer page/section switcher so they
// read as one control family.

export const pillTrack = cva(
  "rounded-[16px] border border-slate-200 bg-slate-50/95 p-1",
  {
    variants: {
      floating: {
        true: "bg-white/95 shadow-lg shadow-slate-900/10 backdrop-blur supports-[backdrop-filter]:bg-white/85",
        false: "",
      },
    },
    defaultVariants: { floating: false },
  },
);

export const pillItem = cva(
  [
    "rounded-[12px] border border-transparent font-medium text-slate-500 transition-colors",
    "hover:bg-slate-100 hover:text-slate-900",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1",
  ],
  {
    variants: {
      active: {
        true: "border-brand-600/45 bg-brand-600/16 text-brand-700 hover:bg-brand-600/20 hover:text-brand-800",
        false: "",
      },
    },
    defaultVariants: { active: false },
  },
);

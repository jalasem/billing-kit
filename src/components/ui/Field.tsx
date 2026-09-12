import type { InputHTMLAttributes, ReactNode } from "react";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
}

let fieldSeq = 0;

/** A labelled text input; every field has a real `<label for>` association, never a placeholder standing in for one. */
export function Field({ label, hint, error, id, className = "", ...props }: FieldProps) {
  const inputId = id ?? `field-${(fieldSeq += 1)}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-900">
        {label}
      </label>
      <input
        id={inputId}
        {...props}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className={`rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${className}`}
      />
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {error && (
        <p id={`${inputId}-error`} className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

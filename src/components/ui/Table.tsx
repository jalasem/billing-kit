import type { ReactNode, TableHTMLAttributes } from "react";

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  caption: string;
  children: ReactNode;
}

/** A table with a (visually hidden but screen-reader-visible) caption, required on every table in the app. */
export function Table({ caption, children, className = "", ...props }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table {...props} className={`w-full text-left text-sm ${className}`}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className = "", ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th {...props} scope="col" className={`border-b border-slate-200 px-3 py-2 font-semibold text-slate-700 ${className}`}>
      {children}
    </th>
  );
}

export function Td({ children, className = "", ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td {...props} className={`border-b border-slate-100 px-3 py-2 text-slate-900 ${className}`}>
      {children}
    </td>
  );
}

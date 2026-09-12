export interface DateTimeProps {
  date: Date | string;
  className?: string;
}

/** Renders a UTC date/time with the full ISO instant as a `title` tooltip. */
export function DateTime({ date, className }: DateTimeProps) {
  const value = typeof date === "string" ? new Date(date) : date;
  const iso = value.toISOString();
  const display = `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  return (
    <time dateTime={iso} title={iso} className={className}>
      {display}
    </time>
  );
}

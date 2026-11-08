const cell = (v: string | number | boolean): string => {
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s // spreadsheet formula injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function toCsv(header: string[], rows: (string | number | boolean)[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

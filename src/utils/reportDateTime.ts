function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDraftLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-');
}

export function formatDraftLocalTime(date: Date): string {
  return [
    padDatePart(date.getHours()),
    padDatePart(date.getMinutes()),
  ].join(':');
}

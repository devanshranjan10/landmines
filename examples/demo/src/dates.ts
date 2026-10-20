import { addDays, format } from 'date-fns';

export function dueDate(start: Date, days: number): string {
  return format(addDays(start, days), 'yyyy-MM-dd');
}

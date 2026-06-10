import type { IcsCalendarData } from '../ics-calendar/types';

export interface GoogleCalendarConfig {
  calendarId?: string;
  maxEvents?: number;
  daysAhead?: number;
  label?: string;
}

// Reuse the same shape as ICS Calendar data for display
export type GoogleCalendarData = IcsCalendarData;

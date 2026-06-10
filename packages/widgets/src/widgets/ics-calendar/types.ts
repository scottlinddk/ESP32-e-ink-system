export interface IcsCalendarConfig {
  url: string;
  label?: string;       // display label, default "Calendar"
  maxEvents?: number;   // default 3
  daysAhead?: number;   // lookahead window, default 7
}

export interface IcsCalendarEvent {
  summary: string;
  timeLabel: string;    // "HH:MM" or "All day"
  isToday: boolean;
}

export interface IcsCalendarData {
  label: string;
  today: string;        // e.g. "Tue 10 Jun"
  events: IcsCalendarEvent[];
}

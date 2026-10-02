export interface MontaWidgetConfig {
  clientId: string;
  clientSecret: string;
  showChargerStatus: boolean;
  showActiveSession: boolean;
  showTodayStats: boolean;
  timeZone?: string;
}

export interface MontaChargePoint {
  id: string;
  state: string;
  name: string;
}

export interface MontaSession {
  id: string;
  energyDeliveredKwh: number | null;
  startedAt: string | null;
  durationMin: number | null;
}

export interface MontaData {
  chargePoints: MontaChargePoint[];
  activeSessions: MontaSession[];
  todayKwh: number | null;
}

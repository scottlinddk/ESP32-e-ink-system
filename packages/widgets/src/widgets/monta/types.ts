export interface MontaWidgetConfig {
  clientId: string;
  clientSecret: string;
  showChargerStatus: boolean;
  showActiveSession: boolean;
  showTodayStats: boolean;
}

export interface MontaChargePoint {
  id: string;
  state: string;
  name: string;
}

export interface MontaSession {
  id: string;
  energyDeliveredKwh: number;
  startedAt: string;
  durationMin: number;
}

export interface MontaData {
  chargePoints: MontaChargePoint[];
  activeSessions: MontaSession[];
  todayKwh: number | null;
}

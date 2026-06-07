export interface ZaptecWidgetConfig {
  username: string;
  password: string;
  showChargerStatus: boolean;
  showActiveSession: boolean;
  showInstallationInfo: boolean;
}

export interface ZaptecCharger {
  id: string;
  name: string;
  operatingMode: number; // 2=Disconnected, 3=Connected, 5=Charging, 6=Completed
}

export interface ZaptecSession {
  id: string;
  energyDeliveredKwh: number;
  startDateTime: string;
  chargerName: string;
}

export interface ZaptecData {
  chargers: ZaptecCharger[];
  activeSession: ZaptecSession | null;
  installationName: string | null;
}

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
  operatingMode: number; // 1=Disconnected, 2=Requesting, 3=Charging, 5=Finished
}

export interface ZaptecSession {
  id: string;
  energyDeliveredKwh: number | null;
  startDateTime: string | null;
  chargerName: string;
}

export interface ZaptecData {
  chargers: ZaptecCharger[];
  activeSession: ZaptecSession | null;
  installationName: string | null;
}

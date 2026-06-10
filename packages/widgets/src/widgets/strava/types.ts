export interface StravaConfig {
  goals: {
    run_km?: number;
    ride_km?: number;
    elevation_m?: number;
  };
  sport_types?: ('Run' | 'Ride')[];
}

export interface StravaGoalStat {
  sport: 'Run' | 'Ride';
  ytdDistanceKm: number;
  ytdElevationM: number;
  goalKm?: number;
}

export interface StravaData {
  athleteName: string;
  stats: StravaGoalStat[];
}

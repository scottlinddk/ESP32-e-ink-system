import { DisplayData, UserPreferences } from '@/types';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface PreviewDisplayProps {
  data: DisplayData | null | undefined;
  preferences: UserPreferences | null | undefined;
  isLoading?: boolean;
}

/**
 * Simulates a 2.13" e-ink display (250x122 physical pixels).
 * Rendered at 2x scale: 500x244px container, monochrome look.
 */
export function PreviewDisplay({ data, preferences, isLoading }: PreviewDisplayProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
        Display Preview — 2.13&quot; e-ink
      </p>

      {/* Physical frame */}
      <div
        className="relative rounded-sm border-4 border-gray-700 bg-gray-800 p-2 shadow-2xl"
        style={{ width: 516, height: 260 }}
      >
        {/* Screen bezel */}
        <div
          className="relative overflow-hidden rounded-[1px] bg-white eink-display"
          style={{ width: 500, height: 244 }}
        >
          {isLoading ? (
            <EinkLoadingScreen />
          ) : (
            <EinkScreen data={data} preferences={preferences} />
          )}
        </div>

        {/* Indicator LED */}
        <div className="absolute bottom-1 right-3 h-1.5 w-1.5 rounded-full bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.8)]" />
      </div>

      {/* Scale note */}
      <p className="text-xs text-muted-foreground">
        Rendered at 2× scale &mdash; actual device: 250×122px
      </p>
    </div>
  );
}

function EinkLoadingScreen() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="font-mono text-sm text-gray-900">Loading display data...</div>
        <div className="mt-1 font-mono text-xs text-gray-500">Please wait</div>
      </div>
    </div>
  );
}

interface EinkScreenProps {
  data: DisplayData | null | undefined;
  preferences: UserPreferences | null | undefined;
}

function EinkScreen({ data, preferences }: EinkScreenProps) {
  const showEnergy = preferences?.show_energy_price !== false;
  const showWeather = preferences?.show_weather !== false;
  const showNews = preferences?.show_news !== false;

  const hasPrice = showEnergy && data?.price;
  const hasWeather = showWeather && data?.weather;
  const hasNews = showNews && data?.news && data.news.length > 0;

  return (
    <div
      className="flex h-full flex-col bg-white text-black eink-display"
      style={{ fontFamily: "'Courier New', Courier, monospace" }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between border-b border-black px-2 py-0.5"
        style={{ fontSize: 9 }}
      >
        <span className="font-bold tracking-widest uppercase">ENERGY DISPLAY</span>
        <span className="text-gray-600">{formatTime()}</span>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left column: energy + weather */}
        <div className="flex flex-col border-r border-black" style={{ width: 160 }}>
          {/* Energy price section */}
          {hasPrice && data?.price ? (
            <div className="flex-1 border-b border-black px-2 py-1">
              <div style={{ fontSize: 8 }} className="uppercase tracking-wider text-gray-500 mb-0.5">
                ELECTRICITY
              </div>
              <div className="flex items-baseline gap-1">
                <span
                  className="font-bold leading-none tabular-nums"
                  style={{ fontSize: 28, fontFamily: "'Courier New', Courier, monospace" }}
                >
                  {data.price.now.toFixed(1)}
                </span>
                <span style={{ fontSize: 9 }} className="text-gray-600">
                  øre/kWh
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1" style={{ fontSize: 8 }}>
                <TrendIndicator trend={data.price.trend} />
                <span className="text-gray-500">avg {data.price.average.toFixed(1)}</span>
              </div>
            </div>
          ) : (
            showEnergy && (
              <div className="flex flex-1 items-center justify-center border-b border-black px-2 py-1">
                <span style={{ fontSize: 8 }} className="text-gray-400">
                  PRICE N/A
                </span>
              </div>
            )
          )}

          {/* Weather section */}
          {hasWeather && data?.weather ? (
            <div className="flex-1 px-2 py-1">
              <div style={{ fontSize: 8 }} className="uppercase tracking-wider text-gray-500 mb-0.5">
                WEATHER
              </div>
              <div className="flex items-baseline gap-0.5">
                <span
                  className="font-bold leading-none tabular-nums"
                  style={{ fontSize: 22, fontFamily: "'Courier New', Courier, monospace" }}
                >
                  {data.weather.temp}°
                </span>
                <span style={{ fontSize: 9 }} className="text-gray-600 ml-0.5">
                  C
                </span>
              </div>
              <div style={{ fontSize: 8 }} className="mt-0.5 capitalize text-gray-600">
                {data.weather.condition}
              </div>
              <div style={{ fontSize: 8 }} className="text-gray-500">
                Wind: {data.weather.windSpeed} m/s
              </div>
            </div>
          ) : (
            showWeather && (
              <div className="flex flex-1 items-center justify-center px-2 py-1">
                <span style={{ fontSize: 8 }} className="text-gray-400">
                  WEATHER N/A
                </span>
              </div>
            )
          )}
        </div>

        {/* Right column: news */}
        <div className="flex flex-1 flex-col px-2 py-1">
          {hasNews && data?.news ? (
            <>
              <div
                style={{ fontSize: 8 }}
                className="uppercase tracking-wider text-gray-500 mb-1 border-b border-gray-200 pb-0.5"
              >
                HEADLINES
              </div>
              <div className="space-y-1.5 flex-1 overflow-hidden">
                {data.news.slice(0, 3).map((item, idx) => (
                  <div key={idx} className="flex gap-1">
                    <span style={{ fontSize: 7 }} className="mt-0.5 text-gray-400 shrink-0">
                      {idx + 1}.
                    </span>
                    <p
                      style={{
                        fontSize: 8,
                        lineHeight: 1.3,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical' as const,
                        overflow: 'hidden',
                      }}
                      className="text-gray-800 font-medium"
                    >
                      {item.title}
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            showNews && (
              <div className="flex h-full items-center justify-center">
                <span style={{ fontSize: 8 }} className="text-gray-400">
                  NEWS N/A
                </span>
              </div>
            )
          )}

          {!showEnergy && !showWeather && !showNews && (
            <div className="flex h-full items-center justify-center">
              <span style={{ fontSize: 9 }} className="text-gray-400">
                No data sources enabled
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div
        className="flex items-center justify-between border-t border-black bg-black px-2 py-0.5"
        style={{ fontSize: 7 }}
      >
        <span className="text-white tracking-wider">
          REFRESH:{' '}
          {data?.nextRefresh ? `${Math.round(data.nextRefresh / 60000)}min` : '30min'}
        </span>
        <span className="text-gray-400">esp32 e-ink v1.0</span>
      </div>
    </div>
  );
}

function TrendIndicator({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  if (trend === 'up') return <TrendingUp className="h-3 w-3 text-black" />;
  if (trend === 'down') return <TrendingDown className="h-3 w-3 text-black" />;
  return <Minus className="h-3 w-3 text-gray-400" />;
}

function formatTime(): string {
  const now = new Date();
  return now.toLocaleTimeString('da-DK', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

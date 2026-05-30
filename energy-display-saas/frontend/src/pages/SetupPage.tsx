import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Zap, Wifi, Download, Terminal, CheckCircle2 } from 'lucide-react';

interface StepProps {
  number: number;
  title: string;
  badge?: string;
  children: React.ReactNode;
}

function Step({ number, title, badge, children }: StepProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
            {number}
          </div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">{title}</CardTitle>
            {badge && <Badge variant="secondary" className="text-xs">{badge}</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-md bg-gray-900 p-4 text-sm text-green-400">
      <code>{children}</code>
    </pre>
  );
}

export function SetupPage() {
  return (
    <div className="min-h-[calc(100vh-56px)] bg-muted/30">
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Terminal className="h-7 w-7" />
            Setup Guide
          </h1>
          <p className="mt-2 text-muted-foreground">
            Flash your ESP32 and connect it to your Energy Display account
          </p>
        </div>

        {/* Hardware requirements */}
        <Card className="mb-6 border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Hardware Requirements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>• ESP32 development board (any variant)</li>
              <li>• Waveshare 2.13&quot; e-Paper HAT (250×122px, SPI)</li>
              <li>• USB cable for flashing</li>
              <li>• 2.4 GHz WiFi network</li>
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Step 1 */}
          <Step number={1} title="Install Arduino IDE / PlatformIO">
            <p className="text-sm text-muted-foreground mb-3">
              Install the ESP32 board support package and required libraries.
            </p>
            <div className="space-y-2 text-sm">
              <p className="font-medium">Required libraries:</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>GxEPD2 (e-ink display driver)</li>
                <li>ArduinoJson</li>
                <li>HTTPClient (built-in ESP32)</li>
                <li>WiFi (built-in ESP32)</li>
              </ul>
            </div>
            <CodeBlock>{`# PlatformIO — platformio.ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
lib_deps =
    zinggjm/GxEPD2@^1.5.3
    bblanchon/ArduinoJson@^7.0.0`}</CodeBlock>
          </Step>

          {/* Step 2 */}
          <Step number={2} title="Get your License Key" badge="Dashboard required">
            <p className="text-sm text-muted-foreground mb-3">
              Each device needs a unique license key to authenticate with the API.
            </p>
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">From your dashboard:</p>
              <ol className="mt-2 space-y-1 list-decimal pl-5 text-muted-foreground">
                <li>Go to the Dashboard</li>
                <li>Click &ldquo;Add Device&rdquo; (coming soon)</li>
                <li>Copy your <code className="bg-muted px-1 rounded text-xs">licenseKey</code></li>
                <li>Note your <code className="bg-muted px-1 rounded text-xs">userId</code></li>
              </ol>
            </div>
          </Step>

          {/* Step 3 */}
          <Step number={3} title="Configure the firmware">
            <p className="text-sm text-muted-foreground mb-2">
              Edit <code className="bg-muted px-1 rounded text-xs">config.h</code> with your credentials:
            </p>
            <CodeBlock>{`// config.h
#define WIFI_SSID     "YourWiFiNetwork"
#define WIFI_PASSWORD "YourWiFiPassword"

#define API_BASE_URL  "https://api.yourdomain.com"
#define USER_ID       "your-user-uuid"
#define LICENSE_KEY   "your-license-key"

// Refresh interval (must match dashboard setting)
#define SLEEP_MINUTES 30`}</CodeBlock>
          </Step>

          {/* Step 4 */}
          <Step number={4} title="Wiring diagram">
            <p className="text-sm text-muted-foreground mb-3">
              Connect the Waveshare 2.13&quot; HAT to your ESP32 via SPI:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="pb-2 text-left font-medium">e-Paper Pin</th>
                    <th className="pb-2 text-left font-medium">ESP32 GPIO</th>
                    <th className="pb-2 text-left font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  {[
                    ['VCC', '3.3V', 'Power'],
                    ['GND', 'GND', 'Ground'],
                    ['DIN (MOSI)', 'GPIO 23', 'SPI Data'],
                    ['CLK (SCK)', 'GPIO 18', 'SPI Clock'],
                    ['CS', 'GPIO 5', 'Chip Select'],
                    ['DC', 'GPIO 17', 'Data/Command'],
                    ['RST', 'GPIO 16', 'Reset'],
                    ['BUSY', 'GPIO 4', 'Busy Signal'],
                  ].map(([pin, gpio, desc]) => (
                    <tr key={pin} className="border-b last:border-0">
                      <td className="py-1.5 font-mono text-xs">{pin}</td>
                      <td className="py-1.5 font-mono text-xs text-primary">{gpio}</td>
                      <td className="py-1.5 text-xs">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Step>

          {/* Step 5 */}
          <Step number={5} title="Flash and test">
            <p className="text-sm text-muted-foreground mb-2">
              Upload the firmware and open the serial monitor to verify connectivity:
            </p>
            <CodeBlock>{`[WiFi] Connecting to YourWiFiNetwork...
[WiFi] Connected! IP: 192.168.1.42
[API] Fetching display data...
[API] Got response: 200 OK
[Display] Rendering price: 142.5 øre/kWh
[Display] Rendering weather: 12°C cloudy
[Display] Rendering 3 headlines
[Display] Update complete in 2.3s
[Sleep] Deep sleep for 1800 seconds`}</CodeBlock>
            <div className="mt-3 flex items-center gap-2 text-sm text-green-600">
              <Wifi className="h-4 w-4" />
              <span className="font-medium">Your display should now update automatically every {' '}
              <span className="text-primary">30 minutes</span></span>
            </div>
          </Step>

          {/* Download firmware */}
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-6">
              <Download className="h-8 w-8 text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium">Firmware source code</p>
                <p className="text-sm text-muted-foreground">
                  Full Arduino firmware with display driver, WiFi, and HTTP client
                </p>
              </div>
              <Button variant="outline" disabled>
                Download Firmware (coming soon)
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

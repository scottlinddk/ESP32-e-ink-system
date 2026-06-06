// =========================================================================
// DocsPage.tsx
// =========================================================================
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/appContext';
import { Card } from '../components/ui/card';
import { Icon } from '../components/ui/Logo';

// ── Types ─────────────────────────────────────────────────────────────────

type Board = 'elecrow' | 'waveshare';
type OS = 'mac' | 'windows' | 'arduino';

interface FlashStep {
  icon: string;
  title: string;
  body: React.ReactNode;
}

// ── Flashing Guide content ────────────────────────────────────────────────

const EPD_LIB_STEP: FlashStep = {
  icon: 'folder_zip',
  title: 'Get the Elecrow EPD library',
  body: (
    <>
      The Elecrow display driver is not in the PlatformIO or Arduino registry — you must install it manually.
      <ol className="mt-2 mb-0 pl-4 flex flex-col gap-1 list-decimal">
        <li>
          Download or clone the{' '}
          <a
            href="https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent font-medium no-underline hover:underline"
          >
            Elecrow GitHub repo
          </a>{' '}
          (Code → Download ZIP).
        </li>
        <li>
          Inside, find the <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">EPD</code> folder under{' '}
          <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">factory_sourcecode/…/libraries/EPD/</code>
        </li>
        <li>
          Copy it into this project at{' '}
          <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">firmware/lib/EPD/</code> — PlatformIO picks it up automatically.
        </li>
      </ol>
    </>
  ),
};

function macSteps(): FlashStep[] {
  return [
    EPD_LIB_STEP,
    {
      icon: 'usb',
      title: 'Install the USB driver',
      body: (
        <>
          The Elecrow board uses a <strong>WCH CH340 / CH343</strong> USB chip.
          <ol className="mt-2 mb-0 pl-4 flex flex-col gap-1 list-decimal">
            <li>
              Download the{' '}
              <a href="https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html" target="_blank" rel="noopener noreferrer" className="text-accent font-medium no-underline hover:underline">
                WCH CH34x macOS driver
              </a>{' '}
              and run the <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">.pkg</code> installer.
            </li>
            <li>Restart your Mac (required for the kernel extension to load).</li>
            <li>Plug in the board. Run <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">ls /dev/cu.*</code> — you should see <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">/dev/cu.usbserial-…</code> or similar.</li>
          </ol>
        </>
      ),
    },
    {
      icon: 'terminal',
      title: 'Install PlatformIO',
      body: (
        <>
          PlatformIO requires Python 3.8+. Check with <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">python3 --version</code>, then:
          <pre className="mt-2 mb-0 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">pip3 install platformio</pre>
          Or install the{' '}
          <a href="https://platformio.org/platformio-ide" target="_blank" rel="noopener noreferrer" className="text-accent font-medium no-underline hover:underline">
            PlatformIO VS Code extension
          </a>{' '}
          for a GUI upload button.
        </>
      ),
    },
    {
      icon: 'settings',
      title: 'Configure the firmware',
      body: (
        <>
          <pre className="mt-0 mb-2 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">cd firmware
cp config.h.example config.h</pre>
          Open <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">firmware/config.h</code> and set your backend API URL:
          <pre className="mt-2 mb-0 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">#define PROVISION_DEFAULT_API_URL "https://your-api.vercel.app"</pre>
          WiFi credentials are entered on the device at first boot — no need to hardcode them.
        </>
      ),
    },
    {
      icon: 'upload',
      title: 'Flash the firmware',
      body: (
        <>
          From the project root:
          <pre className="mt-2 mb-2 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">npm run flash:elecrow</pre>
          Or directly with PlatformIO:
          <pre className="mt-0 mb-0 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">cd firmware && pio run -e elecrow_213 --target upload</pre>
        </>
      ),
    },
    {
      icon: 'monitor',
      title: 'Verify with the serial monitor',
      body: (
        <>
          <pre className="mt-0 mb-2 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">npm run flash:elecrow:monitor</pre>
          You should see <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">[Main] ESP32 E-Ink Display Firmware v1.0.0</code> and the display should show a loading screen.
        </>
      ),
    },
  ];
}

function windowsSteps(): FlashStep[] {
  return [
    EPD_LIB_STEP,
    {
      icon: 'usb',
      title: 'Install the USB driver',
      body: (
        <>
          <ol className="mt-0 mb-0 pl-4 flex flex-col gap-1 list-decimal">
            <li>Plug the board in via USB-C.</li>
            <li>Open <strong>Device Manager</strong> (<kbd className="font-mono bg-black/[0.07] dark:bg-white/10 px-1.5 py-0.5 rounded-sm border border-border text-xs">Win+X</kbd> → Device Manager) — look under "Ports (COM & LPT)" or "Other devices".</li>
            <li>
              Download the{' '}
              <a href="https://www.wch-ic.com/downloads/CH341SER_EXE.html" target="_blank" rel="noopener noreferrer" className="text-accent font-medium no-underline hover:underline">
                WCH CH340 Windows driver
              </a>{' '}
              and run the <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">.exe</code> installer.
            </li>
            <li>Unplug and replug the board. A <strong>COM3</strong> (or similar) port should now appear in Device Manager.</li>
          </ol>
        </>
      ),
    },
    {
      icon: 'terminal',
      title: 'Install Python and PlatformIO',
      body: (
        <>
          <ol className="mt-0 mb-0 pl-4 flex flex-col gap-1 list-decimal">
            <li>
              Download{' '}
              <a href="https://www.python.org/downloads/windows/" target="_blank" rel="noopener noreferrer" className="text-accent font-medium no-underline hover:underline">
                Python 3.10+
              </a>{' '}
              — check <strong>"Add Python to PATH"</strong> before installing.
            </li>
            <li>
              Open PowerShell and run:
              <pre className="mt-1.5 mb-0 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">pip install platformio</pre>
            </li>
          </ol>
          Or install the{' '}
          <a href="https://platformio.org/platformio-ide" target="_blank" rel="noopener noreferrer" className="text-accent font-medium no-underline hover:underline">
            PlatformIO VS Code extension
          </a>{' '}
          (recommended on Windows — avoids PATH issues).
        </>
      ),
    },
    {
      icon: 'settings',
      title: 'Configure the firmware',
      body: (
        <>
          In PowerShell:
          <pre className="mt-2 mb-2 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">copy firmware\config.h.example firmware\config.h</pre>
          Open <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">firmware\config.h</code> in Notepad or VS Code, and set your API URL:
          <pre className="mt-2 mb-0 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">#define PROVISION_DEFAULT_API_URL "https://your-api.vercel.app"</pre>
        </>
      ),
    },
    {
      icon: 'upload',
      title: 'Flash the firmware',
      body: (
        <>
          Install{' '}
          <a href="https://nodejs.org/en/download" target="_blank" rel="noopener noreferrer" className="text-accent font-medium no-underline hover:underline">Node.js</a>
          {' '}if needed, then in PowerShell:
          <pre className="mt-2 mb-2 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">npm run flash:elecrow</pre>
          PlatformIO auto-detects your COM port. If it asks, choose the COM port you confirmed in Device Manager.
        </>
      ),
    },
    {
      icon: 'monitor',
      title: 'Verify with the serial monitor',
      body: (
        <>
          <pre className="mt-0 mb-2 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">npm run flash:elecrow:monitor</pre>
          You should see <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">[Main] ESP32 E-Ink Display Firmware v1.0.0</code>. Press Ctrl+C to exit.
        </>
      ),
    },
  ];
}

function arduinoSteps(board: Board): FlashStep[] {
  const isElecrow = board === 'elecrow';
  return [
    ...(isElecrow ? [EPD_LIB_STEP] : []),
    {
      icon: 'download',
      title: 'Install Arduino IDE 2',
      body: (
        <>
          Download from{' '}
          <a href="https://www.arduino.cc/en/software" target="_blank" rel="noopener noreferrer" className="text-accent font-medium no-underline hover:underline">
            arduino.cc/en/software
          </a>{' '}
          (macOS or Windows).
        </>
      ),
    },
    {
      icon: 'developer_board',
      title: 'Add ESP32 board support',
      body: (
        <>
          <ol className="mt-0 mb-0 pl-4 flex flex-col gap-1 list-decimal">
            <li>Open <strong>File → Preferences</strong> (macOS: <strong>Arduino IDE → Preferences</strong>).</li>
            <li>
              In "Additional boards manager URLs" paste:
              <pre className="mt-1.5 mb-0 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">https://espressif.github.io/arduino-esp32/package_esp32_index.json</pre>
            </li>
            <li>Open <strong>Tools → Board → Boards Manager</strong>, search <strong>esp32</strong>, and install <strong>esp32 by Espressif</strong> version <strong>2.0.15</strong>.</li>
          </ol>
        </>
      ),
    },
    {
      icon: 'tune',
      title: 'Configure board settings',
      body: (
        <>
          Go to <strong>Tools</strong> and set:
          <table className="mt-2 mb-0 w-full text-xs border-collapse">
            <tbody>
              {isElecrow ? (
                <>
                  <tr className="border-b border-divider">
                    <td className="py-1.5 pr-4 text-fg2 whitespace-nowrap">Board</td>
                    <td className="py-1.5 font-mono">ESP32 Arduino → ESP32S3 Dev Module</td>
                  </tr>
                  <tr className="border-b border-divider">
                    <td className="py-1.5 pr-4 text-fg2 whitespace-nowrap">Partition Scheme</td>
                    <td className="py-1.5 font-mono">Huge APP (3MB No OTA/1MB SPIFFS)</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-4 text-fg2 whitespace-nowrap">PSRAM</td>
                    <td className="py-1.5 font-mono">OPI PSRAM</td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td className="py-1.5 pr-4 text-fg2 whitespace-nowrap">Board</td>
                  <td className="py-1.5 font-mono">ESP32 Arduino → ESP32 Dev Module</td>
                </tr>
              )}
            </tbody>
          </table>
          {isElecrow && (
            <>
              <br />
              Install the EPD library: copy the <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">EPD</code> folder from the Elecrow repo to:
              <pre className="mt-1.5 mb-0 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">
                {'macOS:   ~/Documents/Arduino/libraries/EPD/\nWindows: C:\\Users\\<name>\\Documents\\Arduino\\libraries\\EPD\\'}
              </pre>
            </>
          )}
        </>
      ),
    },
    {
      icon: 'usb',
      title: 'Install USB driver (if needed)',
      body: isElecrow ? (
        <>
          <strong>macOS:</strong>{' '}
          <a href="https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html" target="_blank" rel="noopener noreferrer" className="text-accent font-medium no-underline hover:underline">WCH CH34x driver</a>
          {' '}— restart after install.
          <br />
          <strong>Windows:</strong>{' '}
          <a href="https://www.wch-ic.com/downloads/CH341SER_EXE.html" target="_blank" rel="noopener noreferrer" className="text-accent font-medium no-underline hover:underline">WCH CH340 driver</a>
          {' '}— installs in seconds.
        </>
      ) : (
        <>
          <strong>macOS:</strong>{' '}
          <a href="https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html" target="_blank" rel="noopener noreferrer" className="text-accent font-medium no-underline hover:underline">WCH CH34x driver</a>
          {' '}or{' '}
          <a href="https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers" target="_blank" rel="noopener noreferrer" className="text-accent font-medium no-underline hover:underline">Silicon Labs CP210x</a>
          {' '}(depends on your ESP32 board).
          <br />
          <strong>Windows:</strong> usually auto-installed via Windows Update.
        </>
      ),
    },
    {
      icon: 'upload',
      title: 'Upload',
      body: (
        <>
          <ol className="mt-0 mb-0 pl-4 flex flex-col gap-1 list-decimal">
            <li>Open <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">firmware/src/main.ino</code> in Arduino IDE.</li>
            <li>Make sure <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">firmware/config.h</code> exists (copy from <code className="font-mono bg-black/[0.07] dark:bg-white/10 px-1 rounded-sm">config.h.example</code>).</li>
            <li>Select your port under <strong>Tools → Port</strong>.</li>
            <li>Click <strong>Upload</strong> (→ arrow button).</li>
          </ol>
          If upload times out, hold the <strong>BOOT</strong> button on the board and try again.
        </>
      ),
    },
  ];
}

function waveshareSteps(): FlashStep[] {
  return [
    {
      icon: 'usb',
      title: 'Install the USB driver',
      body: (
        <>
          Most Waveshare ESP32 boards use a <strong>CH340</strong> or <strong>CP2102</strong> chip.
          <ul className="mt-2 mb-0 pl-4 flex flex-col gap-1 list-disc">
            <li><strong>CH340 macOS:</strong> <a href="https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html" target="_blank" rel="noopener noreferrer" className="text-accent font-medium no-underline hover:underline">WCH CH34x driver</a></li>
            <li><strong>CP2102 macOS/Windows:</strong> <a href="https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers" target="_blank" rel="noopener noreferrer" className="text-accent font-medium no-underline hover:underline">Silicon Labs CP210x driver</a></li>
            <li><strong>Windows:</strong> usually auto-installs via Windows Update</li>
            <li><strong>Linux:</strong> built-in, no install needed</li>
          </ul>
        </>
      ),
    },
    {
      icon: 'terminal',
      title: 'Install PlatformIO',
      body: (
        <>
          <pre className="mt-0 mb-0 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">pip3 install platformio   # macOS / Linux
pip install platformio    # Windows PowerShell</pre>
          Or use the{' '}
          <a href="https://platformio.org/platformio-ide" target="_blank" rel="noopener noreferrer" className="text-accent font-medium no-underline hover:underline">PlatformIO VS Code extension</a>.
        </>
      ),
    },
    {
      icon: 'settings',
      title: 'Configure',
      body: (
        <>
          <pre className="mt-0 mb-0 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">cp firmware/config.h.example firmware/config.h
# Set PROVISION_DEFAULT_API_URL in config.h</pre>
        </>
      ),
    },
    {
      icon: 'upload',
      title: 'Flash',
      body: (
        <>
          <pre className="mt-0 mb-2 p-3 rounded-sm bg-black/[0.07] dark:bg-white/10 text-xs font-mono leading-relaxed overflow-x-auto">npm run flash          # build + upload
npm run flash:full     # build + upload + monitor
npm run flash:monitor  # serial monitor only</pre>
          Or use the browser-based flash tool on the <Link to="/flash" className="text-accent font-medium no-underline hover:underline">Flash page</Link>.
        </>
      ),
    },
  ];
}

// ── Tab helpers ───────────────────────────────────────────────────────────

function TabBar<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 p-1 rounded-md bg-black/[0.06] dark:bg-white/[0.07] w-fit">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={[
            'px-3 py-1.5 rounded-sm text-sm font-medium transition-colors',
            value === o.id
              ? 'bg-white dark:bg-white/10 text-fg1 shadow-[0_1px_3px_rgba(0,0,0,0.12)]'
              : 'text-fg2 hover:text-fg1',
          ].join(' ')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Tip banner ────────────────────────────────────────────────────────────

function Tip({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex gap-2.5 items-start px-3.5 py-3 rounded-sm bg-black/[0.05] dark:bg-white/[0.06] text-fg2 text-sm leading-snug [&_.material-symbols-outlined]:text-[18px] [&_.material-symbols-outlined]:flex-shrink-0 [&_.material-symbols-outlined]:mt-px">
      <Icon name={icon} />
      <span>{text}</span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export function DocsPage() {
  const app = useApp();
  const t = app.t;

  const [board, setBoard] = useState<Board>('elecrow');
  const [os, setOs] = useState<OS>('mac');

  const setupSteps = [
    { icon: 'usb', title: t.docsStep1Title, body: t.docsStep1Body },
    { icon: 'cast', title: t.docsStep2Title, body: t.docsStep2Body, link: { to: '/flash', label: t.docsFlashLink } },
    { icon: 'wifi', title: t.docsStep3Title, body: t.docsStep3Body },
    { icon: 'settings_ethernet', title: t.docsStep4Title, body: t.docsStep4Body },
    { icon: 'key', title: t.docsStep5Title, body: t.docsStep5Body },
    { icon: 'vpn_key', title: t.docsStep6Title, body: t.docsStep6Body },
    { icon: 'tune', title: t.docsStep7Title, body: t.docsStep7Body },
  ];

  const boardOptions: { id: Board; label: string }[] = [
    { id: 'elecrow', label: t.docsFlashBoardElecrow },
    { id: 'waveshare', label: t.docsFlashBoardWaveshare },
  ];

  const osOptions: { id: OS; label: string }[] = [
    { id: 'mac', label: t.docsFlashOsMac },
    { id: 'windows', label: t.docsFlashOsWin },
    { id: 'arduino', label: t.docsFlashOsArduino },
  ];

  let flashSteps: FlashStep[];
  if (board === 'waveshare') {
    flashSteps = os === 'arduino' ? arduinoSteps('waveshare') : waveshareSteps();
  } else {
    flashSteps = os === 'mac' ? macSteps() : os === 'windows' ? windowsSteps() : arduinoSteps('elecrow');
  }

  return (
    <div className="max-w-[760px] mx-auto px-6 pt-6 pb-20 animate-fade-up max-[820px]:px-4 max-[820px]:pt-5 max-[820px]:pb-16">

      {/* ── Setup overview ─────────────────────────────────────────────── */}
      <header className="mb-5">
        <h1 className="text-h2 font-light tracking-tight m-0 mb-1.5">{t.nav.docs}</h1>
        <p className="text-fg2 text-body m-0">{t.docsSub}</p>
      </header>

      <div className="flex flex-col gap-4">
        {setupSteps.map((s, i) => (
          <Card key={i} flat>
            <div className="flex gap-4 items-start">
              <div className="w-12 h-12 rounded-md bg-black/[0.10] text-fg2 flex items-center justify-center flex-shrink-0 [&_.material-symbols-outlined]:text-[24px]">
                <Icon name={s.icon} />
              </div>
              <div>
                <h3 className="text-h6 font-medium m-0 mt-0.5 mb-1">
                  {i + 1}. {s.title}
                </h3>
                <p className="text-sm text-fg2 m-0">{s.body}</p>
                {s.link && (
                  <Link
                    to={s.link.to}
                    className="inline-block mt-2 text-sm text-accent font-medium no-underline hover:underline"
                  >
                    {s.link.label} →
                  </Link>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* ── Hardware flashing guide ────────────────────────────────────── */}
      <div className="mt-10">
        <header className="mb-5">
          <h2 className="text-h3 font-light tracking-tight m-0 mb-1.5">{t.docsFlashGuideTitle}</h2>
          <p className="text-fg2 text-body m-0">{t.docsFlashGuideSub}</p>
        </header>

        {/* Board selector */}
        <div className="mb-5">
          <TabBar options={boardOptions} value={board} onChange={(b) => { setBoard(b); setOs('mac'); }} />
          <p className="mt-2 mb-0 text-xs text-fg2">
            {board === 'elecrow' ? t.docsFlashNoteElecrow : t.docsFlashNoteWaveshare}
          </p>
        </div>

        {/* OS selector */}
        <div className="mb-5">
          <TabBar options={osOptions} value={os} onChange={setOs} />
        </div>

        {/* Tips */}
        <div className="flex flex-col gap-2 mb-5">
          <Tip icon="cable" text={t.docsFlashCableTip} />
          {os === 'windows' && <Tip icon="shield" text={t.docsFlashWinDriverTip} />}
          <Tip icon="touch_app" text={t.docsFlashBootTip} />
        </div>

        {/* Steps */}
        <div className="flex flex-col gap-4">
          {flashSteps.map((s, i) => (
            <Card key={`${board}-${os}-${i}`} flat>
              <div className="flex gap-4 items-start">
                <div className="w-12 h-12 rounded-md bg-black/[0.10] text-fg2 flex items-center justify-center flex-shrink-0 [&_.material-symbols-outlined]:text-[24px]">
                  <Icon name={s.icon} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-h6 font-medium m-0 mt-0.5 mb-1.5">
                    {i + 1}. {s.title}
                  </h3>
                  <div className="text-sm text-fg2 [&_a]:text-accent [&_pre]:my-2 [&_code]:text-xs [&_ol]:text-fg2 [&_ul]:text-fg2 [&_li]:leading-relaxed">
                    {s.body}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

    </div>
  );
}

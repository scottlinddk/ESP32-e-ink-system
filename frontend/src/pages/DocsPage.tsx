import { Link } from 'react-router-dom';
import { useApp } from '../lib/appContext';
import { Card } from '../components/ui/card';

export function DocsPage() {
  const { t, lang } = useApp();
  const da = lang === 'da';
  return (
    <div className="max-w-[760px] mx-auto px-6 pt-6 pb-20">
      <h1 className="text-h2 mb-3">{t.nav.docs}</h1>
      <p className="text-fg2 mb-6">{da ? 'Opsætning af CrowPanel 2.13 med automatisk opdatering via Wi-Fi.' : 'Set up CrowPanel 2.13 for automatic updates over Wi-Fi.'}</p>
      <Card flat className="mb-5" title={t.nav.integrations}>
        <p className="text-fg2 mt-0">{t.integrationsSubtitle}</p>
        <Link to="/integrations" className="text-accent underline">{t.configureIntegrations}</Link>
      </Card>
      <Card flat>
        <h2 className="text-h5 mb-3">{da ? 'Installér og forbind displayet' : 'Install and connect the display'}</h2>
        <ol className="list-decimal pl-5 space-y-3 text-fg2">
          <li><Link to="/flash" className="text-accent underline">{da ? 'Åbn USB-installationen' : 'Open the USB installer'}</Link>. {da ? 'Brug Chrome eller Edge over HTTPS. Vælg den korrekte panelrevision: original SSD1680 eller V1.2 JD79661.' : 'Use Chrome or Edge over HTTPS. Select the matching display revision: original SSD1680 or V1.2 JD79661.'}</li>
          <li>{da ? 'Tilføj et display på Enheder. Under Automatiske opdateringer skal du oprette et token og kopiere API URL, Device UUID og token.' : 'Add a display on Devices. Under Automatic updates, create a token and copy API URL, Device UUID, and token.'}</li>
          <li>{da ? 'Forbind til ESP32-Display-XXXXXX og åbn http://192.168.4.1. Indtast 2.4 GHz Wi-Fi samt API URL, UUID og token.' : 'Join ESP32-Display-XXXXXX and open http://192.168.4.1. Enter your 2.4 GHz Wi-Fi details, API URL, UUID, and token.'}</li>
          <li>{da ? 'Forbind computeren til dit normale netværk igen. Vælg 250 × 122 i dashboardet, og gem dit layout. Opdateret firmware accepterer enhver rotation; ældre firmware kræver 0°.' : 'Reconnect your computer to your normal network. Select 250 × 122 in the dashboard and save your layout. Updated firmware accepts any rotation; older firmware requires 0°.'}</li>
        </ol>
        <p className="text-sm text-fg2 mt-4">{da ? 'Manuel Bluetooth: hold MENU nede under genstart (Waveshare: tryk BOOT inden for 3 sekunder efter at slippe reset), og vælg EInk-… fra dashboardet. Behold computerens normale internetforbindelse. Automatisk billedhentning og netværksopsætning bruger Wi-Fi.' : 'Manual Bluetooth: hold MENU while resetting (Waveshare: press BOOT within 3 seconds after releasing reset), then choose EInk-… from the dashboard. Keep your computer on its normal internet connection. Automatic image delivery and network setup use Wi-Fi.'}</p>
      </Card>
      <Card flat className="mt-5">
        <h2 className="text-h5 mb-3">{da ? 'Byg fra kildekode og fejlfinding' : 'Build from source and troubleshoot'}</h2>
        <p className="text-fg2 mb-3">{da ? 'Projektet indeholder allerede EPD-driveren. Følg firmware-guiden for de fastlagte PlatformIO-miljøer, GPIO-forbindelser, fabriksimages og manuel BOOT/RESET-gendannelse.' : 'The project includes the EPD driver. Follow the firmware guide for the pinned PlatformIO environments, GPIO wiring, factory images, and manual BOOT/RESET recovery.'}</p>
        <a className="text-accent underline" href="https://github.com/scottlinddk/ESP32-e-ink-system/tree/main/firmware" target="_blank" rel="noreferrer">{da ? 'Firmware-guide og kildekode' : 'Firmware guide and source'}</a>
      </Card>
    </div>
  );
}

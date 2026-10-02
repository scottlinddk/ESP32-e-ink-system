import { Link } from 'react-router-dom';
import { useApp } from '../lib/appContext';
import { useAuth } from '../hooks/useAuth';
import { DisplayCard } from '../components/dashboard/DisplayCard';
import { ApiKeysCard } from '../components/dashboard/ApiKeysCard';
import { CalendarCard } from '../components/dashboard/CalendarCard';
import { CustomWebhookCard } from '../components/dashboard/CustomWebhookCard';
import { Card } from '../components/ui/card';

export function IntegrationsPage() {
  const { t, lang } = useApp();
  const { user, isSignedIn } = useAuth();
  if (!isSignedIn || !user) return null;
  const da = lang === 'da';
  const providers = [
    {
      id: 'energy', name: 'Energinet', widget: t.layoutWidgetEnergy, setup: '#sources',
      text: da ? 'Kræver ingen API-nøgle. Vælg DK1 eller DK2 og spotpris eller estimeret forbrugspris. Forbrugspris kræver dit netselskabs tarif og elselskabets tillæg; moms er med, faste abonnementer er ikke.'
        : 'No API key needed. Choose DK1 or DK2 and spot or estimated consumer price. Consumer pricing needs your grid tariff and supplier markup; it includes VAT and excludes fixed subscriptions.',
      url: 'https://www.energidataservice.dk/tso-electricity/DayAheadPrices',
    },
    {
      id: 'weather', name: 'OpenWeatherMap', widget: t.layoutWidgetWeather, setup: '#credentials-openweather',
      text: da ? 'Gem en nøgle med adgang til Current Weather Data. Angiv breddegrad og længdegrad under Datakilder, og brug Test vejr. Nye nøgler kan tage et par timer at aktivere.'
        : 'Save a key with Current Weather Data access. Enter latitude and longitude under Data sources, then use Test weather. New keys may take a few hours to activate.',
      url: 'https://openweathermap.org/api/current',
    },
    {
      id: 'news', name: 'RSS / Atom · NewsAPI', widget: t.layoutWidgetNews, setup: '#sources',
      text: da ? 'Vælg et offentligt HTTPS RSS 2.0- eller Atom 1.0-feed uden nøgle, eller gem en NewsAPI-nøgle. Brug RSS til danske og finske nyheder. NewsAPI Developer er kun til udvikling/test; drift kræver en passende aftale. Feed-adresser gemmes som indstillinger: brug ikke hemmelige tokens.'
        : 'Choose a public HTTPS RSS 2.0 or Atom 1.0 feed without a key, or save a NewsAPI key. Use RSS for Danish and Finnish news. NewsAPI Developer is for development/testing only; production needs an appropriate plan. Feed URLs are saved as preferences: do not use secret tokens.',
      url: 'https://newsapi.org/pricing',
    },
    {
      id: 'monta', name: 'Monta', widget: t.srcMonta, setup: '#credentials-monta',
      text: da ? 'Opret en applikation i Monta-portalen, og gem Client ID og Client Secret. Vælg Monta og de ønskede felter under Datakilder. Kontoens adgang bestemmer, hvilke ladere og sessioner der vises.'
        : 'Create an application in the Monta portal and save its Client ID and Client Secret. Enable Monta and choose fields under Data sources. Your account access determines which chargers and sessions are available.',
      url: 'https://docs.public-api.monta.com/reference/home',
    },
    {
      id: 'zaptec', name: 'Zaptec', widget: t.srcZaptec, setup: '#credentials-zaptec',
      text: da ? 'Gem brugernavn og adgangskode til en Zaptec-konto med adgang til din lader eller installation. Aktivér Zaptec, og vælg status-, sessions- og installationsfelter under Datakilder.'
        : 'Save the username and password for a Zaptec account with access to your charger or installation. Enable Zaptec and choose status, session and installation fields under Data sources.',
      url: 'https://docs.zaptec.com/docs/getting-started',
    },
    {
      id: 'notion', name: 'Notion', widget: t.srcNotion, setup: '#credentials-notion',
      text: da ? 'Opret en intern forbindelse med læseadgang, og tilføj den til den oprindelige database i Notion. Gem en ntn_- eller secret_-token og database-ID eller link. Én datakilde vælges automatisk; ved flere skal du også kopiere datakilde-ID fra Manage data sources. Statusfilter er valgfrit og kræver en egenskab af typen Status. Aktivér derefter Notion under Datakilder.'
        : 'Create an internal connection with read access and add it to the original database in Notion. Save an ntn_ or secret_ token and database ID or link. One data source is selected automatically; for several, also copy its ID from Manage data sources. The optional filter requires a Status-type property. Then enable Notion under Data sources.',
      url: 'https://developers.notion.com/guides/get-started/internal-connections',
    },
  ];

  return <div className="max-w-[1180px] mx-auto px-6 pt-6 pb-20 animate-fade-up max-[820px]:px-4">
    <header className="mb-5">
      <h1 className="text-h2 font-light tracking-tight m-0 mb-1.5">{t.nav.integrations}</h1>
      <p className="text-fg2 text-body m-0">{t.integrationsSubtitle}</p>
    </header>
    <Card title={t.integrationSetupTitle} icon="hub">
      <ol className="list-decimal pl-5 text-sm text-fg2 space-y-2 m-0">
        <li>{t.integrationStepConnect}</li>
        <li>{t.integrationStepEnable}</li>
        <li><Link to="/layout" className="underline">{t.layoutTitle}</Link>{t.integrationStepLayout} <Link to="/dashboard" className="underline">{t.nav.home}</Link>.</li>
      </ol>
      <nav aria-label={t.integrationSections} className="flex flex-wrap gap-x-5 gap-y-2 mt-4 text-sm">
        <a href="#sources" className="underline">{t.displayTitle}</a>
        <a href="#credentials" className="underline">{t.apiTitle}</a>
        <a href="#calendar" className="underline">{da ? 'Kalender' : 'Calendar'}</a>
        <a href="#home-assistant" className="underline">Home Assistant</a>
        <a href="https://github.com/scottlinddk/ESP32-e-ink-system/blob/main/docs/INTEGRATIONS.md" target="_blank" rel="noreferrer" className="underline">{t.integrationFullGuide}</a>
      </nav>
    </Card>
    <div className="grid grid-cols-2 gap-4 mt-5 max-[820px]:grid-cols-1">
      {providers.map((provider) => <Card key={provider.id} title={provider.name} desc={`${t.integrationWidget}: ${provider.widget}`}>
        <p className="text-sm text-fg2 mt-0">{provider.text}</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <a href={provider.setup} className="underline">{t.integrationConfigure}</a>
          <a href={provider.url} target="_blank" rel="noreferrer" className="underline">{t.integrationProviderGuide}</a>
        </div>
      </Card>)}
    </div>
    <div className="grid grid-cols-2 gap-5 mt-5 items-start max-[1080px]:grid-cols-1">
      <section id="sources" className="min-w-0 scroll-mt-20" aria-label={t.displayTitle}><DisplayCard /></section>
      <section id="credentials" className="min-w-0 scroll-mt-20" aria-label={t.apiTitle}><ApiKeysCard /></section>
    </div>
    <section id="calendar" className="mt-5 scroll-mt-20" aria-label={da ? 'Kalender' : 'Calendar'}><CalendarCard /></section>
    <section id="home-assistant" className="mt-5 scroll-mt-20" aria-label="Home Assistant"><CustomWebhookCard /></section>
    <Card className="mt-5" title={t.integrationLocalWidgets}>
      <p className="text-sm text-fg2 m-0">{t.integrationLocalWidgetsHelp} <Link to="/dashboard" className="underline">{t.nav.home}</Link>.</p>
    </Card>
  </div>;
}

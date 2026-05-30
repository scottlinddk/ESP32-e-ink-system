import { Link } from 'react-router-dom';
import { SignInButton, SignUpButton } from '@clerk/clerk-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Zap,
  Cloud,
  Newspaper,
  Monitor,
  ArrowRight,
  RefreshCw,
  Shield,
  Github,
} from 'lucide-react';

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <Card className="border-2 hover:border-primary/30 transition-colors">
      <CardContent className="pt-6">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          {icon}
        </div>
        <h3 className="mb-1 font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export function HomePage() {
  const { isSignedIn } = useAuth();

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-background to-muted/30 py-20 md:py-28">
        <div className="container mx-auto px-4 text-center">
          <Badge variant="secondary" className="mb-4 gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
            Live on Energinet API
          </Badge>

          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight md:text-6xl">
            Real-time data for your{' '}
            <span className="text-primary">e-ink display</span>
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Connect your ESP32 e-ink display to live Danish electricity prices, local weather,
            and top news headlines — all on a crisp 2.13&ldquo; display.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            {isSignedIn ? (
              <Link to="/dashboard">
                <Button size="lg" className="gap-2">
                  <Monitor className="h-5 w-5" />
                  Go to Dashboard
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <>
                <SignUpButton mode="modal">
                  <Button size="lg" className="gap-2">
                    Get Started Free
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </SignUpButton>
                <SignInButton mode="modal">
                  <Button size="lg" variant="outline">
                    Sign In
                  </Button>
                </SignInButton>
              </>
            )}
          </div>

          {/* Mock display preview */}
          <div className="mt-12 flex justify-center">
            <div
              className="relative rounded-sm border-4 border-gray-700 bg-gray-800 p-2 shadow-2xl"
              style={{ width: 516, height: 260 }}
            >
              <div
                className="overflow-hidden rounded-[1px] bg-white"
                style={{
                  width: 500,
                  height: 244,
                  fontFamily: "'Courier New', Courier, monospace",
                }}
              >
                <HeroDisplayMock />
              </div>
              <div className="absolute bottom-1 right-3 h-1.5 w-1.5 rounded-full bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.8)]" />
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold">Everything on one screen</h2>
            <p className="mt-2 text-muted-foreground">
              A curated set of data widgets designed for the constraints of e-ink
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={<Zap className="h-5 w-5 text-yellow-500" />}
              title="Live Energy Prices"
              description="Danish spot prices (DK1/DK2) from Energinet — updated every 15 minutes. See the current price, 24h average, and trend arrow."
            />
            <FeatureCard
              icon={<Cloud className="h-5 w-5 text-blue-500" />}
              title="Local Weather"
              description="Current temperature, conditions, and wind speed from OpenWeatherMap. Set your exact coordinates for hyper-local data."
            />
            <FeatureCard
              icon={<Newspaper className="h-5 w-5 text-green-500" />}
              title="News Headlines"
              description="Top 3 headlines in Danish or English from NewsAPI. Stay informed without touching your phone."
            />
            <FeatureCard
              icon={<RefreshCw className="h-5 w-5 text-purple-500" />}
              title="Smart Refresh"
              description="Configure refresh intervals from 15 minutes to 2 hours. The ESP32 wakes from deep sleep, fetches data, updates the display, and sleeps again."
            />
            <FeatureCard
              icon={<Shield className="h-5 w-5 text-teal-500" />}
              title="Secure by Design"
              description="Each device has a unique license key. Auth handled by Clerk. Data cached server-side to protect your API key quotas."
            />
            <FeatureCard
              icon={<Monitor className="h-5 w-5 text-orange-500" />}
              title="Live Dashboard Preview"
              description="See exactly what your display will show before deploying. Toggle data sources and watch the preview update in real time."
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-muted/30 py-16">
        <div className="container mx-auto px-4">
          <h2 className="mb-10 text-center text-3xl font-bold">How it works</h2>
          <div className="mx-auto max-w-3xl">
            <ol className="space-y-6">
              {[
                {
                  step: '1',
                  title: 'Create your account',
                  desc: 'Sign up with email or Google. Configure which data sources to show.',
                },
                {
                  step: '2',
                  title: 'Add your API keys',
                  desc: 'Add your OpenWeatherMap and NewsAPI keys in the dashboard. Energy prices are always free.',
                },
                {
                  step: '3',
                  title: 'Flash your ESP32',
                  desc: 'Download the firmware and flash your ESP32 with your WiFi credentials and license key.',
                },
                {
                  step: '4',
                  title: 'Enjoy your display',
                  desc: 'The device wakes up, fetches fresh data from the API, updates the e-ink display, and goes back to sleep to save power.',
                },
              ].map(({ step, title, desc }) => (
                <li key={step} className="flex gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {step}
                  </div>
                  <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="text-sm text-muted-foreground">{desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold">Ready to set up your display?</h2>
          <p className="mt-2 text-muted-foreground">
            Free to use. Bring your own hardware.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            {isSignedIn ? (
              <Link to="/setup">
                <Button size="lg">
                  View Setup Guide
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <SignUpButton mode="modal">
                <Button size="lg">
                  Get Started Free
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </SignUpButton>
            )}
            <a
              href="https://github.com/ESP32-e-ink-system"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="lg" variant="outline" className="gap-2">
                <Github className="h-4 w-4" />
                View on GitHub
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row">
          <span>Energy Display &copy; {new Date().getFullYear()}</span>
          <span>
            Data: Energinet (free) &middot; OpenWeatherMap &middot; NewsAPI
          </span>
        </div>
      </footer>
    </div>
  );
}

function HeroDisplayMock() {
  return (
    <div className="flex h-full flex-col bg-white text-black">
      <div
        className="flex items-center justify-between border-b border-black px-2 py-0.5"
        style={{ fontSize: 9 }}
      >
        <span className="font-bold tracking-widest">ENERGY DISPLAY</span>
        <span className="text-gray-600">14:32</span>
      </div>
      <div className="flex flex-1">
        <div className="flex flex-col border-r border-black" style={{ width: 160 }}>
          <div className="flex-1 border-b border-black px-2 py-1">
            <div style={{ fontSize: 8 }} className="text-gray-500 mb-0.5">ELECTRICITY</div>
            <div className="flex items-baseline gap-1">
              <span style={{ fontSize: 28 }} className="font-bold leading-none">142.5</span>
              <span style={{ fontSize: 9 }} className="text-gray-600">øre/kWh</span>
            </div>
            <div style={{ fontSize: 8 }} className="mt-0.5 text-gray-500">↑ avg 118.3</div>
          </div>
          <div className="flex-1 px-2 py-1">
            <div style={{ fontSize: 8 }} className="text-gray-500 mb-0.5">WEATHER</div>
            <div className="flex items-baseline gap-0.5">
              <span style={{ fontSize: 22 }} className="font-bold leading-none">12°</span>
              <span style={{ fontSize: 9 }} className="text-gray-600 ml-0.5">C</span>
            </div>
            <div style={{ fontSize: 8 }} className="text-gray-600">cloudy</div>
            <div style={{ fontSize: 8 }} className="text-gray-500">Wind: 6 m/s</div>
          </div>
        </div>
        <div className="flex flex-1 flex-col px-2 py-1">
          <div style={{ fontSize: 8 }} className="text-gray-500 mb-1 border-b border-gray-200 pb-0.5">HEADLINES</div>
          <div className="space-y-1.5">
            {[
              'Energipriserne stiger i vinterhalvåret',
              'Nyt vejrsystem rammer Jylland i aften',
              'Solceller slår produktionsrekord i Europa',
            ].map((headline, i) => (
              <div key={i} className="flex gap-1">
                <span style={{ fontSize: 7 }} className="mt-0.5 text-gray-400 shrink-0">{i + 1}.</span>
                <p style={{ fontSize: 8, lineHeight: 1.3 }} className="text-gray-800 font-medium line-clamp-2">
                  {headline}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-black bg-black px-2 py-0.5" style={{ fontSize: 7 }}>
        <span className="text-white">REFRESH: 30min</span>
        <span className="text-gray-400">esp32 e-ink v1.0</span>
      </div>
    </div>
  );
}

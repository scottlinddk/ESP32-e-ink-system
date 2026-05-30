import { Link, useLocation } from 'react-router-dom';
import { SignInButton } from '@clerk/clerk-react';
import { Monitor, Zap } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { UserMenu } from './UserMenu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NavLinkProps {
  to: string;
  children: React.ReactNode;
  currentPath: string;
}

function NavLink({ to, children, currentPath }: NavLinkProps) {
  const isActive = currentPath === to;
  return (
    <Link
      to={to}
      className={cn(
        'text-sm font-medium transition-colors hover:text-primary',
        isActive ? 'text-primary' : 'text-muted-foreground'
      )}
    >
      {children}
    </Link>
  );
}

export function Navbar() {
  const { isSignedIn, isLoaded } = useAuth();
  const location = useLocation();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center px-4">
        {/* Logo */}
        <Link to="/" className="mr-6 flex items-center space-x-2">
          <Zap className="h-5 w-5 text-primary" />
          <span className="font-bold text-sm">Energy Display</span>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center space-x-4 lg:space-x-6">
          <NavLink to="/" currentPath={location.pathname}>
            Home
          </NavLink>
          {isSignedIn && (
            <>
              <NavLink to="/dashboard" currentPath={location.pathname}>
                Dashboard
              </NavLink>
              <NavLink to="/setup" currentPath={location.pathname}>
                Setup
              </NavLink>
            </>
          )}
        </nav>

        {/* Right side */}
        <div className="ml-auto flex items-center space-x-4">
          {isLoaded && (
            <>
              {isSignedIn ? (
                <div className="flex items-center space-x-3">
                  <Link to="/dashboard">
                    <Button variant="ghost" size="sm">
                      <Monitor className="mr-2 h-4 w-4" />
                      Dashboard
                    </Button>
                  </Link>
                  <UserMenu />
                </div>
              ) : (
                <SignInButton mode="modal">
                  <Button size="sm">Sign In</Button>
                </SignInButton>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

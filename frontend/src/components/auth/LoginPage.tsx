import { SignIn } from '@clerk/react-router';
import { useApp } from '@/lib/appContext';

export function LoginPage() {
  const { t } = useApp();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">{t.welcomeBack}</h1>
          <p className="mt-2 text-muted-foreground">{t.signInSub}</p>
        </div>
        <SignIn
          routing="path"
          path="/login"
          signUpUrl="/signup"
          fallbackRedirectUrl="/dashboard"
          appearance={{
            elements: {
              rootBox: 'w-full',
              card: 'shadow-none border rounded-lg p-6',
            },
          }}
        />
      </div>
    </div>
  );
}

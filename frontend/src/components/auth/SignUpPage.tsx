import { SignUp } from '@clerk/clerk-react';
import { useApp } from '@/lib/appContext';

export function SignUpPage() {
  const { t } = useApp();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">{t.createAccount}</h1>
          <p className="mt-2 text-muted-foreground">{t.createAccountSub}</p>
        </div>
        <SignUp
          routing="path"
          path="/signup"
          signInUrl="/login"
          afterSignUpUrl="/dashboard"
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

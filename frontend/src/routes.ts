import { type RouteConfig, route } from '@react-router/dev/routes';

export default [
  route('/flash', './pages/FlashPage.tsx'),
  route('/sso-callback', './pages/SsoCallback.tsx'),
  route('*', './App.tsx'),
] satisfies RouteConfig;

import { useNavigate } from 'react-router-dom';
import { useApp } from '../lib/appContext';

export function useNav() {
  const navigate = useNavigate();
  const { setNavOpen } = useApp();
  return (route: string) => {
    navigate('/' + route);
    setNavOpen(false);
  };
}

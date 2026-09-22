import { render, screen } from '@testing-library/react';
import SplashScreen from './SplashScreen.tsx';

describe('SplashScreen', () => {
  it('shows the shop name and a build timestamp', () => {
    render(<SplashScreen />);
    expect(screen.getByRole('heading', { name: 'ฤดูชา POS' })).toBeInTheDocument();
    expect(screen.getByText(/^build/)).toBeInTheDocument();
  });

  it('reports that the shell is not offline-ready without a controlling worker', () => {
    render(<SplashScreen />);
    expect(screen.getByText(/ยังไม่พร้อมออฟไลน์/)).toBeInTheDocument();
  });
});

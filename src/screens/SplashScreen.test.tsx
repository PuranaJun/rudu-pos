import { render, screen } from '@testing-library/react';
import SplashScreen from './SplashScreen.tsx';

describe('SplashScreen', () => {
  it('shows the shop name and a build timestamp', () => {
    render(<SplashScreen />);
    expect(screen.getByRole('heading', { name: 'ฤดูชา POS' })).toBeInTheDocument();
    expect(screen.getByText(/^build/)).toBeInTheDocument();
  });
});

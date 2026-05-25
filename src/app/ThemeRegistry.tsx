'use client';

import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import type { ReactNode } from 'react';

import { ToastProvider } from '@/components/ToastProvider';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1976d2' },
    secondary: { main: '#f97316' },
    background: { default: '#f5f5f5' },
  },
  typography: {
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  },
});

export function ThemeRegistry({ children }: { children: ReactNode }) {
  return (
    <AppRouterCacheProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}

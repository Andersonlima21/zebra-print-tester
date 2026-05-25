import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ThemeRegistry } from './ThemeRegistry';

export const metadata: Metadata = {
  title: 'Zebra Print Tester',
  description: 'POC isolada de impressão Zebra via WebUSB + preview Labelary',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0 }}>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}

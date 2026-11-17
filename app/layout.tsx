import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Jewel Bill Builder',
  description: 'Jewellery sales and estimate builder for manufacturer PDFs',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

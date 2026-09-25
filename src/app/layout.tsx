import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = { title: 'TALLERIA · Tu taller, en orden', description: 'Recepción digital y gestión de clientes para talleres.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es" className={inter.className}><body>{children}</body></html>;
}

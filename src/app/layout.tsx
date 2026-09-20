import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'TALLERIA · Tu taller, en orden', description: 'Recepción digital y gestión de clientes para talleres.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}

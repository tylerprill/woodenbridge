import '@/app/global.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={'h-full bg-gray-50'}>
      <body className={`h-full antialiased`}>{children}</body>
    </html>
  );
}

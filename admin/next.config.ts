import type { NextConfig } from "next";
import os from "os";

const getLocalExternalIps = () => {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
        ips.push(`http://${iface.address}:3002`);
      }
    }
  }
  return ips;
};

const localIps = getLocalExternalIps();

// Extra origins that may hit `next dev` through a tunnel/FRP (hostname or host:port).
// Example: ALLOWED_DEV_ORIGINS=124.70.90.30,124.70.90.30:9966
const envAllowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: 'standalone',
  // Keep Node-only media deps out of the bundler server graph. Pulling qiniu
  // into the graph also loads urllib → proxy-agent → vm2 and adds avoidable
  // compile/RSS cost in long `next dev` sessions.
  serverExternalPackages: ['@napi-rs/canvas', 'qiniu', 'proxy-agent'],
  // Next.js 15+ blocks cross-origin requests to /_next/* in development unless listed.
  // Without this, FRP/public Host+Origin causes CSS/JS 403 and a broken login layout.
  allowedDevOrigins: [
    ...localIps,
    ...envAllowedDevOrigins,
    'localhost:3002',
    '127.0.0.1:3002',
    '124.70.90.30',
    '124.70.90.30:9966',
  ],
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-dialog', '@radix-ui/react-select', '@radix-ui/react-label', '@radix-ui/react-slot', 'date-fns'],
    serverActions: {
      allowedOrigins: [
        ...localIps.map((ip) => (ip.includes(':') ? ip.replace('http://', '') : `${ip}:3002`)),
        ...envAllowedDevOrigins,
        'localhost:3002',
        '124.70.90.30:9966',
      ],
    },
  },
};

export default nextConfig;

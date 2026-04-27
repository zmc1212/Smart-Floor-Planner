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

const nextConfig: NextConfig = {
  output: 'standalone',
  // @ts-ignore - Support for Next.js 15+ allowed origins
  allowedDevOrigins: [...localIps, 'localhost:3002', '127.0.0.1:3002'],
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-dialog', '@radix-ui/react-select', '@radix-ui/react-label', '@radix-ui/react-slot', 'date-fns'],
    serverActions: {
      allowedOrigins: [...localIps.map(ip => ip.includes(':') ? ip.replace('http://', '') : `${ip}:3002`), 'localhost:3002']
    }
  }
};

export default nextConfig;

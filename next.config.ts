import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return ['/forgot-password', '/reset-password'].map((source) => ({
      source,
      headers: [
        { key: 'Cache-Control', value: 'no-store' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ],
    }))
  },
};

export default nextConfig;

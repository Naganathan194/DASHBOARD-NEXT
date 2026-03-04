/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep heavy server-only packages out of the client bundle entirely
  serverExternalPackages: [
    'mongodb',
    'nodemailer',
    'qrcode',
    '@napi-rs/canvas',
    'bcryptjs',
    '@upstash/redis',
  ],

  experimental: {
    // Tree-shake icon libraries to only the symbols actually imported
    optimizePackageImports: ['lucide-react'],
  },

  // Strip all console.* calls except console.error from production builds.
  // This eliminates debug noise and shrinks client chunks.
  compiler: {
    removeConsole: {
      exclude: ['error'],
    },
  },

  // Turbopack is the default bundler in Next.js 16+.
  // The pdfjs-dist worker is served as a plain static file from /public,
  // so no bundler alias is needed.
  turbopack: {},
};

module.exports = nextConfig;


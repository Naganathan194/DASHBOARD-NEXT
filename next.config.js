/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['mongodb', 'nodemailer', 'qrcode'],
  // Turbopack is the default bundler in Next.js 16+.
  // The pdfjs-dist worker is served as a plain static file from /public,
  // so no bundler alias is needed.
  turbopack: {},
};

module.exports = nextConfig;


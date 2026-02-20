/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['mongodb', 'nodemailer', 'qrcode'],
};

module.exports = nextConfig;


import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: Next blocks dev resources (client JS, HMR) from any hostname other
  // than localhost, so a tunnel used for phone testing must be listed or the
  // page renders but never hydrates (buttons do nothing). One label per `*`.
  allowedDevOrigins: [
    "*.ngrok-free.dev",
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

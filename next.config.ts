import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal self-contained Node server for the Docker image.
  output: "standalone",
  // Don't advertise the framework in an X-Powered-By header.
  poweredByHeader: false,
  // Never ship source maps to the browser in production (default, made explicit).
  productionBrowserSourceMaps: false,
};

export default nextConfig;

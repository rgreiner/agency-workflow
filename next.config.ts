import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // typecheck já roda ANTES de todo push (fluxo do projeto); refazê-lo dentro do
  // `next build` do Coolify só duplica trabalho. (Next 16 já não roda ESLint no build.)
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;

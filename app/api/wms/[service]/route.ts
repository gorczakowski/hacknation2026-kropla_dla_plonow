import type { NextRequest } from "next/server";
import { upstreamFetch } from "@/lib/server/http";

const SERVICES: Record<string, string> = {
  orto: "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution",
  kieg: "https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow"
};

/**
 * GET /api/wms/{orto|kieg}?<WMS GetMap parameters>
 *
 * Map tiles go through the server so that, on a network where GUGiK throttles
 * the shared IP (a hackathon venue), they can use UPSTREAM_PROXY like every other
 * upstream call. Only GetMap requests to the two fixed services are forwarded,
 * so this is not an open proxy.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ service: string }> }) {
  const { service } = await params;
  const base = SERVICES[service];
  const query = request.nextUrl.searchParams;
  if (!base || query.get("REQUEST") !== "GetMap") return new Response("Not found", { status: 404 });

  let upstream: Response;
  try {
    upstream = await upstreamFetch(`${base}?${query.toString()}`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    return new Response("Upstream timeout", { status: 504 });
  }
  const type = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !type.startsWith("image/")) {
    await upstream.body?.cancel();
    return new Response("Tile unavailable", { status: 502 });
  }
  return new Response(upstream.body, {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400" }
  });
}

export function recordLegacyRouteUse(route: string, request: Request) {
  const url = new URL(request.url);
  console.info('[RouteTelemetry]', JSON.stringify({
    kind: 'legacy-route',
    route,
    method: request.method,
    path: url.pathname,
    at: new Date().toISOString(),
  }));
}

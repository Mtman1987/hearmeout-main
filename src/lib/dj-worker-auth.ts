export function isDjWorkerRequest(req: Request): boolean {
  return req.headers.get('x-hmo-dj-worker') === '1';
}

// The app owns one disk-backed queue and the worker owns two producer slots.
// Never silently scale/delete another machine or its data to satisfy this.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const machines = JSON.parse(input);
  if (!Array.isArray(machines) || machines.filter(machine => machine.state !== 'destroyed').length !== 1) {
    console.error('Deployment stopped: shared playback requires exactly one app machine and one worker machine. Resolve existing replicas and preserve their data before deployment.');
    process.exitCode = 1;
  }
});

import { execSync } from 'child_process';

export default function () {
  execSync('docker compose -f docker-compose.e2e.yml down', { stdio: 'inherit' });
}
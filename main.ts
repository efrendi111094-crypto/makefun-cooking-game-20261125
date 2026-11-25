// Dapur Kilat — entrypoint make.fun (Node 22, stdlib only).
// Menyalin game/ dan screenshots/ dari repo ini ke /output (atau ke
// MAKEFUN_OUTPUT_DIR saat dijalankan lokal), lalu menulis dossier.json
// yang merangkum entry untuk juri, memakai library vendored make.fun.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// Batas dari gate scorer: paling banyak 4 screenshot @ 256 KiB, game/ di
// bawah 993 file dan 48 MiB, dan dossier teks di bawah 160 KiB.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
console.log('Dapur Kilat dossier written to', out);

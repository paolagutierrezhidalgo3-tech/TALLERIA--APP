#!/usr/bin/env node
// ESTADO (12 de octubre de 2026): en uso; primera copia real de producción
// hecha y verificada. Procedimiento completo en docs/copia-seguridad.md.
//
// Full logical backup of the Supabase Postgres database named by
// TALLERIA_DB_URL, plus an automatic restore test. Read-only against the
// source: it only runs pg_dump/pg_dumpall (through the official Supabase CLI
// and its Docker image) and read-only queries. Never prints the connection
// string or any row: only counts, md5 fingerprints and file hashes.
//
// The backup holds personal data (accounts, customers, sessions): the
// destination must be outside the repository and outside OneDrive, and the
// folder must be kept private. Nothing here ever goes to GitHub.
//
// Usage:
//   node scripts/backup-database.mjs --init-key                once: create the
//                                                             encryption key
//   node scripts/backup-database.mjs --export-key              copy the key to the
//                                                             clipboard for the
//                                                             password manager, never
//                                                             shown, cleared after 60 s
//                                                             (interactive terminal)
//   node scripts/backup-database.mjs --check-key-copy          check the copy kept in
//                                                             the password manager
//                                                             (hidden input, terminal)
//   node scripts/backup-database.mjs --check-key               unattended check of the
//                                                             protected key
//   node scripts/backup-database.mjs <destination-folder>      backup + verify +
//                                                             encrypt
//   node scripts/backup-database.mjs --verify <backup-folder>  verify again
//   node scripts/backup-database.mjs --decrypt <backup-folder> --out <folder>
//                                                             decrypt to restore
//   node scripts/backup-database.mjs --daily                   scheduled job: start
//                                                             Docker, sweep, back up,
//                                                             rotate, mirror, alert
//   node scripts/backup-database.mjs --prune <folder> [--dry-run]
//                                                             7 daily + 4 weekly
//   node scripts/backup-database.mjs --sweep <folder>          remove leftovers of an
//                                                             interrupted run
//   node scripts/backup-database.mjs --mirror <mirror> <backup-folder>
//   node scripts/backup-database.mjs --status | --notify-test
// Daily settings in %USERPROFILE%\TALLERIA-COPIAS-PRIVADO\config.json
// ({ "copias", "espejo", "registro" }; --config PATH for another file).
// Options: --source-env NAME (variable with the connection string; default
// TALLERIA_DB_URL), --key-file PATH (DPAPI-protected key; default
// %USERPROFILE%\TALLERIA-COPIAS-PRIVADO\clave\backup-key.dpapi), --key-env NAME
// (raw key from the password manager in a variable, e.g. on another computer),
// --keep-container (leave the restore container for inspection).
//
// Requires Docker running. Files written to <destination>/talleria-<UTC>/:
//   roles.sql, schema.sql, data.sql   official Supabase CLI dump
//   acl.sql                           exact privileges of every function,
//                                     table, view, sequence and column of
//                                     public: schema.sql only revokes from
//                                     PUBLIC, and a Supabase database grants
//                                     anon/authenticated by default when each
//                                     object is created, so without this a
//                                     restore would be more permissive
//   platform-pre.sql, platform-post.sql
//                                     structure of the platform schemas auth
//                                     and storage (pg_dump pre-data /
//                                     post-data, without the custom
//                                     triggers), for a full restore outside
//                                     Supabase and for the test
//   custom-triggers.sql               triggers on auth/storage tables that
//                                     call public functions (not in
//                                     schema.sql, which leaves out those
//                                     schemas)
//   manifest.json                     sha256 of every file and fingerprints
// After the restore test passes, every .sql file is encrypted to <name>.enc
// and the plaintext is deleted; manifest.json (hashes only) stays readable.
// Restore order (see docs/copia-seguridad.md): roles, [platform-pre,
// platform-post only outside Supabase], schema, custom-triggers, acl, then data with
// session_replication_role = replica.
import { spawn, spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, openSync, closeSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import pg from 'pg';

const CLI_VERSION = '2.117.0';
// Same image the CLI uses for its pg_dump, matching the production server
// (PostgreSQL 17.6).
const IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.167';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const supabasePoolerCa = readFileSync(join(repoRoot, 'scripts/certs/supabase-pooler-root-ca.pem'), 'utf8');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const flag = name => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const verifyDir = opt('--verify');
const decryptDir = opt('--decrypt');
const outDir = opt('--out');
const sourceEnv = opt('--source-env') ?? 'TALLERIA_DB_URL';
const keyFile = opt('--key-file') ?? join(homedir(), 'TALLERIA-COPIAS-PRIVADO', 'clave', 'backup-key.dpapi');
const keyEnv = opt('--key-env');
const initKey = flag('--init-key');
const exportKey = flag('--export-key');
const checkKeyCopyFlag = flag('--check-key-copy');
const checkKeyFlag = flag('--check-key');
const clipboardSeconds = opt('--clipboard-seconds');
const keepContainer = flag('--keep-container');
const dailyFlag = flag('--daily');
const pruneDir = opt('--prune');
const sweepDir = opt('--sweep');
const mirrorDir = opt('--mirror');
const statusFlag = flag('--status');
const dryRun = flag('--dry-run');
const notifyTest = flag('--notify-test');
const noNotify = flag('--no-notify');
const configOpt = opt('--config');
const destination = args[0];

// Errors are thrown (never process.exit mid-way) so every finally block --
// in particular the one that removes the restore container -- always runs.
class Stop extends Error {}
const fail = msg => { throw new Stop(msg); };

// Emergency cleanup: if the process ends abruptly (uncaught error, Ctrl+C,
// closed window), remove any plaintext it was holding. A broken console pipe
// must not kill the process before its own cleanup runs, so write errors on
// stdout/stderr are ignored.
const emergency = new Map();
process.on('exit', () => { for (const fn of emergency.values()) { try { fn(); } catch { /* best effort */ } } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => process.exit(130));
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
const removePlaintext = dir => { if (existsSync(dir)) for (const f of readdirSync(dir)) if (!f.endsWith('.enc')) rmSync(join(dir, f), { recursive: true, force: true }); };
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
let redact = s => String(s);

// Physical path: symlinks and junctions of the deepest existing ancestor
// resolved, so a link cannot smuggle the backup into the repository.
function physical(p) {
  let cur = resolve(p);
  const rest = [];
  while (!existsSync(cur)) { const up = dirname(cur); if (up === cur) break; rest.unshift(basename(cur)); cur = up; }
  return join(realpathSync.native(cur), ...rest);
}
// True when child is parent or inside it ('..backup' is a name, not '..').
const inside = (parent, child) => { const r = relative(parent, child); return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep)); };
function checkOutsideRepoAndOneDrive(dir) {
  const abs = physical(dir);
  if (inside(physical(repoRoot), abs)) fail('La carpeta de destino está dentro del repositorio: elige una carpeta fuera.');
  for (const v of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const od = process.env[v];
    if (od && inside(physical(od), abs)) fail('La carpeta de destino está dentro de OneDrive: elige una carpeta que no se sincronice.');
  }
  return abs;
}

// ---- encryption ----
// Every backup file is encrypted with AES-256-GCM (its name authenticated, so
// files cannot be swapped). The 32-byte key is random and stored protected
// with Windows DPAPI: only the same Windows user on this computer can open it,
// so backups run unattended and the key is never shown. A copy of the raw key
// for disaster recovery is shown only by --export-key, in an interactive
// terminal; elsewhere --key-env NAME reads that copy from a variable.
const DPAPI_ENTROPY = 'TALLERIA-backup-key-v1';
function dpapi(op, inputB64) {
  if (process.platform !== 'win32') fail('La clave protegida con DPAPI solo funciona en Windows; en otro equipo usa --key-env con la copia de la clave.');
  const ps = `Add-Type -AssemblyName System.Security; $in = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $e = [Text.Encoding]::UTF8.GetBytes('${DPAPI_ENTROPY}'); $out = [Security.Cryptography.ProtectedData]::${op}($in, $e, 'CurrentUser'); [Console]::Out.Write([Convert]::ToBase64String($out))`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { input: inputB64, encoding: 'utf8' });
  if (r.status !== 0) fail(`No se pudo ${op === 'Protect' ? 'proteger' : 'abrir'} la clave con DPAPI (solo puede abrirla el mismo usuario de Windows que la creó).`);
  return r.stdout.trim();
}
function loadKey() {
  let key;
  if (keyEnv) {
    const v = process.env[keyEnv];
    if (!v) fail(`Falta la variable de entorno ${keyEnv}.`);
    key = Buffer.from(v.trim(), 'base64');
  } else {
    if (!existsSync(keyFile)) fail(`No existe la clave de cifrado (${keyFile}). Créala con --init-key.`);
    key = Buffer.from(dpapi('Unprotect', readFileSync(keyFile, 'utf8').trim()), 'base64');
  }
  if (key.length !== 32) fail('La clave de cifrado no es válida.');
  return key;
}
// Public identifier of a key (not the key): tells which key a backup needs.
const keyId = key => sha256(Buffer.concat([Buffer.from('talleria-key-id:'), key])).slice(0, 16);
const MAGIC = Buffer.from('TBK1');
function encrypt(key, name, plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(name));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}
function decrypt(key, name, blob) {
  if (blob.length < 32 || !blob.subarray(0, 4).equals(MAGIC)) fail(`${name}: no es un archivo cifrado de copia.`);
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(4, 16));
  d.setAAD(Buffer.from(name));
  d.setAuthTag(blob.subarray(16, 32));
  try { return Buffer.concat([d.update(blob.subarray(32)), d.final()]); } catch { fail(`${name}: no se puede descifrar (clave distinta o archivo alterado).`); }
}

function createKey() {
  const exists = () => fail(`Ya existe una clave en ${keyFile}: no se sobrescribe (las copias cifradas con ella dejarían de poder abrirse).`);
  if (existsSync(keyFile)) exists();
  mkdirSync(dirname(keyFile), { recursive: true });
  const key = randomBytes(32);
  const sealed = dpapi('Protect', key.toString('base64')) + '\n';
  // 'wx': exclusive creation, so two runs at once can never replace a key.
  try { writeFileSync(keyFile, sealed, { flag: 'wx' }); } catch (e) { if (e.code === 'EEXIST') exists(); throw e; }
  if (!loadKey().equals(key)) fail('La clave guardada no se pudo volver a abrir.');
  console.log(`✔ Clave de cifrado creada y protegida con DPAPI en ${keyFile} (identificador ${keyId(key)}).`);
  console.log('  Guarda una copia para emergencias en tu gestor de contraseñas con --export-key, desde una terminal tuya.');
}
const requireTerminal = what => {
  if (!process.stdout.isTTY || !process.stdin.isTTY) fail(`Por seguridad, ${what} solo funciona en una terminal interactiva abierta por ti (no en herramientas automáticas ni redirigida a un archivo).`);
};

// Clipboard through PowerShell (STA). The key travels by stdin, never as an
// argument. The data object carries the formats Windows documents for
// password managers, so clipboard history and cloud clipboard skip it.
function clipboard(script, input) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', `Add-Type -AssemblyName System.Windows.Forms; $k = [Console]::In.ReadToEnd().Trim(); ${script}`], { input, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}
const COPY_PS = `$no = { New-Object System.IO.MemoryStream(,[byte[]](0,0,0,0)) };
  $d = New-Object System.Windows.Forms.DataObject;
  $d.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $k);
  $d.SetData('ExcludeClipboardContentFromMonitorProcessing', (& $no));
  $d.SetData('CanIncludeInClipboardHistory', (& $no));
  $d.SetData('CanUploadToCloudClipboard', (& $no));
  [System.Windows.Forms.Clipboard]::SetDataObject($d, $true); 'ok'`;
// Compare and clear under one exclusive opening of the clipboard (Win32), so
// nothing copied in between can be erased. Returns borrado, cambiado or error.
const CLEAR_PS = `Add-Type -Language CSharp -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class TalleriaClip {
  [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr h);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll")] static extern bool EmptyClipboard();
  [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint f);
  [DllImport("user32.dll")] static extern bool IsClipboardFormatAvailable(uint f);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr h);
  public static string ClearIfEquals(string k) {
    if (!OpenClipboard(IntPtr.Zero)) return "error";
    try {
      // No text at all: the key was replaced. Text that cannot be read is an
      // error (retried), never a confirmation.
      if (!IsClipboardFormatAvailable(13)) return "cambiado";
      IntPtr h = GetClipboardData(13); if (h == IntPtr.Zero) return "error";
      IntPtr p = GlobalLock(h); if (p == IntPtr.Zero) return "error";
      string t; try { t = Marshal.PtrToStringUni(p); } finally { GlobalUnlock(h); }
      if (t != k) return "cambiado";
      return EmptyClipboard() ? "borrado" : "error";
    } finally { CloseClipboard(); }
  }
}
'@
[TalleriaClip]::ClearIfEquals($k)`;
// Clears the key from the clipboard, retrying while another program holds
// it. Returns true only once the key is confirmed gone (cleared, or replaced
// by something the user copied).
function clearKeyFromClipboard(key) {
  // At least two attempts, then keep trying for about 10 seconds in total.
  const deadline = Date.now() + 10_000;
  for (let attempt = 0; attempt < 2 || Date.now() < deadline; attempt++) {
    const r = clipboard(CLEAR_PS, key);
    if (r === 'borrado' || r === 'cambiado') return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  return false;
}
const CLEAR_FAILED = 'No se pudo confirmar que el portapapeles se haya borrado (otro programa lo está usando). Copia cualquier otro texto ahora mismo para sustituir la clave.';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Copies the key to the clipboard for the password manager, never printing
// it, and clears it after a short time.
async function exportKeyToClipboard() {
  requireTerminal('--export-key');
  if (process.platform !== 'win32') fail('--export-key usa el portapapeles de Windows.');
  const key = loadKey().toString('base64');
  const seconds = Math.max(5, Number(clipboardSeconds ?? 60) || 60);
  if (clipboard(COPY_PS, key) !== 'ok') fail('No se pudo copiar la clave al portapapeles.');
  let done = false;
  const clear = () => { if (done) return true; done = clearKeyFromClipboard(key); return done; };
  // Registered as emergency cleanup right after copying: Ctrl+C, a closed
  // window or any error clears the clipboard before the process ends. It is
  // dropped only once the clearing is confirmed.
  emergency.set('portapapeles', () => { if (!done) console.log(clear() ? '\n✔ Portapapeles borrado.' : '\n✘ ' + CLEAR_FAILED); });
  console.log(`✔ Clave de recuperación (identificador ${keyId(loadKey())}) copiada al portapapeles, sin mostrarla.`);
  console.log('  Pégala ahora (Ctrl+V) en tu gestor de contraseñas, en una entrada nueva llamada "TALLERIA - clave de copias".');
  for (let s = seconds; s > 0; s--) { process.stdout.write(`\r  El portapapeles se borrará en ${String(s).padStart(2)} s (Ctrl+C para borrarlo ya)…`); await sleep(1000); }
  if (!clear()) { process.stdout.write('\n'); fail(CLEAR_FAILED); }
  emergency.delete('portapapeles');
  console.log('\r✔ Portapapeles borrado.                                              ');
  console.log('  Ahora comprueba la copia guardada con: node scripts/backup-database.mjs --check-key-copy');
}

// Reads a line without echoing it (for pasting the key back).
function readHidden(prompt) {
  return new Promise((resolveLine, reject) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const done = err => {
      stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); process.stdout.write('\n');
      // Let the process exit once the line is read.
      if (typeof stdin.unref === 'function') stdin.unref();
      if (err) reject(err); else resolveLine(value);
    };
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Stop('Cancelado.'));
        if (ch === '\u0008' || ch === '\u007f') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

// Checks the copy kept in the password manager against the protected key,
// without showing either.
async function checkKeyCopy() {
  requireTerminal('--check-key-copy');
  const key = loadKey();
  const pasted = (await readHidden('Pega la clave desde tu gestor de contraseñas (Ctrl+V; no se verá) y pulsa Intro: ')).trim();
  const copy = Buffer.from(pasted, 'base64');
  if (copy.length === 32 && copy.equals(key)) console.log(`✔ La copia de tu gestor de contraseñas es correcta (identificador ${keyId(key)}). Ya puedes abrir las copias aunque se pierda este equipo.`);
  else fail('La copia pegada NO coincide con la clave de las copias. Vuelve a ejecutar --export-key y guarda de nuevo la clave.');
}

// Unattended health check of the protected key (shows only its identifier).
function checkKey() {
  const abs = physical(keyFile);
  const key = loadKey();
  const sealed = readFileSync(keyFile, 'utf8');
  if (sealed.includes(key.toString('base64'))) fail('El archivo de la clave contiene la clave sin proteger.');
  if (inside(physical(repoRoot), abs)) fail('La clave está dentro del repositorio.');
  for (const v of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) if (process.env[v] && inside(physical(process.env[v]), abs)) fail('La clave está dentro de OneDrive.');
  console.log(`✔ Clave de cifrado correcta: existe, la abre DPAPI, 32 bytes, identificador ${keyId(key)}, fuera del repositorio y de OneDrive.`);
}

// Encrypts the verified plaintext files, checks each one decrypts back to the
// manifest hash, then deletes the plaintext.
function encryptBackup(dir, key) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  for (const [f, meta] of Object.entries(manifest.archivos)) {
    const plain = readFileSync(join(dir, f));
    if (sha256(plain) !== meta.sha256) fail(`${f}: cambió antes de cifrarlo.`);
    const blob = encrypt(key, f, plain);
    writeFileSync(join(dir, f + '.enc'), blob);
    if (sha256(decrypt(key, f, readFileSync(join(dir, f + '.enc')))) !== meta.sha256) fail(`${f}: el archivo cifrado no se descifra igual.`);
    meta.cifrado = { archivo: f + '.enc', bytes: blob.length, sha256: sha256(blob) };
  }
  manifest.cifrado = { algoritmo: 'AES-256-GCM', clave_id: keyId(key) };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  for (const f of Object.keys(manifest.archivos)) rmSync(join(dir, f));
}

// Decrypts an encrypted backup into target (files plus manifest.json).
function decryptBackup(dir, target, key) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  if (!manifest.cifrado) fail('Esta copia no está cifrada.');
  if (manifest.cifrado.clave_id !== keyId(key)) fail(`Esta copia se cifró con otra clave (identificador ${manifest.cifrado.clave_id}).`);
  mkdirSync(target, { recursive: true });
  for (const [f, meta] of Object.entries(manifest.archivos)) {
    const blob = readFileSync(join(dir, meta.cifrado.archivo));
    if (sha256(blob) !== meta.cifrado.sha256) fail(`${meta.cifrado.archivo}: el archivo cifrado falta o no coincide con el manifiesto.`);
    writeFileSync(join(target, f), decrypt(key, f, blob));
    delete meta.cifrado;
  }
  // The decrypted folder is a plain backup: its manifest says so, so it can be
  // verified again (--verify) before restoring.
  delete manifest.cifrado;
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest, null, 1));
}

function docker(argv, options = {}) {
  const r = spawnSync('docker', argv, { encoding: 'utf8', maxBuffer: 1 << 28, ...options });
  if (r.error) fail('No se pudo ejecutar Docker: ' + r.error.message);
  return r;
}

// ---- source connection (never printed) ----
let source;
function loadSource() {
  const raw = process.env[sourceEnv];
  if (!raw) fail(`Falta la variable de entorno ${sourceEnv}.`);
  let url;
  try { url = new URL(raw); } catch { fail(`${sourceEnv} no es una cadena de conexión válida.`); }
  const password = decodeURIComponent(url.password);
  const secrets = [raw, url.password, password].filter(Boolean);
  redact = s => secrets.reduce((acc, x) => acc.split(x).join('***'), String(s));
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  // Containers reach a database on this machine through host.docker.internal.
  const dockerUrl = new URL(raw);
  if (local) dockerUrl.hostname = 'host.docker.internal';
  source = {
    dockerUrl: dockerUrl.toString(),
    pgEnv: { PGHOST: dockerUrl.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: password, PGDATABASE: url.pathname.slice(1) || 'postgres' },
    client: () => new pg.Client({ connectionString: raw, ssl: local ? false : { ca: supabasePoolerCa, rejectUnauthorized: true } }),
  };
}

// ---- Supabase CLI, pinned, installed and run outside the repository ----
const cliDir = join(tmpdir(), `talleria-supabase-cli-${CLI_VERSION}`);
function supabaseCli() {
  // The npm package's entry point is a Node script (it runs the CLI binary).
  const bin = join(cliDir, 'node_modules', 'supabase', 'dist', 'supabase.js');
  if (!existsSync(bin)) {
    console.log(`Instalando Supabase CLI ${CLI_VERSION} en una carpeta temporal…`);
    mkdirSync(cliDir, { recursive: true });
    const r = spawnSync('npm', ['install', '--prefix', cliDir, `supabase@${CLI_VERSION}`, '--no-audit', '--no-fund'], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status !== 0 || !existsSync(bin)) fail('No se pudo instalar la CLI de Supabase.');
  }
  return bin;
}

function cliDump(bin, file, extra) {
  // --workdir keeps the CLI's supabase/.temp cache out of the repository.
  const work = join(cliDir, 'work');
  mkdirSync(work, { recursive: true });
  const r = spawnSync(process.execPath, [bin, 'db', 'dump', '--workdir', work, '--db-url', source.dockerUrl, '-f', file, ...extra],
    { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, DO_NOT_TRACK: '1' } });
  if (r.status !== 0) fail(`Falló el volcado ${file.split(/[\\/]/).pop()}:\n` + redact((r.stderr || '') + (r.stdout || '')).split('\n').filter(l => !/new version|recommend updating/i.test(l)).slice(-8).join('\n'));
}

// pg_dump from the same image, credentials passed by environment name only.
function pgDump(file, extra) {
  const fd = openSync(file, 'w');
  try {
    const envNames = Object.keys(source.pgEnv);
    const r = spawnSync('docker', ['run', '--rm', '--name', 'talleria-dump-' + randomBytes(4).toString('hex'), '--label', `talleria.pid=${process.pid}`, ...envNames.flatMap(n => ['-e', n]), IMAGE, 'pg_dump', '--quote-all-identifiers', ...extra],
      { env: { ...process.env, ...source.pgEnv }, stdio: ['ignore', fd, 'pipe'], encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) fail(`Falló pg_dump (${file.split(/[\\/]/).pop()}):\n` + redact(r.stderr || '').split('\n').slice(-6).join('\n'));
  } finally { closeSync(fd); }
}

// ---- fingerprints: counts and md5 only, computed inside the database ----
// Both sides run them with an empty search_path, so definitions deparse
// identically. ACLs are compared as sorted grantee=privilege lists with the
// default ACL filled in, so neither entry order nor NULL-vs-explicit matters.
const TABLES_SQL = `select n.nspname as s, c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ('public', 'auth', 'storage') and not (n.nspname = 'auth' and c.relname = 'schema_migrations') and not (n.nspname = 'storage' and c.relname = 'migrations') order by 1, 2`;
const quote = id => '"' + id.replace(/"/g, '""') + '"';
// Sequences of public and auth; their state is read from each sequence
// (pg_sequences.last_value is NULL whenever is_called is false).
const SEQUENCES_SQL = `select n.nspname as s, c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'S' and n.nspname in ('public', 'auth', 'storage') order by 1, 2`;
const aclNorm = (acl, kind, owner) => `(select coalesce(string_agg(e, ',' order by e), '') from (select case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end || '=' || a.privilege_type || case when a.is_grantable then '*' else '' end as e from pg_catalog.aclexplode(coalesce(${acl}, pg_catalog.acldefault(${kind}, ${owner}))) a) z)`;
const RELKINDS = `('r', 'p', 'v', 'm', 'S', 'f')`;
const SCHEMAS = `('public'::regnamespace, 'auth'::regnamespace, 'storage'::regnamespace)`;
function fingerprintSql(tables, sequences) {
  const seqParts = sequences.map(({ s, t }) => `select '${s}.${t}' as k, last_value::text || ':' || is_called as v from ${quote(s)}.${quote(t)}`);
  const parts = tables.map(({ s, t }) =>
    `select '${s}.${t}' as tabla, count(*) as filas, md5(coalesce(string_agg(x, E'\\n' order by x), '')) as huella from (select r::text as x from ${quote(s)}.${quote(t)} r) q`);
  return `select json_build_object(
    'tablas', (select json_object_agg(tabla, json_build_object('filas', filas, 'huella', huella)) from (${parts.join(' union all ')}) f),
    'funciones', (select md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || pg_get_userbyid(p.proowner) || ':' || ${aclNorm('p.proacl', "'f'::\"char\"", 'p.proowner')}, ',' order by p.oid::regprocedure::text), '')) from pg_proc p where p.pronamespace in ${SCHEMAS} and p.prokind = 'f'),
    'permisos', (select md5(coalesce(string_agg(c.oid::regclass::text || ':' || c.relkind::text || ':' || pg_get_userbyid(c.relowner) || ':' || ${aclNorm('c.relacl', "(case when c.relkind = 'S' then 's' else 'r' end)::\"char\"", 'c.relowner')}, ',' order by c.oid::regclass::text), '')) from pg_class c where c.relnamespace in ${SCHEMAS} and c.relkind in ${RELKINDS}),
    'permisos_columnas', (select md5(coalesce(string_agg(c.oid::regclass::text || '.' || a.attname || ':' || a.attacl::text, ',' order by c.oid::regclass::text, a.attname), '')) from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace in ${SCHEMAS} and a.attacl is not null and not a.attisdropped),
    'rls', (select md5(coalesce(string_agg(c.oid::regclass::text || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity, ',' order by c.oid::regclass::text), '')) from pg_class c where c.relnamespace in ${SCHEMAS} and c.relkind in ('r', 'p')),
    'permisos_esquemas', (select string_agg(n.nspname || '=' || ${aclNorm('n.nspacl', "'n'::\"char\"", 'n.nspowner')}, ';' order by n.nspname) from pg_namespace n where n.nspname in ('public', 'auth', 'storage')),
    'politicas', (select md5(coalesce(string_agg(schemaname || '.' || tablename || ':' || policyname || ':' || permissive || ':' || array_to_string(roles, ',') || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by schemaname, tablename, policyname), '')) from pg_policies where schemaname in ('public', 'auth', 'storage')),
    -- Column position, not attnum: a restored table has no gaps left by
    -- columns dropped long ago (seen in auth.oauth_clients).
    'estructura', (select md5(coalesce(string_agg(x, E'\\n' order by x), '')) from (
        select 'columna:' || c.oid::regclass::text || '.' || a.attname || ':' || (row_number() over (partition by a.attrelid order by a.attnum))::text || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ':' || a.attidentity::text || ':' || a.attgenerated::text as x
          from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where c.relnamespace in ${SCHEMAS} and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped
        union all select 'restriccion:' || conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) || ':' || convalidated from pg_constraint where connamespace in ${SCHEMAS}
        union all select 'indice:' || i.indexrelid::regclass::text || ':' || pg_get_indexdef(i.indexrelid) from pg_index i join pg_class c on c.oid = i.indrelid where c.relnamespace in ${SCHEMAS}
        union all select 'trigger:' || t.tgrelid::regclass::text || ':' || pg_get_triggerdef(t.oid) || ':' || t.tgenabled::text from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace in ${SCHEMAS} and not t.tgisinternal
        union all select 'vista:' || c.oid::regclass::text || ':' || pg_get_viewdef(c.oid) from pg_class c where c.relnamespace in ${SCHEMAS} and c.relkind in ('v', 'm')
        union all select 'tipo:' || t.oid::regtype::text || ':' || t.typtype::text || ':' || coalesce((select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid = t.oid), '') from pg_type t where t.typnamespace in ${SCHEMAS} and t.typtype in ('e', 'd')
      ) s),
    'secuencias', (select coalesce(json_object_agg(schemaname || '.' || sequencename, data_type || ':' || start_value || ':' || increment_by || ':' || min_value || ':' || max_value || ':' || cycle || ':' || coalesce(last_value::text, 'sin usar')), '{}') from pg_sequences where schemaname in ('public', 'auth', 'storage')),
    'estado_secuencias', ${seqParts.length ? `(select json_object_agg(k, v) from (${seqParts.join(' union all ')}) q)` : "'{}'::json"},
    'triggers_auth_users', (select coalesce(json_agg(tgname order by tgname), '[]') from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal),
    'triggers_plataforma', (select coalesce(json_agg(t.tgrelid::regclass::text || '.' || t.tgname order by t.tgrelid::regclass::text, t.tgname), '[]') from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace in ('auth'::regnamespace, 'storage'::regnamespace) and not t.tgisinternal),
    'version', current_setting('server_version'))::text as j`;
}

// Exact privileges of public's objects as REVOKE/GRANT statements.
const ACL_SQL = `with objs as (
    select 'FUNCTION' as kind, p.oid::regprocedure::text as name, p.proacl as acl, p.proowner as owner, 'f'::"char" as t
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    union all
    select case c.relkind when 'S' then 'SEQUENCE' else 'TABLE' end, c.oid::regclass::text, c.relacl, c.relowner, case c.relkind when 'S' then 's'::"char" else 'r'::"char" end
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ${RELKINDS})
  select 'REVOKE ALL ON ' || o.kind || ' ' || o.name || ' FROM PUBLIC, anon, authenticated, service_role;' ||
    coalesce((select E'\\n' || string_agg(format('GRANT %s ON %s %s TO %s%s;', a.privilege_type, o.kind, o.name,
        case when a.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end,
        case when a.is_grantable then ' WITH GRANT OPTION' else '' end), E'\\n' order by a.grantee, a.privilege_type)
      from aclexplode(coalesce(o.acl, acldefault(o.t, o.owner))) a where a.grantee <> o.owner), '') as stmt
  from objs o
  union all
  select format('REVOKE ALL (%I) ON TABLE %s FROM PUBLIC, anon, authenticated, service_role;', a.attname, c.oid::regclass) ||
    coalesce((select E'\\n' || string_agg(format('GRANT %s (%I) ON TABLE %s TO %s%s;', x.privilege_type, a.attname, c.oid::regclass,
        case when x.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(x.grantee)) end,
        case when x.is_grantable then ' WITH GRANT OPTION' else '' end), E'\\n' order by x.grantee, x.privilege_type)
      from aclexplode(a.attacl) x), '')
  from pg_attribute a join pg_class c on c.oid = a.attrelid
  where c.relnamespace = 'public'::regnamespace and a.attacl is not null and not a.attisdropped
  order by 1`;

async function readSource() {
  const c = source.client();
  await c.connect();
  try {
    await c.query('begin isolation level repeatable read read only');
    await c.query("set local search_path = ''");
    const tables = (await c.query(TABLES_SQL)).rows;
    const sequences = (await c.query(SEQUENCES_SQL)).rows;
    const fp = JSON.parse((await c.query(fingerprintSql(tables, sequences))).rows[0].j);
    const triggers = (await c.query(`select pg_get_triggerdef(t.oid) || ';' as d from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      join pg_class c on c.oid = t.tgrelid
      where c.relnamespace in ('auth'::regnamespace, 'storage'::regnamespace) and not t.tgisinternal and p.pronamespace = 'public'::regnamespace order by t.tgrelid::regclass::text, t.tgname`)).rows.map(r => r.d);
    const acl = (await c.query(ACL_SQL)).rows.map(r => r.stmt);
    await c.query('commit');
    return { fp, triggers, acl };
  } finally { await c.end(); }
}

// ---- restore test in a throwaway container ----
const LOG = 'restauracion-errores.log';
function restoreAndFingerprint(dir, manifest, logDir) {
  const name = 'talleria-restore-' + randomBytes(4).toString('hex');
  const password = randomBytes(18).toString('hex');
  const run = docker(['run', '-d', '--name', name, '--label', `talleria.pid=${process.pid}`, '-e', 'POSTGRES_PASSWORD', '-v', `${dir}:/backup:ro`, IMAGE], { env: { ...process.env, POSTGRES_PASSWORD: password } });
  if (run.status !== 0) fail('No se pudo arrancar el contenedor de prueba: ' + run.stderr);
  // The container holds the restored database: an abrupt exit (Ctrl+C, closed
  // window, uncaught error) must remove it too, not only the plaintext files.
  emergency.set('contenedor', () => spawnSync('docker', ['rm', '-f', '-v', name], { stdio: 'ignore' }));
  const psql = (sqlArgs, input) => docker(['exec', '-i', '-e', 'PGPASSWORD', name, 'psql', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...sqlArgs],
    { env: { ...process.env, PGPASSWORD: password }, input });
  try {
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      ready = docker(['exec', name, 'pg_isready', '-h', 'localhost', '-U', 'postgres']).status === 0 && psql(['-Atc', 'select 1']).status === 0;
      if (!ready) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    }
    if (!ready) fail('El contenedor de prueba no llegó a estar listo.');
    // psql diagnostics can quote row values (e.g. a COPY line it rejected):
    // they go to a private log next to the backup (encrypted afterwards),
    // never to the console.
    const log = join(logDir, LOG);
    const step = (label, r) => {
      if (r.status === 0) return r;
      writeFileSync(log, `${new Date().toISOString()} ${label}\n${r.stderr || ''}\n`, { flag: 'a' });
      fail(`${label}: falló (código ${r.status}). El diagnóstico completo, que puede contener datos, se guarda en la carpeta de la copia (cifrado si la copia lo está; se abre con --decrypt).`);
    };
    // The image ships minimal auth and storage schemas; replace them with the
    // backed-up ones.
    step('Preparación del contenedor', psql(['-c', 'drop schema if exists auth cascade; drop schema if exists storage cascade']));
    // roles.sql may grant to or configure platform roles that exist in the
    // real project but not in this local image (e.g. supabase_realtime_admin).
    // In the throwaway container only, create the ones it references but does
    // not create itself, as empty NOLOGIN roles. A new Supabase project
    // already has them.
    const rolesSql = readFileSync(join(dir, 'roles.sql'), 'utf8');
    const created = new Set([...rolesSql.matchAll(/^CREATE ROLE "((?:[^"]|"")+)"/gm)].map(m => m[1].replace(/""/g, '"')));
    // GRANT lines name only roles; in ALTER ROLE lines only the first quoted
    // name is a role (later ones can be setting names).
    const names = l => [...l.matchAll(/"((?:[^"]|"")+)"/g)].map(m => m[1].replace(/""/g, '"'));
    const referenced = new Set(rolesSql.split('\n').flatMap(l => (/^GRANT /.test(l) ? names(l) : /^ALTER ROLE /.test(l) ? names(l).slice(0, 1) : [])));
    const missing = [...referenced].filter(r => !created.has(r));
    if (missing.length) step('Roles de plataforma en el contenedor', psql([], missing.map(r => `do $$ begin if not exists (select 1 from pg_roles where rolname = ${"'" + r.replace(/'/g, "''") + "'"}) then create role ${'"' + r.replace(/"/g, '""') + '"'} nologin; end if; end $$;`).join('\n')));
    step('Restauración de prueba', psql(['--single-transaction', '-f', '/backup/roles.sql', '-f', '/backup/platform-pre.sql', '-f', '/backup/platform-post.sql', '-f', '/backup/schema.sql',
      '-f', '/backup/custom-triggers.sql', '-f', '/backup/acl.sql', '-c', 'set session_replication_role = replica', '-f', '/backup/data.sql']));
    const split = k => { const [s, ...t] = k.split('.'); return { s, t: t.join('.') }; };
    const tables = Object.keys(manifest.huellas.tablas).map(split), sequences = Object.keys(manifest.huellas.estado_secuencias).map(split);
    const r = step('Huellas de la copia restaurada', psql(['-At'], "set search_path = '';\n" + fingerprintSql(tables, sequences)));
    return JSON.parse(r.stdout.trim().split('\n').pop());
  } finally {
    if (keepContainer) {
      console.log(`Contenedor de prueba conservado: ${name} (bórralo con: docker rm -f -v ${name})`);
      emergency.delete('contenedor');
    } else {
      // Drop the emergency removal only once Docker confirms the container is
      // gone; otherwise keep it (retried on exit) and report it.
      docker(['rm', '-f', '-v', name]);
      const left = docker(['ps', '-a', '-q', '--filter', `name=^/${name}$`]);
      if (left.status === 0 && !left.stdout.trim()) emergency.delete('contenedor');
      else fail(`No se pudo confirmar el borrado del contenedor de prueba ${name}, que contiene la base restaurada. Bórralo con: docker rm -f -v ${name}`);
    }
  }
}

// JSON with sorted keys, so objects compare by content.
const stable = v => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const COMPARED = ['funciones', 'permisos', 'permisos_columnas', 'rls', 'permisos_esquemas', 'politicas', 'estructura', 'secuencias', 'estado_secuencias', 'triggers_plataforma'];
function verify(dir, logDir = dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  let ok = true;
  for (const [f, meta] of Object.entries(manifest.archivos)) {
    const same = existsSync(join(dir, f)) && sha256(readFileSync(join(dir, f))) === meta.sha256;
    if (!same) { ok = false; console.log(`✘ ${f}: el archivo falta o no coincide con el manifiesto`); }
  }
  if (!ok) fail('La copia está incompleta o modificada.');
  console.log('✔ Archivos íntegros (SHA-256 iguales al manifiesto)');
  const restored = restoreAndFingerprint(dir, manifest, logDir);
  const src = manifest.huellas;
  for (const [t, v] of Object.entries(src.tablas)) {
    const w = restored.tablas?.[t];
    const same = w && Number(w.filas) === Number(v.filas) && w.huella === v.huella;
    if (!same) { ok = false; console.log(`✘ ${t}: ${v.filas} filas en el origen, ${w ? w.filas : 'ninguna'} en la copia restaurada${w && Number(w.filas) === Number(v.filas) ? ' (contenido distinto)' : ''}`); }
  }
  for (const k of COMPARED) if (stable(restored[k]) !== stable(src[k])) { ok = false; console.log(`✘ ${k}: distinto en la copia restaurada`); }
  if (JSON.stringify(restored.triggers_auth_users) !== JSON.stringify(src.triggers_auth_users)) { ok = false; console.log('✘ triggers de auth.users distintos en la copia restaurada'); }
  if (!ok) fail('La restauración de prueba no reproduce el origen.');
  const n = Object.keys(src.tablas).length, rows = Object.values(src.tablas).reduce((a, v) => a + Number(v.filas), 0);
  console.log(`✔ Restauración de prueba idéntica al origen: ${n} tablas (${rows} filas); estructura, secuencias, funciones, permisos, RLS, políticas y triggers`);
}

// The restore diagnostic may quote rows: keep it only encrypted. The
// plaintext log is always removed; the encrypted copy is kept only if it was
// written and decrypts back to the same bytes.
function sealLog(dir, key) {
  const f = join(dir, LOG);
  if (!existsSync(f)) return;
  const name = `restauracion-errores-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.log`;
  const out = join(dir, name + '.enc');
  try {
    const plain = readFileSync(f);
    writeFileSync(out, encrypt(key, name, plain));
    if (!decrypt(key, name, readFileSync(out)).equals(plain)) throw new Error('diagnóstico cifrado distinto');
  } catch {
    rmSync(out, { force: true });
    console.error('✘ No se pudo guardar cifrado el diagnóstico de la restauración; se ha borrado.');
  } finally {
    rmSync(f, { force: true });
  }
}

// Verifies a backup; an encrypted one is decrypted into a temporary folder
// inside the (access-restricted) backup folder, removed afterwards.
async function verifyBackup(dir) {
  const releaseLock = await acquireLock();
  try { return verifyBackupLocked(dir); } finally { releaseLock(); }
}
function verifyBackupLocked(dir) {
  // Verifying writes decrypted files and a diagnostic into the backup folder:
  // never inside the repository or OneDrive, even if a backup was moved there.
  checkOutsideRepoAndOneDrive(dir);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  if (!manifest.cifrado) return verify(dir);
  const key = loadKey();
  const tmp = join(dir, '.descifrado-' + randomBytes(4).toString('hex'));
  emergency.set('verificación', () => { rmSync(tmp, { recursive: true, force: true }); rmSync(join(dir, LOG), { force: true }); });
  try {
    decryptBackup(dir, tmp, key);
    console.log(`✔ Archivos cifrados íntegros y descifrados con la clave ${keyId(key)}`);
    verify(tmp, dir);
  } finally {
    // Independent steps: a failure removing the temporary folder must not
    // stop the diagnostic from being sealed.
    try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {
      console.error(`✘ No se pudo borrar la carpeta temporal descifrada ${tmp}: bórrala a mano (${e.code ?? e.message}).`);
    } finally { sealLog(dir, key); }
  }
}

function decryptCommand(src, out) {
  if (!out) fail('Indica --out <carpeta> (fuera del repositorio y de OneDrive).');
  const target = checkOutsideRepoAndOneDrive(out);
  if (existsSync(target)) fail('La carpeta de salida ya existe.');
  const key = loadKey();
  const from = resolve(src);
  if (from.endsWith('.enc') && existsSync(from) && !existsSync(join(from, 'manifest.json'))) {
    // A single sealed file, e.g. an encrypted restore diagnostic.
    const name = basename(from).slice(0, -4);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, name), decrypt(key, name, readFileSync(from)));
  } else decryptBackup(from, target, key);
  console.log(`✔ Descifrado en ${target}. Contiene datos personales: bórrala en cuanto termines.`);
}

async function backup(target = destination, { haveLock = false } = {}) {
  if (!target) fail('Uso: node scripts/backup-database.mjs <carpeta-destino>   |   --verify <carpeta-de-copia>');
  if (docker(['info', '--format', '{{.ServerVersion}}']).status !== 0) fail('Docker no está en marcha.');
  const base = checkOutsideRepoAndOneDrive(target);
  mkdirSync(base, { recursive: true });
  // One backup at a time per folder; leftovers of an interrupted run (also a
  // forced kill or power cut, where no cleanup could run) are removed first.
  const releaseLock = haveLock ? () => {} : await acquireLock();
  try {
    loadSource(); // the sweep needs it to recognise this database's dump containers
    sweep(base);
    return await backupLocked(base);
  } finally { releaseLock(); }
}

async function backupLocked(base) {
  loadSource();
  // Unencrypted backups are not allowed: without a usable key, stop before
  // anything is dumped.
  const key = loadKey();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dir = join(base, `talleria-${stamp}`);
  if (existsSync(dir)) fail('La carpeta de la copia ya existe.');
  mkdirSync(dir, { recursive: true });
  // Until the backup is encrypted, an abrupt exit removes every plaintext file.
  emergency.set('copia', () => removePlaintext(dir));
  let phase = 'volcado';
  try {
    await backupInto(dir, key, p => { phase = p; });
  } catch (e) {
    // Never leave plaintext personal data behind. If the restore test failed,
    // keep only its diagnostic, encrypted, and mark the folder; otherwise
    // remove the folder this run created.
    if (phase === 'verificación') {
      try { sealLog(dir, key); } finally {
        // Whatever happened while sealing, no plaintext file survives.
        for (const f of readdirSync(dir)) if (!f.endsWith('.enc')) rmSync(join(dir, f), { recursive: true, force: true });
        writeFileSync(join(dir, 'COPIA-NO-VALIDA.txt'), 'La restauración de prueba de esta copia falló y sus archivos se han borrado. Si se pudo guardar, queda solo el diagnóstico, cifrado (descífralo con --decrypt <archivo.enc> --out <carpeta>).\n');
      }
    } else rmSync(dir, { recursive: true, force: true });
    emergency.delete('copia');
    throw e;
  }
  return dir;
}

async function backupInto(dir, key, setPhase) {
  const bin = supabaseCli();
  // The dumps run on separate connections. Reading the fingerprints before
  // and after them, and refusing the backup if they differ, detects any
  // change to data, structure, privileges or sequences made in between.
  console.log('Leyendo huellas del origen antes del volcado (solo metadatos, recuentos y md5)…');
  const before = await readSource();
  console.log('Volcando roles, esquema y datos (CLI oficial de Supabase)…');
  cliDump(bin, join(dir, 'roles.sql'), ['--role-only']);
  // --keep-comments: by default the CLI drops every line starting with --,
  // including comments inside function bodies, which changes their source.
  cliDump(bin, join(dir, 'schema.sql'), ['--keep-comments']);
  cliDump(bin, join(dir, 'data.sql'), ['--data-only', '--use-copy']);
  console.log('Volcando la estructura de los esquemas de plataforma (auth y storage)…');
  pgDump(join(dir, 'platform-pre.sql'), ['--schema-only', '--schema=auth', '--schema=storage', '--section=pre-data']);
  pgDump(join(dir, 'platform-post.sql'), ['--schema-only', '--schema=auth', '--schema=storage', '--section=post-data']);
  // Triggers on platform tables that call public functions cannot be created
  // before schema.sql; they are restored from custom-triggers.sql.
  const post = readFileSync(join(dir, 'platform-post.sql'), 'utf8');
  writeFileSync(join(dir, 'platform-post.sql'), post.replace(/^CREATE TRIGGER .* EXECUTE FUNCTION "public"\..*$/gm, l => '-- (en custom-triggers.sql) ' + l));
  console.log('Leyendo permisos, triggers y huellas del origen después del volcado…');
  const { fp, triggers, acl } = await readSource();
  if (stable(fp) !== stable(before.fp) || stable(acl) !== stable(before.acl) || stable(triggers) !== stable(before.triggers))
    fail('El origen cambió durante la copia (datos, estructura, permisos o secuencias): la copia no es coherente. Repite la copia en un momento sin actividad.');
  writeFileSync(join(dir, 'custom-triggers.sql'), ['-- Triggers on auth/storage tables that call public functions (recreate them', '-- after restoring into a new Supabase project; schema.sql leaves out those schemas).', ...triggers, ''].join('\n'));
  writeFileSync(join(dir, 'acl.sql'), ['-- Exact privileges of the public schema objects at backup time. Apply after', '-- schema.sql: a Supabase database grants anon/authenticated by default when', '-- each object is created, and schema.sql does not revoke those grants.', ...acl, ''].join('\n'));
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const manifest = {
    creada: new Date().toISOString(), cli_supabase: CLI_VERSION, imagen: IMAGE, version_servidor: fp.version,
    archivos: Object.fromEntries(files.map(f => { const b = readFileSync(join(dir, f)); return [f, { bytes: b.length, sha256: sha256(b) }]; })),
    huellas: fp,
    aviso: 'Contiene datos personales, contraseñas cifradas y tokens de sesión de las cuentas: guardar en privado, cifrada, fuera del repositorio y sin sincronizar.',
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const rows = Object.values(fp.tablas).reduce((a, v) => a + Number(v.filas), 0);
  console.log(`✔ Copia creada: ${files.length} archivos, ${Object.keys(fp.tablas).length} tablas, ${rows} filas, ${fp.triggers_auth_users.length} triggers en auth.users`);
  console.log('Comprobando que se puede restaurar…');
  setPhase('verificación');
  verify(dir);
  setPhase('cifrado');
  encryptBackup(dir, key);
  emergency.delete('copia');
  console.log(`✔ Copia cifrada (AES-256-GCM, clave ${keyId(key)}); los archivos sin cifrar se han borrado`);
  console.log(`Carpeta de la copia: ${dir}`);
}

// ---- daily automation: lock, sweep, retention, mirror, alerts ----
const PRIVATE_DIR = join(homedir(), 'TALLERIA-COPIAS-PRIVADO');
const CONFIG_FILE = configOpt ? resolve(configOpt) : join(PRIVATE_DIR, 'config.json');
let LOG_FILE = join(PRIVATE_DIR, 'registro', 'copias.log');
const BACKUP_NAME = /^talleria-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
// A backup folder containing this file is never removed by the rotation.
const PROTECT = 'CONSERVAR.txt';

// Status lines only (never data, keys or connection strings).
function log(line) {
  try { mkdirSync(dirname(LOG_FILE), { recursive: true }); writeFileSync(LOG_FILE, `${new Date().toISOString()} ${redact(line)}\n`, { flag: 'a' }); } catch { /* the log must never break a backup */ }
}

// Windows notification (toast), title and text passed by stdin.
function notify(title, text) {
  if (process.platform !== 'win32' || noNotify) return false;
  const ps = `$t = [Console]::In.ReadToEnd() -split "\\n", 2;
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null;
    $x = New-Object Windows.Data.Xml.Dom.XmlDocument;
    $x.LoadXml('<toast><visual><binding template="ToastGeneric"><text></text><text></text></binding></visual></toast>');
    $n = $x.GetElementsByTagName('text'); $n.Item(0).InnerText = $t[0]; $n.Item(1).InnerText = $t[1];
    $app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show((New-Object Windows.UI.Notifications.ToastNotification $x)); 'ok'`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { input: `${title}\n${redact(text)}`, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 'ok';
}

function loadConfig() {
  const defaults = { copias: join(PRIVATE_DIR, 'copias'), espejo: null, registro: LOG_FILE };
  let c = {};
  if (existsSync(CONFIG_FILE)) { try { c = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { fail(`${CONFIG_FILE} no es un JSON válido.`); } }
  else if (configOpt) fail(`No existe ${CONFIG_FILE}.`);
  const out = { ...defaults, ...c };
  LOG_FILE = out.registro;
  return out;
}

// One global lock for every operation that dumps, restores, rotates or
// sweeps (backup, --daily, --verify, --sweep, --prune, --mirror), whatever the
// folder, so none of them can touch what another is using. It is an
// operating-system lock, not a file: a Windows named pipe that only one
// process can create. The system releases it when the process ends in any
// way (also a forced kill or a power cut), so there are no stale locks to
// recover and no window in which two runs could both hold it.
const LOCK_NAME = process.platform === 'win32' ? '\\\\.\\pipe\\talleria-copias-operacion' : join(tmpdir(), 'talleria-copias-operacion.sock');
const pidAlive = pid => { try { if (!pid) return false; process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
async function acquireLock() {
  const busy = () => fail('Ya hay otra operación de copias en curso (copia, verificación, rotación o limpieza).');
  const listen = () => new Promise((res, rej) => {
    const server = net.createServer(socket => socket.destroy());
    server.once('error', rej);
    server.listen(LOCK_NAME, () => res(server));
  });
  let server;
  try { server = await listen(); } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    // A Unix socket file can outlive a killed process: if nobody answers it,
    // it is stale. A Windows pipe never outlives its process.
    if (process.platform === 'win32') busy();
    const answered = await new Promise(res => { const c = net.connect(LOCK_NAME, () => { c.destroy(); res(true); }); c.on('error', () => res(false)); });
    if (answered) busy();
    rmSync(LOCK_NAME, { force: true });
    server = await listen().catch(e2 => { if (e2.code === 'EADDRINUSE') busy(); throw e2; });
  }
  server.unref();
  const release = () => { try { server.close(); } catch { /* already closed */ } };
  emergency.set('bloqueo', release);
  return () => { release(); emergency.delete('bloqueo'); };
}

// A backup folder's state from its own files, without decrypting anything.
function backupState(dir) {
  const files = readdirSync(dir);
  if (files.includes('COPIA-NO-VALIDA.txt')) return 'no válida';
  if (!files.includes('manifest.json')) return 'incompleta';
  let m;
  try { m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')); } catch { return 'incompleta'; }
  if (!m.cifrado || !m.archivos) return 'incompleta';
  for (const meta of Object.values(m.archivos)) {
    const p = join(dir, meta.cifrado?.archivo ?? '');
    if (!meta.cifrado || !existsSync(p) || sha256(readFileSync(p)) !== meta.cifrado.sha256) return 'dañada';
  }
  // Leftover files next to an intact copy do not make it invalid: the sweep
  // removes them; the copy keeps its place in the rotation.
  return 'válida';
}

function listBackups(base) {
  if (!existsSync(base)) return [];
  return readdirSync(base).map(name => {
    const m = name.match(BACKUP_NAME);
    if (!m) return null;
    const dir = join(base, name);
    return { name, dir, date: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])), state: backupState(dir) };
  }).filter(Boolean).sort((a, b) => b.date - a.date);
}

// Local calendar day and ISO week of a date.
const localDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function isoWeek(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - day + 3);
  const first = new Date(t.getFullYear(), 0, 4);
  return `${t.getFullYear()}-W${String(1 + Math.round(((t - first) / 86400000 - 3 + ((first.getDay() + 6) % 7)) / 7)).padStart(2, '0')}`;
}

// Retention: the newest valid copy of each of the 7 most recent days that
// have one, plus the newest valid copy of each of the 4 most recent ISO weeks
// that have one. Failed or incomplete copies are kept 7 days for diagnosis.
// The newest valid copy is always kept.
function retentionPlan(backups, now = new Date(), alsoKeep = []) {
  const valid = backups.filter(b => b.state === 'válida');
  const keep = new Map();
  const days = new Set(), weeks = new Set();
  for (const b of valid) {
    const d = localDay(b.date);
    if (!days.has(d) && days.size < 7) { days.add(d); keep.set(b.name, 'diaria'); }
  }
  for (const b of valid) {
    const w = isoWeek(b.date);
    if (!weeks.has(w) && weeks.size < 4) { weeks.add(w); keep.set(b.name, keep.has(b.name) ? keep.get(b.name) + ' y semanal' : 'semanal'); }
  }
  if (valid[0]) keep.set(valid[0].name, keep.get(valid[0].name) ?? 'la más reciente');
  // The copy this run has just made is never removed by its own rotation,
  // even if another copy carries a later date (e.g. after a clock change).
  for (const name of alsoKeep) if (backups.some(b => b.name === name)) keep.set(name, keep.has(name) ? keep.get(name) + ', recién creada' : 'recién creada');
  const remove = [];
  for (const b of backups) if (existsSync(join(b.dir, PROTECT))) keep.set(b.name, keep.has(b.name) ? keep.get(b.name) + ', protegida' : 'protegida (CONSERVAR.txt)');
  for (const b of backups) {
    if (keep.has(b.name)) continue;
    if (b.state === 'válida') remove.push({ ...b, motivo: 'fuera de la política' });
    else if (now - b.date > 7 * 86400000) remove.push({ ...b, motivo: `${b.state}, más de 7 días` });
    else keep.set(b.name, `${b.state} (se conserva 7 días para diagnóstico)`);
  }
  return { keep, remove };
}

function prune(base, { dry = false, alsoKeep = [] } = {}) {
  const abs = physical(base);
  if (inside(physical(repoRoot), abs)) fail('La carpeta de copias está dentro del repositorio.');
  const backups = listBackups(abs);
  if (!backups.some(b => b.state === 'válida')) fail('No hay ninguna copia válida en la carpeta: no se borra nada.');
  const { keep, remove } = retentionPlan(backups, new Date(), alsoKeep);
  for (const b of backups) if (keep.has(b.name)) console.log(`  conservar ${b.name} (${keep.get(b.name)})`);
  for (const b of remove) {
    console.log(`  ${dry ? 'se borraría' : 'borrar'} ${b.name} (${b.motivo})`);
    if (!dry) { rmSync(b.dir, { recursive: true, force: true }); log(`rotación: borrada ${b.name} (${b.motivo}) en ${abs}`); }
  }
  console.log(`✔ Rotación${dry ? ' (simulación, sin borrar nada)' : ''}: ${keep.size} conservadas, ${remove.length} ${dry ? 'se borrarían' : 'borradas'}.`);
  return { keep, remove };
}

// Writers that can outlive a killed run (Windows does not end child processes
// with their parent): the pinned CLI's processes (they live in its own
// folder), docker clients running our pg_dump, our labelled dump and restore
// containers, and containers of the pinned image running pg_dump/pg_dumpall
// (the CLI's dump containers have random names and no labels). Only called
// under the global lock, when no legitimate TALLERIA operation is running.
// A PostgreSQL server of another project, even on the same image, is never
// touched: only containers whose command is pg_dump or pg_dumpall.
// Lists containers, failing (instead of assuming "none") if Docker does not
// answer: a cleanup that cannot look must not report success.
function listContainers() {
  const r = docker(['ps', '-a', '--no-trunc', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Command}}\t{{.Label "talleria.pid"}}']);
  if (r.status !== 0) fail('No se pudo consultar Docker para limpiar restos: la copia no continúa.');
  return r.stdout.split('\n').filter(Boolean).map(line => { const [id, name, image, command = '', owner = ''] = line.split('\t'); return { id, name, image, command, owner }; });
}
// Removes containers and confirms with Docker that they are gone (3 tries).
function removeContainersConfirmed(ids, what) {
  if (!ids.length) return 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const id of ids) docker(['rm', '-f', '-v', id]);
    const left = new Set(listContainers().map(c => c.id));
    if (!ids.some(id => left.has(id))) return ids.length;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  fail(`No se pudo confirmar el borrado de ${what} (pueden contener datos en claro). Bórralos con: docker rm -f -v <id>. La copia no continúa.`);
}
const ORPHAN_PS = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -and (($_.Name -eq 'node.exe' -and $_.CommandLine -like '*talleria-supabase-cli-*node_modules*supabase*') -or ($_.Name -eq 'supabase.exe' -and $_.ExecutablePath -like '*talleria-supabase-cli-*') -or ($_.Name -eq 'docker.exe' -and $_.CommandLine -like '* run *' -and $_.CommandLine -like '*--name talleria-dump-*')) } | ForEach-Object { $_.ProcessId }`;
// Errors are terminating and success is explicit ("OK" first): a query that
// failed silently must never read as "no orphan processes".
function orphanProcesses() {
  const ps = `$ErrorActionPreference = 'Stop'; try { $all = Get-CimInstance Win32_Process -ErrorAction Stop; 'OK'; $all | ${ORPHAN_PS.replace(/^Get-CimInstance Win32_Process \| /, '')} } catch { exit 1 }`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  const lines = (r.stdout || '').split(/\s+/).filter(Boolean);
  if (r.status !== 0 || lines[0] !== 'OK') fail('No se pudo consultar los procesos para limpiar restos: la copia no continúa.');
  return lines.slice(1);
}

// The pinned CLI passes the connection to its dump container as environment
// variables (checked against the real CLI). A container counts as dumping
// OUR database only if PGHOST, PGPORT, PGUSER and PGDATABASE are exactly
// ours, element by element (no partial match). Compared in memory, never
// shown. Any error or doubt answers "no" (the container is left alone).
function dumpsOurDatabase(id) {
  const r = docker(['inspect', '--format', '{{json .Config.Env}}', id]);
  if (r.status !== 0) return false;
  let env;
  try { env = JSON.parse(r.stdout.trim()); } catch { return false; }
  if (!Array.isArray(env)) return false;
  return ['PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE'].every(k => env.includes(`${k}=${source.pgEnv[k]}`));
}

function stopOrphans() {
  let processes = 0;
  if (process.platform === 'win32') {
    // Stop them, then confirm none is left (3 tries).
    for (let attempt = 0; attempt < 3; attempt++) {
      const pids = orphanProcesses();
      if (!pids.length) break;
      for (const pid of pids) spawnSync('taskkill', ['/F', '/T', '/PID', pid], { stdio: 'ignore' });
      processes += attempt === 0 ? pids.length : 0;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
      if (attempt === 2 && orphanProcesses().length) fail('No se pudieron detener procesos de volcado huérfanos: la copia no continúa.');
    }
  }
  const targets = listContainers().filter(c => {
    const ours = /^talleria-dump-/.test(c.name);
    // A CLI dump container (no name or label of ours) counts as ours only if
    // it runs pg_dump on the pinned image AND dumps exactly OUR database (see
    // dumpsOurDatabase). Anything ambiguous is left alone; without a
    // configured source, only containers labelled as ours are touched.
    const cliDump = !!source && c.image === IMAGE && /pg_dump(all)?\b/.test(c.command) && dumpsOurDatabase(c.id);
    if (!ours && !cliDump) return false;
    return !(c.owner && Number(c.owner) !== process.pid && pidAlive(Number(c.owner)));
  }).map(c => c.id);
  const writers = removeContainersConfirmed(targets, 'contenedores de volcado huérfanos');
  return { processes, writers };
}

// Leftovers of an interrupted run: plaintext files and decrypted temp folders
// inside backup folders, incomplete folders, and restore containers. Runs
// under the folder lock, so it never touches a backup in progress.
function sweep(base) {
  // First stop anything that could still be writing, then delete.
  const orphans = stopOrphans();
  let files = 0, folders = 0, containers = 0;
  for (const name of existsSync(base) ? readdirSync(base) : []) {
    if (!BACKUP_NAME.test(name)) continue;
    const dir = join(base, name);
    for (const x of readdirSync(dir)) {
      if (x.endsWith('.enc') || x === 'manifest.json' || x === 'COPIA-NO-VALIDA.txt' || x === PROTECT) continue;
      rmSync(join(dir, x), { recursive: true, force: true });
      files++;
    }
    const left = readdirSync(dir);
    if (!left.length) { rmSync(dir, { recursive: true, force: true }); folders++; }
    else if (backupState(dir) === 'incompleta' && !left.includes('COPIA-NO-VALIDA.txt')) writeFileSync(join(dir, 'COPIA-NO-VALIDA.txt'), 'Copia interrumpida antes de completarse: no la uses para restaurar.\n');
  }
  // Abandoned restore containers (they hold a restored database in clear):
  // removal confirmed with Docker, or the run stops.
  const stale = listContainers().filter(c => /^talleria-restore-/.test(c.name) && !(c.owner && Number(c.owner) !== process.pid && pidAlive(Number(c.owner)))).map(c => c.id);
  containers = removeContainersConfirmed(stale, 'contenedores de restauración abandonados');
  if (files || folders || containers || orphans.processes || orphans.writers) {
    const msg = `limpieza de restos de una copia interrumpida: ${orphans.processes} procesos y ${orphans.writers} contenedores de volcado huérfanos detenidos, ${files} archivos o carpetas temporales, ${folders} carpetas incompletas, ${containers} contenedores de prueba (en ${base})`;
    console.log('✔ ' + msg[0].toUpperCase() + msg.slice(1));
    log(msg);
  }
  return { files, folders, containers };
}

// Second copy: only the encrypted files and the manifest (no data in clear),
// so the target may be a cloud-synced folder. Every file is checked by hash.
function mirrorBackup(dir, mirrorBase) {
  const target = physical(mirrorBase);
  if (inside(physical(repoRoot), target)) fail('La carpeta espejo está dentro del repositorio.');
  if (backupState(dir) !== 'válida') fail('Solo se copian al espejo copias válidas y cifradas.');
  const out = join(target, basename(dir));
  if (existsSync(out)) fail(`El espejo ya tiene ${basename(dir)}.`);
  mkdirSync(out, { recursive: true });
  try {
    for (const x of readdirSync(dir)) if (x.endsWith('.enc') || x === 'manifest.json' || x === PROTECT) writeFileSync(join(out, x), readFileSync(join(dir, x)));
    if (backupState(out) !== 'válida') fail('La copia en el espejo no coincide con el original.');
  } catch (e) { rmSync(out, { recursive: true, force: true }); throw e; }
  console.log(`✔ Copia cifrada duplicada en el espejo (${basename(dir)}), verificada por hash.`);
  return out;
}

// Copies the CONSERVAR.txt markers of local backups to their mirrored copies
// (it holds no data), so the mirror rotation never removes a protected copy.
function syncProtection(base, mirrorBase) {
  for (const b of listBackups(base)) {
    const twin = join(mirrorBase, b.name);
    if (existsSync(join(b.dir, PROTECT)) && existsSync(twin) && !existsSync(join(twin, PROTECT))) writeFileSync(join(twin, PROTECT), readFileSync(join(b.dir, PROTECT)));
  }
}

// Starts Docker Desktop if needed and waits for the engine (up to 4 min).
function ensureDocker() {
  if (docker(['info', '--format', '{{.ServerVersion}}']).status === 0) return;
  if (process.platform !== 'win32') fail('Docker no está en marcha.');
  const where = spawnSync('where.exe', ['docker'], { encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean)[0];
  const candidates = [where && resolve(dirname(where), '..', '..', 'Docker Desktop.exe'), join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe'), join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DockerDesktop', 'Docker Desktop.exe')].filter(Boolean);
  const exe = candidates.find(p => existsSync(p));
  if (!exe) fail('Docker no está en marcha y no se encontró Docker Desktop.');
  console.log('Arrancando Docker Desktop…');
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
    if (docker(['info', '--format', '{{.ServerVersion}}']).status === 0) return;
  }
  fail('Docker Desktop no arrancó en 4 minutos.');
}

function status() {
  const c = loadConfig();
  for (const [label, base] of [['copias', c.copias], ...(c.espejo ? [['espejo', c.espejo]] : [])]) {
    const list = listBackups(base);
    const last = list.find(b => b.state === 'válida');
    const hours = last ? Math.round((Date.now() - last.date) / 3600000) : null;
    console.log(`${label}: ${list.length} copias, última válida ${last ? `${last.name} (hace ${hours} h)` : 'ninguna'}${list.filter(b => b.state !== 'válida').length ? `, ${list.filter(b => b.state !== 'válida').length} no válidas o incompletas` : ''}`);
  }
}

// The scheduled job: start Docker, back up (sweep and lock included), rotate,
// mirror, log; any failure is logged and shown as a Windows notification.
async function daily() {
  try {
    // Inside the try: a broken config.json must be logged (to the default log)
    // and notified like any other failure, never stop the copies silently.
    const c = loadConfig();
    log('copia diaria: inicio');
    const previous = listBackups(c.copias).find(b => b.state === 'válida');
    if (previous && Date.now() - previous.date > 48 * 3600000) {
      const msg = `La última copia válida es de hace ${Math.round((Date.now() - previous.date) / 3600000)} horas: alguna copia diaria no se hizo.`;
      log('aviso: ' + msg); notify('TALLERIA: copias atrasadas', msg);
    }
    ensureDocker();
    const releaseLock = await acquireLock();
    try { await dailyLocked(c); } finally { releaseLock(); }
  } catch (e) {
    const msg = e instanceof Stop ? e.message : String(e?.message ?? e);
    log('copia diaria: FALLO: ' + msg.split('\n')[0]);
    notify('TALLERIA: la copia de seguridad ha fallado', msg.split('\n')[0].slice(0, 200) + ' Detalles en el registro de copias.');
    throw e;
  }
}

// Runs under the global lock for the whole job: backup, mirror and rotation.
async function dailyLocked(c) {
  const dir = await backup(c.copias, { haveLock: true });
  const fresh = [basename(dir)];
  // Duplicate first, rotate last: a rotation can never act on a copy that
  // still has to be mirrored, and it never removes the copy just made.
  if (c.espejo) { mirrorBackup(dir, c.espejo); syncProtection(c.copias, c.espejo); }
  console.log('Rotación de las copias locales:');
  prune(c.copias, { alsoKeep: fresh });
  if (c.espejo) { console.log('Rotación del espejo:'); prune(c.espejo, { alsoKeep: fresh }); }
  log(`copia diaria: correcta (${basename(dir)}${c.espejo ? ', duplicada en el espejo' : ''})`);
}

try {
  if (initKey) createKey();
  else if (exportKey) await exportKeyToClipboard();
  else if (checkKeyCopyFlag) await checkKeyCopy();
  else if (checkKeyFlag) checkKey();
  else if (decryptDir) decryptCommand(decryptDir, outDir);
  else if (verifyDir) await verifyBackup(resolve(verifyDir));
  else if (dailyFlag) await daily();
  else if (pruneDir) { loadConfig(); const release = await acquireLock(); try { prune(pruneDir, { dry: dryRun }); } finally { release(); } }
  else if (sweepDir) {
    loadConfig();
    // Optional here: with a source, this database's CLI dump containers are
    // recognised too; without it, only labelled containers are touched.
    try { loadSource(); } catch (e) { if (!(e instanceof Stop)) throw e; }
    const base = checkOutsideRepoAndOneDrive(sweepDir);
    const release = await acquireLock();
    try { sweep(base); } finally { release(); }
  }
  else if (statusFlag) status();
  else if (notifyTest) console.log(notify('TALLERIA: prueba de aviso', 'Si ves esto, los avisos de copias funcionan.') ? '✔ Aviso enviado.' : '✘ No se pudo mostrar el aviso.');
  else if (mirrorDir) { if (!destination) fail('Uso: --mirror <carpeta-espejo> <carpeta-de-copia>'); const release = await acquireLock(); try { mirrorBackup(resolve(destination), mirrorDir); } finally { release(); } }
  else await backup();
} catch (e) {
  console.error('✘ ' + redact(e instanceof Stop ? e.message : (e?.stack ?? e)));
  process.exitCode = 1;
}

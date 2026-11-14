const fs = require('node:fs');
const path = require('node:path');

const vaultRoot = path.resolve(__dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules', '.venv', 'dist', 'dist-desktop']);
const markdownFiles = [];

function collectMarkdown(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectMarkdown(entryPath);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) markdownFiles.push(entryPath);
  }
}

collectMarkdown(vaultRoot);
const markdownByName = new Map();
for (const file of markdownFiles) {
  const key = path.basename(file, '.md').toLowerCase();
  markdownByName.set(key, [...(markdownByName.get(key) || []), file]);
}

function insideVault(candidate) {
  const relative = path.relative(vaultRoot, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function existsTarget(fromFile, rawTarget, wikilink) {
  const target = decodeURIComponent(rawTarget.trim().replace(/^<|>$/g, '').split('#')[0]);
  if (!target || /^(https?:|mailto:|obsidian:|data:)/i.test(target)) return true;

  const normalized = target.replace(/[\\]/g, path.sep);
  const hasExtension = Boolean(path.extname(normalized));
  const candidates = [
    path.resolve(path.dirname(fromFile), normalized),
    path.resolve(vaultRoot, normalized)
  ];
  if (!hasExtension) {
    candidates.push(...candidates.slice().map(candidate => `${candidate}.md`));
  }
  if (wikilink && !normalized.includes('/') && !normalized.includes('\\')) {
    candidates.push(...(markdownByName.get(normalized.toLowerCase()) || []));
  }
  return candidates.some(candidate => insideVault(candidate) && fs.existsSync(candidate));
}

const broken = [];
const missingMetadata = [];
for (const file of markdownFiles) {
  const rawText = fs.readFileSync(file, 'utf8');
  const relative = path.relative(vaultRoot, file).split(path.sep).join('/');
  // Las fuentes originales y la ficha técnica de las skills conservan su formato propio.
  if (!relative.startsWith('raw/') && !relative.startsWith('.agents/skills/')) {
    const frontmatter = rawText.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || '';
    const requiredFields = ['doc_type', 'status', 'summary', 'tags'];
    const absent = requiredFields.filter(field => !new RegExp(`^${field}:\\s*\\S`, 'm').test(frontmatter));
    if (absent.length) missingMetadata.push(`${relative} → faltan ${absent.join(', ')}`);
  }
  // Los ejemplos de enlaces dentro de bloques de código son plantillas, no
  // destinos que la bóveda deba contener.
  const text = rawText
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`]*`/g, '');
  const links = [
    ...[...text.matchAll(/!?\[\[([^\]]+)\]\]/g)].map(match => ({ target: match[1].split('|')[0], wikilink: true })),
    ...[...text.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)].map(match => ({ target: match[1], wikilink: false }))
  ];
  for (const link of links) {
    if (!existsTarget(file, link.target, link.wikilink)) {
      broken.push(`${path.relative(vaultRoot, file)} → ${link.target}`);
    }
  }
}

if (broken.length || missingMetadata.length) {
  if (broken.length) process.stderr.write(`Enlaces rotos (${broken.length}):\n${broken.map(link => `- ${link}`).join('\n')}\n`);
  if (missingMetadata.length) process.stderr.write(`Notas sin etiquetas/resumen/estado (${missingMetadata.length}):\n${missingMetadata.map(note => `- ${note}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  const taggedCount = markdownFiles.filter(file => {
    const relative = path.relative(vaultRoot, file).split(path.sep).join('/');
    return !relative.startsWith('raw/') && !relative.startsWith('.agents/skills/');
  }).length;
  process.stdout.write(`OK: ${markdownFiles.length} notas revisadas; ${taggedCount} con metadatos; enlaces correctos.\n`);
}

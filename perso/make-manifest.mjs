// Génère frontend/garmin/manifest-perso.xml : le manifeste d'origine réduit à UNE montre.
// Usage : node perso/make-manifest.mjs <dossier garmin> <identifiant de montre>   (ex. fenix847mm)
import fs from 'node:fs'
import path from 'node:path'

const [, , dir, device] = process.argv
if (!dir || !device) { console.error('usage: node make-manifest.mjs <dossier garmin> <montre>'); process.exit(2) }
let xml = fs.readFileSync(path.join(dir, 'manifest.xml'), 'utf8')
xml = xml.replace(new RegExp(`\\s*<iq:product id="(?!${device}")[^"]*"/>`, 'g'), '')
if (!xml.includes(`<iq:product id="${device}"/>`)) {
  console.error(`la montre ${device} n'est pas dans manifest.xml`)
  process.exit(1)
}
fs.writeFileSync(path.join(dir, 'manifest-perso.xml'), xml)
console.log(`manifest-perso.xml : ${(xml.match(/<iq:product /g) || []).length} montre (${device})`)

#!/usr/bin/env node
/* Gera o par de chaves que assina o CRX. RODA UMA VEZ SO NA VIDA DO PROJETO.
 *
 * LEIA ANTES DE RODAR
 * O ID da extensao vem da chave PUBLICA. O ID e o que faz o "Permitir acesso a URLs de
 * arquivo" sobreviver as atualizacoes nas ~60 maquinas. Gerar uma chave nova depois que
 * a extensao ja esta distribuida cria uma extensao DIFERENTE: todo mundo perde o toggle,
 * perde a configuracao, e alguem tem que passar nas 60 maquinas de novo.
 *
 * Se config/chave-publica.txt ja existe, este script se recusa a rodar. Isso e de
 * proposito.
 *
 *   node scripts/gerar-chave.mjs
 */
import crypto from 'node:crypto';
import { fs, RAIZ, CONFIG, ARQ_CHAVE_PUBLICA, ARQ_CHAVE_PRIVADA, cor } from './lib/comum.mjs';
import { derPublico, idDaExtensao, chaveDoManifest } from './lib/crx.mjs';

if (fs.existsSync(ARQ_CHAVE_PUBLICA)) {
  console.error(cor.erro('\n  PARE. Ja existe uma chave publica em config/chave-publica.txt.\n'));
  console.error('  Gerar outra troca o ID da extensao e quebra a atualizacao de todas as maquinas');
  console.error('  ja instaladas. Se voce PERDEU a chave privada, isso e um incidente: leia a');
  console.error('  secao "Perdi a chave" em docs/ARQUITETURA.md antes de continuar.\n');
  process.exit(1);
}

console.log('\n  Gerando o par RSA de 2048 bits…\n');

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

const derPub = derPublico(privateKey);
const id = idDaExtensao(derPub);
const chaveManifest = chaveDoManifest(derPub);

fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(ARQ_CHAVE_PUBLICA, chaveManifest + '\n', 'utf8');
fs.writeFileSync(ARQ_CHAVE_PRIVADA, privateKey, { encoding: 'utf8', mode: 0o600 });

console.log('  ' + cor.ok('config/chave-publica.txt') + '  — publica, vai versionada. Define o ID.');
console.log('  ' + cor.aviso('chave-privada.pem') + '        — SEGREDO. Ja esta no .gitignore.\n');
console.log('  ID da extensao: ' + cor.ok(id) + '\n');
console.log('  AGORA, NESTA ORDEM:');
console.log('   1. Guarde chave-privada.pem no cofre de senhas da empresa.');
console.log('   2. No GitHub: Settings > Secrets and variables > Actions > New repository secret');
console.log('      Nome: CRX_PRIVATE_KEY   Valor: o conteudo inteiro do arquivo .pem');
console.log('   3. Confira que o arquivo NAO aparece em `git status`.');
console.log('   4. So entao apague a copia local, se quiser.\n');
console.log(cor.fraco('  Sem essa chave nao da para publicar atualizacao. Com ela vazada, qualquer um'));
console.log(cor.fraco('  assina um CRX que o Chrome aceita como atualizacao legitima desta extensao.\n'));

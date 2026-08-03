/* Empacotador CRX3 — o formato que o Chrome aceita para extensao auto-hospedada.
 *
 * ESTRUTURA DO ARQUIVO
 *   "Cr24" | versao=3 (uint32 LE) | tamanho do cabecalho (uint32 LE) | cabecalho | ZIP
 *
 * O cabecalho e um protobuf (CrxFileHeader) com a chave publica, a assinatura e o
 * "signed header data". Sao tres mensagens pequenas — codificadas a mao aqui, porque
 * arrastar um runtime de protobuf para escrever 40 bytes nao se paga.
 *
 * O QUE E ASSINADO
 *   "CRX3 SignedData\x00" + uint32LE(tamanho do signed_header_data) + signed_header_data + ZIP
 * com RSA-SHA256 (PKCS#1 v1.5).
 *
 * POR QUE A CHAVE IMPORTA TANTO
 * O ID da extensao sai dos 16 primeiros bytes do SHA-256 da chave PUBLICA. ID estavel e
 * o que faz o "Permitir acesso a URLs de arquivo" sobreviver as atualizacoes. Trocou a
 * chave, virou outra extensao: as 60 maquinas perdem o toggle e a configuracao.
 */
import crypto from 'node:crypto';

/** Varint do protobuf (base 128, little-endian). */
function varint(n) {
  const bytes = [];
  while (n > 127) { bytes.push((n & 0x7f) | 0x80); n >>>= 7; }
  bytes.push(n);
  return Buffer.from(bytes);
}

/** Campo protobuf do tipo "bytes" (wire type 2). */
function campoBytes(numeroCampo, conteudo) {
  return Buffer.concat([
    varint((numeroCampo << 3) | 2),
    varint(conteudo.length),
    conteudo
  ]);
}

/** DER SubjectPublicKeyInfo da chave publica — e o mesmo valor do campo "key" do manifest. */
export function derPublico(chavePrivadaPem) {
  const publica = crypto.createPublicKey(chavePrivadaPem);
  return publica.export({ type: 'spki', format: 'der' });
}

/** ID da extensao: SHA-256 do DER publico, 16 primeiros bytes, cada nibble virando a..p. */
export function idDaExtensao(derPub) {
  const resumo = crypto.createHash('sha256').update(derPub).digest().subarray(0, 16);
  let id = '';
  for (const byte of resumo) {
    id += String.fromCharCode(97 + (byte >> 4));
    id += String.fromCharCode(97 + (byte & 0x0f));
  }
  return id;
}

/** Valor do campo "key" do manifest.json (DER publico em base64). */
export function chaveDoManifest(derPub) {
  return derPub.toString('base64');
}

/**
 * Monta o CRX3.
 * @param {Buffer} zip conteudo do pacote
 * @param {string|Buffer} chavePrivadaPem PEM da chave RSA
 */
export function criarCrx(zip, chavePrivadaPem) {
  const derPub = derPublico(chavePrivadaPem);
  const crxId = crypto.createHash('sha256').update(derPub).digest().subarray(0, 16);

  // SignedData { crx_id = 1 }
  const signedHeaderData = campoBytes(1, crxId);

  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32LE(signedHeaderData.length, 0);

  const assinatura = crypto.createSign('sha256')
    .update(Buffer.from('CRX3 SignedData\x00', 'binary'))
    .update(tamanho)
    .update(signedHeaderData)
    .update(zip)
    .sign(chavePrivadaPem);

  // AsymmetricKeyProof { public_key = 1, signature = 2 }
  const prova = Buffer.concat([campoBytes(1, derPub), campoBytes(2, assinatura)]);

  // CrxFileHeader { sha256_with_rsa = 2, signed_header_data = 10000 }
  const cabecalho = Buffer.concat([
    campoBytes(2, prova),
    campoBytes(10000, signedHeaderData)
  ]);

  const preambulo = Buffer.alloc(12);
  preambulo.write('Cr24', 0, 'ascii');
  preambulo.writeUInt32LE(3, 4);                  // versao do formato CRX
  preambulo.writeUInt32LE(cabecalho.length, 8);

  return {
    crx: Buffer.concat([preambulo, cabecalho, zip]),
    id: idDaExtensao(derPub),
    key: chaveDoManifest(derPub)
  };
}

/** Le a chave do secret CRX_PRIVATE_KEY (PEM cru ou em base64) ou de um arquivo. */
export function lerChavePrivada(conteudoBruto) {
  const texto = String(conteudoBruto || '').trim();
  if (!texto) return null;
  if (texto.includes('PRIVATE KEY')) return texto;
  // No GitHub Actions e comum guardar o PEM em base64 para nao brigar com quebra de linha.
  try {
    const decodificado = Buffer.from(texto, 'base64').toString('utf8');
    if (decodificado.includes('PRIVATE KEY')) return decodificado;
  } catch (e) { /* nao era base64 */ }
  return null;
}
